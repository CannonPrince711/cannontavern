/**
 * Chat generation: gathers the context for a session, builds the prompt,
 * streams the reply from the chosen backend (falling back down the list if it
 * fails), pushes tokens to the window, and writes the result to the note.
 */
import { randomUUID } from 'node:crypto'
import { newMessageId } from '@shared/callouts'
import { aiSpeakers, lastAiMessage, nextSpeaker, playModeOf, userRole, type Speaker } from '@shared/play'
import { buildPrompt, messageToTurn, normalizeBlockOrder, selectLore, type BuiltPrompt } from '@shared/prompt'
import type { TextBackend } from '@shared/settings'
import type { CharacterNote, Message, PromptPreview, Session, VaultPath } from '@shared/types'
import { AppError, toErrorInfo } from './errors'
import { send } from './ipc'
import { readCampaign, readCharacter, readLorebook, readPreset, resolveCharacterLink, resolveLorebookLinks } from './library'
import { postMessage, readSession, updateFrontmatter, updateMessage } from './sessions'
import { settingsStore } from './settings-store'
import { redactRequest, resolveTextBackend, textAdapter } from './backends/text'
import type { GenerateResult } from './backends/text/types'
import { backendChain } from './backends/chain'
import { recapService } from './recap'
import { vaultService } from './vault/service'
import { extensionHost } from './extensions/host'
import { getMainWindow } from './window'

type JobKind = 'new' | 'swipe' | 'continue'

interface Job {
  requestId: string
  kind: JobKind
  sessionPath: VaultPath
  messageId: string
  /** The story role the AI writes in this reply. */
  speaker: Speaker
  controller: AbortController
}

export interface ChatContext {
  session: Session
  character: CharacterNote | null
  prompt: BuiltPrompt
  /** Label for the other side of the conversation (the player, or the DM). */
  persona: string
  speaker: Speaker
  /** The AI's own label: "DM", or the character's name when it plays them. */
  speakerName: string
}

const STATE_RE = /<state>([\s\S]*?)<\/state>/gi

/** Removes hidden <state>{…}</state> blocks; returns the clean text and the parsed changes. */
export function extractState(text: string): { text: string; changes: Record<string, unknown>[] } {
  const changes: Record<string, unknown>[] = []
  const clean = text.replace(STATE_RE, (_, json: string) => {
    try {
      const v = JSON.parse(json) as unknown
      if (v && typeof v === 'object' && !Array.isArray(v)) changes.push(v as Record<string, unknown>)
    } catch {
      /* malformed block: drop it silently */
    }
    return ''
  })
  return { text: clean.replace(/\n{3,}/g, '\n\n').trim(), changes }
}

/** Errors worth trying the next backend for (not user aborts or bad settings). */
function shouldFallBack(err: unknown): boolean {
  const code = (err as { code?: string })?.code ?? ''
  if (code === 'ABORTED' || code === 'BAD_EXTRA_BODY' || code === 'BAD_TEMPLATE') return false
  return true
}

export { backendChain }

class ChatService {
  private jobs = new Map<string, Job>()

