/**
 * Automatic session compression. When the player leaves a session (switches
 * away, starts a new one, or closes the app), the chat is compressed into a
 * recap stored in the session's frontmatter. New sessions of the same
 * campaign get the latest recaps as a "Previous sessions" prompt block.
 */
import { messageToTurn } from '@shared/prompt'
import {
  chunkLines,
  isRecapStale,
  isRecapWorthy,
  previousSessions,
  RECAP_NOTES_SYSTEM,
  RECAP_SYSTEM,
  recapMessages,
  type SessionRecap
} from '@shared/recap'
import type { TextBackend } from '@shared/settings'
import type { Message, Session, VaultPath } from '@shared/types'
import { backendChain } from './backends/chain'
import { effectiveContext } from './backends/context'
import { resolveTextBackend, textAdapter } from './backends/text'
import { AppError, toErrorInfo } from './errors'
import { send } from './ipc'
import { readSession, updateFrontmatter } from './sessions'
import { settingsStore } from './settings-store'
import { parseNote } from './vault/frontmatter'
import { vaultService } from './vault/service'
import { getMainWindow } from './window'

/** A session counts as finished on startup once it has been idle this long. */
const IDLE_MS = 2 * 60 * 60 * 1000
/** The first reply of a new session waits at most this long for the previous recap. */
const WAIT_MS = 90_000

function transcriptLine(m: Message, persona: string): string | null {
  const t = messageToTurn(m, persona)
  if (!t) return null
  const who = t.role === 'assistant' ? 'DM' : m.role === 'player' ? m.name || persona : 'Note'
  return `${who}: ${t.content}`
}

class RecapService {
  private inflight = new Map<VaultPath, Promise<Session | null>>()

  /**
   * Compresses a session into its recap. Returns the updated session, or null
   * when there was nothing to do (too short, no backend). Concurrent calls for
   * the same session share one request; an up-to-date recap is never redone
   * unless `force` is set.
   */
  compress(path: VaultPath, opts: { force?: boolean; notify?: boolean } = {}): Promise<Session | null> {
    const running = this.inflight.get(path)
    if (running) return running
    const job = this.run(path, opts).finally(() => this.inflight.delete(path))
    this.inflight.set(path, job)
    return job
  }

  private async run(path: VaultPath, { force = false, notify = false }: { force?: boolean; notify?: boolean }): Promise<Session | null> {
    const s = settingsStore.get()
    const vault = vaultService.require()
    const session = await readSession(vault, path)
    const visible = recapMessages(session.messages)
    if (!isRecapWorthy(session.messages)) {
      if (force) throw new AppError('NOTHING_TO_RECAP', 'This session is too short to compress yet. Play a few turns first.')
      return null
    }
    if (!force && session.frontmatter.recap && !isRecapStale(session.frontmatter.recap_upto, session.messages)) return session
    const chain = backendChain(s, 'summary')
    if (!chain.length) {
      if (force) throw new AppError('NO_BACKEND', 'Add a text backend in Settings first.')
      return null
    }

    // The rolling summary already covers the older part; only read what came after it.
    const fm = session.frontmatter
    const upto = fm.summary && fm.summary_upto ? visible.findIndex((m) => m.id === fm.summary_upto) : -1
    let notes = upto !== -1 ? fm.summary! : ''
    const persona = fm.persona || s.general.playerName
    const lines = visible
      .slice(upto + 1)
      .map((m) => transcriptLine(m, persona))
      .filter((l): l is string => !!l)

    // Keep each request well inside the smallest context in the chain.
    const context = Math.min(...(await Promise.all(chain.map((b) => effectiveContext(b)))), 32_000)
    const chunks = chunkLines(lines, Math.max(4000, context * 3 - 6000))
    if (chunks.length === 0) chunks.push('')
    for (let i = 0; i < chunks.length; i++) {
      const last = i === chunks.length - 1
      const earlier = notes ? `${last ? 'Notes on the earlier part of the session' : 'Notes so far'}:\n${notes}\n\n` : ''
      const events = chunks[i] ? `${last && notes ? 'The rest of the session' : 'Session transcript'}:\n${chunks[i]}\n\n` : ''
      notes = await this.generate(chain, last ? RECAP_SYSTEM : RECAP_NOTES_SYSTEM, `Session: ${fm.title}\n\n${earlier}${events}${last ? 'Write the recap.' : 'Write the updated notes.'}`)
    }

    const updated = await updateFrontmatter(vault, path, {
      recap: notes,
      recap_upto: visible[visible.length - 1]!.id,
      recap_at: new Date().toISOString()
    })
    const win = getMainWindow()
    send(win, 'session:updated', updated)
    void vaultService.reindex(path)
    if (notify) send(win, 'toast', { level: 'success', title: `Compressed “${fm.title}”`, detail: 'Its recap will be included as context in the next session.' })
    return updated
  }