  /** Loads everything the prompt needs for a session. */
  async context(sessionPath: VaultPath, opts: { upto?: string; backend?: TextBackend; speaker?: Speaker } = {}): Promise<ChatContext> {
    const vault = vaultService.require()
    const s = settingsStore.get()
    const session = await readSession(vault, sessionPath)
    const recapsOn = s.prompt.recapCount > 0 && normalizeBlockOrder(s.prompt.blocks).some((b) => b.id === 'recaps' && b.enabled)
    if (recapsOn && !opts.upto) await recapService.ensurePrevious(session)
    const recaps = recapsOn ? await recapService.recapsFor(session, s.prompt.recapCount) : []

    const characterPath = session.frontmatter.characters[0] ? await resolveCharacterLink(vault, session.frontmatter.characters[0]) : null
    const character = characterPath ? await readCharacter(vault, characterPath).catch(() => null) : null
    const { campaign, party } = await readCampaign(vault, session.campaignPath)
    const preset = s.general.defaultPreset ? await readPreset(vault, s.general.defaultPreset) : null

    let messages = session.messages
    if (opts.upto) {
      const i = messages.findIndex((m) => m.id === opts.upto)
      if (i !== -1) messages = messages.slice(0, i)
    }

    const lorePaths = await resolveLorebookLinks(vault, campaign.lorebooks)
    const entries = (await Promise.all(lorePaths.map((p) => readLorebook(vault, p).catch(() => null)))).flatMap((b) => b?.entries ?? [])
    const backend = opts.backend ?? backendChain(s)[0]
    const tokenizer = backend?.tokenizer ?? 'chars4'
    const lore = selectLore(entries, messages, s.prompt.lorebookScanDepth, s.prompt.lorebookTokenBudget, tokenizer)

    const mode = playModeOf(session.frontmatter)
    const speaker = opts.speaker ?? nextSpeaker(mode, messages)
    const characterName = character?.card.name || session.frontmatter.persona || s.general.playerName
    // Writing as the DM, the other side is the player character; writing as the character, it's the DM.
    const persona = speaker === 'player' ? 'DM' : mode === 'ai-dm' ? session.frontmatter.persona || characterName : characterName
    const speakerName = speaker === 'player' ? characterName : 'DM'
    const prompt = buildPrompt({
      userName: persona,
      speaker,
      playerPrompt: s.prompt.playerPrompt,
      character: character?.card ?? null,
      campaign,
      party,
      preset,
      lore,
      sheet: character?.card.dnd ?? null,
      combat: session.frontmatter.combat ?? null,
      summary: session.frontmatter.summary ?? null,
      recaps,
      messages,
      order: normalizeBlockOrder(s.prompt.blocks),
      budget: s.prompt.contextBudget || backend?.generation.contextSize || 8192,
      maxReplyTokens: backend?.generation.maxTokens ?? 800,
      tokenizer,
      autoState: speaker === 'dm' && s.prompt.autoState && !!character?.card.dnd
    })
    // Extensions may add or change blocks (only when the "extensions" block is on).
    if (s.prompt.blocks.some((b) => b.id === 'extensions' && b.enabled)) {
      const blocks = await extensionHost.applyPromptBuild(prompt.blocks, sessionPath)
      if (blocks !== prompt.blocks) {
        const system = blocks.filter((b) => b.id !== 'history').map((b) => b.content).join('\n\n')
        const historyTokens = blocks.find((b) => b.id === 'history')?.tokens ?? 0
        prompt.blocks = blocks
        prompt.system = system
        prompt.totalTokens = Math.ceil(system.length / 4) + historyTokens
      }
    }
    return { session, character, prompt, persona, speaker, speakerName }
  }

  async inspect(sessionPath: VaultPath): Promise<PromptPreview> {
    const s = settingsStore.get()
    const backend = backendChain(s)[0]
    if (!backend) throw new AppError('NO_BACKEND', 'Add a text backend in Settings first.')
    const { prompt } = await this.context(sessionPath, { backend })
    const resolved = resolveTextBackend(backend)
    const req = redactRequest(textAdapter(backend.type).prepare(resolved, { system: prompt.system, messages: prompt.messages }, backend.generation.stream))
    return {
      backendId: backend.id,
      backendName: backend.name,
      url: req.url,
      headers: req.headers,
      body: req.body,
      blocks: prompt.blocks,
      totalTokens: prompt.totalTokens,
      budget: s.prompt.contextBudget || backend.generation.contextSize
    }
  }

  /**
   * Posts the user's text, in their role for the session's mode (their
   * character, the DM, or a director's note in AI-only play), then starts the
   * next AI reply.
   */
  async send(sessionPath: VaultPath, text: string, persona?: string, speaker?: Speaker): Promise<{ requestId: string }> {
    const vault = vaultService.require()
    let session = await readSession(vault, sessionPath)
    const mode = playModeOf(session.frontmatter)
    if (text.trim()) {
      const s = settingsStore.get()
      const role = userRole(mode)
      const message: Message = {
        id: newMessageId(),
        role,
        ...(role === 'player' ? { name: persona || session.frontmatter.persona || s.general.playerName } : role === 'system' ? { name: 'Director' } : {}),
        text: text.trim(),
        swipes: [text.trim()],
        swipeIndex: 0,
        createdAt: new Date().toISOString()
      }
      session = await postMessage(vault, sessionPath, message)
      this.publish(session)
    }
    return this.start('new', sessionPath, newMessageId(), speaker ?? nextSpeaker(mode, session.messages))
  }

  /** A new swipe for the last AI reply (or a fresh reply if the last message isn't one). */
  async regenerate(sessionPath: VaultPath): Promise<{ requestId: string }> {
    const session = await readSession(vaultService.require(), sessionPath)
    const mode = playModeOf(session.frontmatter)
    const last = session.messages[session.messages.length - 1]
    if (last && (aiSpeakers(mode) as string[]).includes(last.role)) return this.start('swipe', sessionPath, last.id, last.role as Speaker)
    return this.start('new', sessionPath, newMessageId(), nextSpeaker(mode, session.messages))
  }

  async continue(sessionPath: VaultPath): Promise<{ requestId: string }> {
    const session = await readSession(vaultService.require(), sessionPath)
    const last = lastAiMessage(playModeOf(session.frontmatter), session.messages)
    if (!last) throw new AppError('NOTHING_TO_CONTINUE', 'There is no AI reply to continue yet.')
    return this.start('continue', sessionPath, last.id, last.role as Speaker)
  }

  stop(requestId: string): void {
    this.jobs.get(requestId)?.controller.abort()
  }

  /** True while a reply is being generated for the session. */
  isBusy(sessionPath: VaultPath): boolean {
    return [...this.jobs.values()].some((j) => j.sessionPath === sessionPath)
  }

  private start(kind: JobKind, sessionPath: VaultPath, messageId: string, speaker: Speaker): { requestId: string } {
    if (this.isBusy(sessionPath)) throw new AppError('BUSY', 'A reply is already being written for this session.')
    if (settingsStore.get().textBackends.length === 0) throw new AppError('NO_BACKEND', 'Add a text backend in Settings first.')
    const job: Job = { requestId: randomUUID(), kind, sessionPath, messageId, speaker, controller: new AbortController() }
    this.jobs.set(job.requestId, job)
    void this.run(job).finally(() => {
      this.jobs.delete(job.requestId)
      if (this.jobs.size === 0) getMainWindow()?.setProgressBar(-1)
    })
    return { requestId: job.requestId }
  }

  private async run(job: Job): Promise<void> {
    const win = getMainWindow()
    const vault = vaultService.require()
    const s = settingsStore.get()
    const chain = backendChain(s)
    let streamed = ''
    let result: GenerateResult | null = null
    let used: TextBackend | null = null
    let speakerName = job.speaker === 'dm' ? 'DM' : ''
    let lastError: unknown = null
    win?.setProgressBar(2) // indeterminate on the taskbar

    for (const backend of chain) {
      try {
        const ctx = await this.context(job.sessionPath, { upto: job.kind === 'swipe' ? job.messageId : undefined, backend, speaker: job.speaker })
        const turns = ctx.prompt.messages
        speakerName = ctx.speakerName
        send(win, 'chat:started', {
          requestId: job.requestId,
          sessionPath: job.sessionPath,
          messageId: job.messageId,
          backendName: backend.name,
          speaker: job.speaker,
          speakerName: ctx.speakerName
        })
        extensionHost.notify(
          'onBeforeSend',
          redactRequest(textAdapter(backend.type).prepare(resolveTextBackend(backend), { system: ctx.prompt.system, messages: turns }, backend.generation.stream)),
          job.sessionPath
        )
        result = await textAdapter(backend.type).generate(
          resolveTextBackend(backend),
          { system: ctx.prompt.system, messages: turns, userLabel: ctx.persona, assistantLabel: ctx.speakerName },
          {
            signal: job.controller.signal,
            onToken: (delta) => {
              streamed += delta
              send(win, 'chat:token', { requestId: job.requestId, delta })
            }
          }
        )
        used = backend
        break
      } catch (err) {
        lastError = err
        const aborted = (err as { code?: string }).code === 'ABORTED'
        // Never fall back after tokens arrived or when the user pressed stop.
        if (aborted || streamed || !shouldFallBack(err) || backend === chain[chain.length - 1]) break
        const next = chain[chain.indexOf(backend) + 1]!
        send(win, 'toast', {
          level: 'warning',
          title: `${backend.name} failed, trying ${next.name}`,
          detail: toErrorInfo(err).message
        })
      }
    }

    const aborted = (lastError as { code?: string } | null)?.code === 'ABORTED'
    let raw = result?.text ?? streamed
    if (raw && !aborted) raw = await extensionHost.applyResponse(raw, job.sessionPath)
    const { text, changes } = extractState(raw)

    try {
      let session: Session | null = null
      if (text) session = await this.write(job, text, used ?? chain[0] ?? null, result?.model, speakerName)
      if (result?.refusal) {
        session = await postMessage(vault, job.sessionPath, {
          id: newMessageId(),
          role: 'system',
          text: `The model declined to continue${result.refusal.category ? ` (${result.refusal.category})` : ''}.`,
          swipes: [''],
          swipeIndex: 0,
          createdAt: new Date().toISOString(),
          hidden: true
        })
      }
      // Only the DM may change the character's sheet.
      if (changes.length && session && job.speaker === 'dm') this.onStateChanges?.(job.sessionPath, job.messageId, changes)
      if (session) this.publish(session)
      if (session && !aborted) void this.maybeSummarize(job.sessionPath)
      if (session && text && !aborted && job.kind !== 'continue') this.onReply?.(job.sessionPath, text)

      if (lastError && !aborted) {
        send(win, 'chat:error', { requestId: job.requestId, error: toErrorInfo(lastError) })
      } else if (!text && !aborted && !result?.refusal) {
        send(win, 'chat:error', {
          requestId: job.requestId,
          error: { code: 'EMPTY_REPLY', message: 'The model returned an empty reply.', detail: result?.stopReason ? `Stop reason: ${result.stopReason}` : undefined }
        })
      } else {
        send(win, 'chat:done', { requestId: job.requestId, session: session ?? (await readSession(vault, job.sessionPath)) })
      }
    } catch (err) {
      send(win, 'chat:error', { requestId: job.requestId, error: toErrorInfo(err) })
    }
  }