  private async generate(chain: TextBackend[], system: string, content: string): Promise<string> {
    let lastError: unknown = null
    for (const backend of chain) {
      try {
        const result = await textAdapter(backend.type).generate(
          resolveTextBackend(backend),
          { system, messages: [{ role: 'user', content }], maxTokens: 800 },
          { stream: false }
        )
        const text = result.text.trim()
        if (text) return text
        lastError = new AppError('EMPTY_RESPONSE', `${backend.name} returned an empty recap.`)
      } catch (err) {
        lastError = err
      }
    }
    throw lastError
  }

  /** Background compression that only logs failures. */
  private quietly(path: VaultPath): Promise<Session | null> {
    return this.compress(path, { notify: true }).catch((err) => {
      console.warn('[recap] could not compress', path, toErrorInfo(err).message)
      return null
    })
  }

  /** Called when the player leaves a session. */
  onLeave(path: VaultPath): void {
    if (settingsStore.get().prompt.autoRecap) void this.quietly(path)
  }

  /** The session that came right before `session` in its campaign. */
  private previous(session: Pick<Session, 'path' | 'campaignPath' | 'frontmatter'>): VaultPath | null {
    const index = vaultService.getIndex()
    if (!index) return null
    return previousSessions(index.sessions, { path: session.path, campaignPath: session.campaignPath, created: session.frontmatter.created })[0]?.path ?? null
  }

  /** Called when a session is created: the one before it has just ended. */
  onSessionCreated(session: Session): void {
    const prev = this.previous(session)
    if (prev) this.onLeave(prev)
  }

  /**
   * Before the first replies of a session, make sure the previous session's
   * recap is ready (waiting for a compression already under way).
   */
  async ensurePrevious(session: Session): Promise<void> {
    if (!settingsStore.get().prompt.autoRecap) return
    if (session.messages.filter((m) => m.role === 'player').length > 2) return
    const prev = this.previous(session)
    if (!prev) return
    await Promise.race([this.quietly(prev), new Promise((r) => setTimeout(r, WAIT_MS))])
  }

  /** Up to `limit` recaps of earlier sessions in the campaign, oldest first. */
  async recapsFor(session: Pick<Session, 'path' | 'campaignPath' | 'frontmatter'>, limit: number): Promise<SessionRecap[]> {
    const index = vaultService.getIndex()
    if (!index || limit <= 0) return []
    const vault = vaultService.require()
    const out: SessionRecap[] = []
    const candidates = previousSessions(index.sessions, { path: session.path, campaignPath: session.campaignPath, created: session.frontmatter.created })
    for (const s of candidates.slice(0, limit * 3)) {
      if (out.length >= limit) break
      // Frontmatter only; no need to parse the whole transcript.
      const file = await vault.readIfExists(s.path).catch(() => null)
      const recap = file ? parseNote(file.content).data.recap : undefined
      if (typeof recap === 'string' && recap.trim()) out.push({ path: s.path, title: s.title, created: s.created, recap: recap.trim() })
    }
    return out.reverse()
  }

  /**
   * On startup: the session played last time was left when the app closed.
   * Compress it if it has been idle for a while and its recap is out of date.
   */
  async compressLastPlayed(): Promise<void> {
    if (!settingsStore.get().prompt.autoRecap) return
    const index = vaultService.getIndex()
    if (!index?.sessions.length) return
    const vault = vaultService.require()
    const recent = [...index.sessions].sort((a, b) => b.created.localeCompare(a.created)).slice(0, 8)
    let best: { session: Session; at: number } | null = null
    for (const s of recent) {
      const session = await readSession(vault, s.path).catch(() => null)
      const last = session ? recapMessages(session.messages).at(-1) : undefined
      const at = last ? Date.parse(last.createdAt) : NaN
      if (session && Number.isFinite(at) && (!best || at > best.at)) best = { session, at }
    }
    if (!best || Date.now() - best.at < IDLE_MS) return
    const { session } = best
    if (isRecapWorthy(session.messages) && (!session.frontmatter.recap || isRecapStale(session.frontmatter.recap_upto, session.messages))) {
      await this.quietly(session.path)
    }
  }
}

export const recapService = new RecapService()