  private summarizing = new Set<string>()

  /**
   * Rolling memory: once `summaryEvery` messages have piled up since the last
   * summary, fold all but the newest few into the session's `summary`
   * frontmatter, using the "summaries" backend.
   */
  async maybeSummarize(sessionPath: VaultPath, force = false): Promise<void> {
    const s = settingsStore.get()
    if ((!s.prompt.summaryEvery && !force) || this.summarizing.has(sessionPath)) return
    const backend = backendChain(s, 'summary')[0]
    if (!backend) return
    this.summarizing.add(sessionPath)
    try {
      const vault = vaultService.require()
      const session = await readSession(vault, sessionPath)
      const visible = session.messages.filter((m) => !m.hidden && m.role !== 'image')
      const upto = session.frontmatter.summary_upto ? visible.findIndex((m) => m.id === session.frontmatter.summary_upto) : -1
      const pending = visible.slice(upto + 1)
      const keepRecent = 4
      if (!force && pending.length < s.prompt.summaryEvery + keepRecent) return
      const fold = pending.slice(0, Math.max(0, pending.length - keepRecent))
      if (fold.length === 0) return
      const persona = session.frontmatter.persona || s.general.playerName
      const transcript = fold
        .map((m) => {
          const t = messageToTurn(m, persona)
          if (!t) return null
          return `${t.role === 'assistant' ? 'DM' : m.role === 'player' ? m.name || persona : 'Note'}: ${t.content}`
        })
        .filter(Boolean)
        .join('\n\n')
      const result = await textAdapter(backend.type).generate(
        resolveTextBackend(backend),
        {
          system:
            'You keep the running summary of a Dungeons & Dragons session. Write in third person, past tense, as compact prose (at most 300 words). Keep names, places, discoveries, promises, open threads, injuries and items gained or lost. Do not invent anything.',
          messages: [
            {
              role: 'user',
              content: `${session.frontmatter.summary ? `Summary so far:\n${session.frontmatter.summary}\n\n` : ''}New events:\n${transcript}\n\nWrite the updated summary.`
            }
          ],
          maxTokens: 600
        },
        { stream: false }
      )
      const text = result.text.trim()
      if (!text) return
      const updated = await updateFrontmatter(vault, sessionPath, { summary: text, summary_upto: fold[fold.length - 1]!.id })
      this.publish(updated)
    } catch (err) {
      console.warn('[chat] summary update failed:', toErrorInfo(err).message)
    } finally {
      this.summarizing.delete(sessionPath)
    }
  }

  /** Hook called with each finished DM reply (used for automatic illustrations). */
  onReply: ((sessionPath: VaultPath, text: string) => void) | null = null

  /** Hook for auto-state (character sheet changes); wired by the sheet module. */
  onStateChanges: ((sessionPath: VaultPath, messageId: string, changes: Record<string, unknown>[]) => void) | null = null

  private async write(job: Job, text: string, backend: TextBackend | null, model?: string, speakerName?: string): Promise<Session> {
    const vault = vaultService.require()
    const now = new Date().toISOString()
    switch (job.kind) {
      case 'new':
        return postMessage(vault, job.sessionPath, {
          id: job.messageId,
          role: job.speaker,
          ...(job.speaker === 'player' && speakerName ? { name: speakerName } : {}),
          text,
          swipes: [text],
          swipeIndex: 0,
          createdAt: now,
          ...(model || backend?.model ? { model: model ?? backend?.model } : {}),
          ...(backend ? { backendId: backend.id } : {})
        })
      case 'swipe':
        return updateMessage(vault, job.sessionPath, job.messageId, (m) => ({
          ...m,
          text,
          swipes: [...m.swipes, text],
          swipeIndex: m.swipes.length,
          ...(model ? { model } : {})
        }))
      case 'continue':
        return updateMessage(vault, job.sessionPath, job.messageId, (m) => {
          const joined = /\s$/.test(m.text) || /^[\s,.;:!?)]/.test(text) ? m.text + text : `${m.text} ${text}`
          const swipes = [...m.swipes]
          swipes[m.swipeIndex] = joined
          return { ...m, text: joined, swipes }
        })
    }
  }

  private publish(session: Session): void {
    send(getMainWindow(), 'session:updated', session)
    void vaultService.reindex(session.path)
  }
}

export const chatService = new ChatService()
