/**
 * Chat generation: gathers the context for a session, builds the prompt,
 * streams the reply from the chosen backend (falling back down the list if it
 * fails), pushes tokens to the window, and writes the result to the note.
 */
import { randomUUID } from 'node:crypto'
import { newMessageId } from '@shared/callouts'
import { aiSpeakers, lastAiMessage, nextPartyTurn, nextSpeaker, playModeOf, userRole, type Speaker } from '@shared/play'
import { buildPartyPrompt, buildPrompt, COMPANION_PROMPT, estimateTokens, messageToTurn, normalizeBlockOrder, selectLore, shouldCompress, stripSpeakerLabel, type BuiltPrompt } from '@shared/prompt'
import type { TextBackend } from '@shared/settings'
import { withWorldInstructions } from '@shared/world'
import type { CharacterNote, LoreEntry, Message, PromptPreview, PromptView, Session, VaultPath } from '@shared/types'
import { AppError, toErrorInfo } from './errors'
import { send } from './ipc'
import { readCampaign, readCharacter, readLorebook, readPreset, resolveCharacterLink, resolveLorebookLinks } from './library'
import { postMessage, readSession, updateFrontmatter, updateMessage } from './sessions'
import { settingsStore } from './settings-store'
import { redactRequest, resolveTextBackend, textAdapter } from './backends/text'
import type { GenerateResult } from './backends/text/types'
import { backendChain, withModel } from './backends/chain'
import { effectiveContext } from './backends/context'
import { readMap } from './maps'
import { partyLocation } from '@shared/map'
import { editionOf, rulesLine } from '@shared/editions'
import { recapService } from './recap'
import { campaignNpcs } from './npcs'
import { mergeNpcLore, npcLoreEntry } from '@shared/npcs'
import { vaultService } from './vault/service'
import { extensionHost } from './extensions/host'
import { getMainWindow } from './window'
import { settingsFor, settingsForSession, worldOf } from './world'

type JobKind = 'new' | 'swipe' | 'continue'

/** Whether the Session summary block is sent; compressing only helps when it is. */
const summaryInPrompt = (s: ReturnType<typeof settingsStore.get>): boolean =>
  normalizeBlockOrder(s.prompt.blocks).some((b) => b.id === 'summary' && b.enabled)

interface Job {
  requestId: string
  kind: JobKind
  sessionPath: VaultPath
  messageId: string
  /** The story role the AI writes in this reply. */
  speaker: Speaker
  /** For a companion's turn: the character (wikilink or path) the AI plays. */
  as?: string
  controller: AbortController
}

export interface ChatContext {
  /** Party prompt (shared transcript, see buildPartyPrompt): stop at the next speaker's label. */
  stop?: string[]
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
  async context(sessionPath: VaultPath, opts: { upto?: string; backend?: TextBackend; speaker?: Speaker; as?: string } = {}): Promise<ChatContext> {
    const vault = vaultService.require()
    const session = await readSession(vault, sessionPath)
    const s = settingsFor(session.campaignPath)
    const recapsOn = s.prompt.recapCount > 0 && normalizeBlockOrder(s.prompt.blocks).some((b) => b.id === 'recaps' && b.enabled)
    if (recapsOn && !opts.upto) await recapService.ensurePrevious(session)
    const recaps = recapsOn ? await recapService.recapsFor(session, s.prompt.recapCount) : []

    // Every character in the session (several when players share a table); the first is "the" character.
    const partyPaths = await Promise.all(session.frontmatter.characters.map((l) => resolveCharacterLink(vault, l).catch(() => null)))
    const partyNotes = (await Promise.all(partyPaths.map((p) => (p ? readCharacter(vault, p).catch(() => null) : null)))).filter((c): c is CharacterNote => !!c)
    // AI companions: party members the AI plays beside the session's character (AI is DM, or AI only).
    const companionNotes = playModeOf(session.frontmatter) !== 'user-dm' ? await this.companions(session) : []
    const members = [...partyNotes, ...companionNotes]
    const asPath = opts.as ? ((await resolveCharacterLink(vault, opts.as).catch(() => null)) ?? opts.as) : null
    const self = asPath ? (members.find((c) => c.path === asPath) ?? null) : null
    const players = partyNotes
    const character = self ?? partyNotes[0] ?? null
    const { campaign, party } = await readCampaign(vault, session.campaignPath)
    const map = await readMap(vault, session.campaignPath).catch(() => null)
    const preset = withWorldInstructions(s.general.defaultPreset ? await readPreset(vault, s.general.defaultPreset) : null, campaign.world?.dm_instructions)

    let messages = session.messages
    if (opts.upto) {
      const i = messages.findIndex((m) => m.id === opts.upto)
      if (i !== -1) messages = messages.slice(0, i)
    }
    // Auto-compress: the summary stands in for the messages it already covers.
    if (summaryInPrompt(s) && s.prompt.autoCompressAt > 0 && session.frontmatter.summary && session.frontmatter.summary_upto) {
      const covered = messages.findIndex((m) => m.id === session.frontmatter.summary_upto)
      if (covered !== -1) messages = messages.slice(covered + 1)
    }

    // The campaign's lorebooks, plus the shared ones in Resources/Lore unless this world turns them off.
    const shared = campaign.world?.shared_resources === false ? [] : (vaultService.getIndex()?.lorebooks ?? []).filter((l) => l.shared).map((l) => l.path)
    const lorePaths = [...new Set([...(await resolveLorebookLinks(vault, campaign.lorebooks)), ...shared])]
    const entries = (await Promise.all(lorePaths.map((p) => readLorebook(vault, p).catch(() => null)))).flatMap((b) => b?.entries ?? [])
    const backend = opts.backend ?? backendChain(s)[0]
    const window = backend ? await effectiveContext(backend) : 8192
    const tokenizer = backend?.tokenizer ?? 'chars4'
    const mode = playModeOf(session.frontmatter)
    const speaker = opts.speaker ?? nextSpeaker(mode, messages)
    // NPC notes count as lore entries too; a player character's voice only learns what meeting them would show.
    const npcs = await campaignNpcs(vault, vaultService.getIndex(), session.campaignPath).catch(() => [])
    const npcEntries = npcs.map((n) => npcLoreEntry(n.card, n.body, { forPlayer: speaker === 'player' }))
    const lore = selectLore(mergeNpcLore(entries, npcEntries), messages, s.prompt.lorebookScanDepth, s.prompt.lorebookTokenBudget, tokenizer)
    // In a party, every speaker shares the same lore (NPCs without secrets); the DM gets the secrets in its own part.
    const partyLore = () => {
      // Companions are party members, not NPCs: their cards are already in the prompt.
      const others = npcs.filter((n) => !members.some((c) => c.path === n.path))
      const pick = (forPlayer: boolean): LoreEntry[] =>
        selectLore(mergeNpcLore(entries, others.map((n) => npcLoreEntry(n.card, n.body, { forPlayer }))), messages, s.prompt.lorebookScanDepth, s.prompt.lorebookTokenBudget, tokenizer)
      const npcTitles = new Set(others.map((n) => n.card.name.trim().toLowerCase()))
      return { shared: pick(true), dm: pick(false).filter((e) => npcTitles.has(e.title.trim().toLowerCase())) }
    }

    const characterName = character?.card.name || session.frontmatter.persona || s.general.playerName
    // The DM sees companions as player characters too.
    const table = self ? [] : [...players, ...companionNotes]
    const playerName = session.frontmatter.persona || players[0]?.card.name || s.general.playerName
    // Writing as the DM, the other side is the player character(s); writing as a character, it's the DM.
    const persona =
      speaker === 'player' ? 'DM' : table.length > 1 ? table.map((c) => c.card.name).join(', ') : mode === 'ai-dm' ? session.frontmatter.persona || characterName : characterName
    const speakerName = speaker === 'player' ? characterName : 'DM'
    const others = self
      ? [...new Set([...(mode === 'ai-dm' ? [playerName] : []), ...members.filter((c) => c !== self).map((c) => c.card.name)])].filter((n) => n !== self.card.name)
      : []
    // With AI companions, one shared prompt for everyone so local servers can reuse it between turns.
    const partyMode = companionNotes.length > 0 && mode !== 'user-dm'
    const order = normalizeBlockOrder(s.prompt.blocks)
    const budget = Math.min(s.prompt.contextBudget || window, window)
    const partyNames = members.map((c) => c.card.name)
    const turnName = speaker === 'player' ? (self ?? players[0])?.card.name ?? characterName : null
    const prompt = partyMode
      ? (() => {
          const pl = partyLore()
          return buildPartyPrompt({
            userName: persona,
            partyCards: members.map((c) => c.card),
            turn: turnName ? { speaker: 'player', name: turnName } : { speaker: 'dm' },
            campaign,
            party,
            preset,
            lore: pl.shared,
            dmLore: pl.dm,
            combat: session.frontmatter.combat ?? null,
            summary: session.frontmatter.summary ?? null,
            recaps,
            location: partyLocation(map),
            rules: campaign ? rulesLine(editionOf(campaign), campaign.sources ?? []) : null,
            messages,
            order,
            budget,
            maxReplyTokens: backend?.generation.maxTokens ?? 800,
            tokenizer,
            autoState: speaker === 'dm' && s.prompt.autoState && !!players[0]?.card.dnd
          })
        })()
      : buildPrompt({
      userName: persona,
      speaker,
      playerPrompt: self ? COMPANION_PROMPT.split('{{party}}').join(others.join(', ') || 'the party') : s.prompt.playerPrompt,
      ...(self ? { selfName: self.card.name } : {}),
      character: character?.card ?? null,
      partyCards: table.length > 1 ? table.map((c) => c.card) : undefined,
      campaign,
      party,
      preset,
      lore,
      sheet: character?.card.dnd ?? null,
      combat: session.frontmatter.combat ?? null,
      summary: session.frontmatter.summary ?? null,
      recaps,
      location: partyLocation(map),
      rules: campaign ? rulesLine(editionOf(campaign), campaign.sources ?? []) : null,
      messages,
      order,
      budget,
      maxReplyTokens: backend?.generation.maxTokens ?? 800,
      tokenizer,
      autoState: speaker === 'dm' && s.prompt.autoState && !!character?.card.dnd && !self
    })
    // Extensions may add or change blocks (only when the "extensions" block is on; not in the shared party prompt).
    if (!partyMode && s.prompt.blocks.some((b) => b.id === 'extensions' && b.enabled)) {
      const blocks = await extensionHost.applyPromptBuild(prompt.blocks, sessionPath)
      if (blocks !== prompt.blocks) {
        const system = blocks.filter((b) => b.id !== 'history').map((b) => b.content).join('\n\n')
        const historyTokens = blocks.find((b) => b.id === 'history')?.tokens ?? 0
        prompt.blocks = blocks
        prompt.system = system
        prompt.totalTokens = estimateTokens(system, tokenizer) + historyTokens
      }
    }
    const ownLabel = turnName ?? 'DM'
    const stop = partyMode ? ['DM', ...partyNames].filter((n) => n !== ownLabel).map((n) => `\n${n}:`) : undefined
    return { session, character, prompt, persona, speaker, speakerName: turnName ?? speakerName, ...(stop ? { stop } : {}) }
  }

  /**
   * The prompt the next request would send. `view` picks whose prompt to show
   * (the DM, the character, or a companion); by default it's whoever writes next.
   */
  async inspect(sessionPath: VaultPath, view: { speaker?: Speaker; as?: VaultPath } = {}): Promise<PromptPreview> {
    const s = settingsForSession(sessionPath)
    const backend = backendChain(s)[0]
    if (!backend) throw new AppError('NO_BACKEND', 'Add a text backend in Settings first.')
    const { prompt, session, speaker } = await this.context(sessionPath, { backend, ...(view.speaker ? { speaker: view.speaker } : {}), ...(view.as ? { as: view.as } : {}) })
    const window = await effectiveContext(backend)
    const resolved = resolveTextBackend(backend)
    const req = redactRequest(textAdapter(backend.type).prepare(resolved, { system: prompt.system, messages: prompt.messages }, backend.generation.stream))

    // Who the AI can write as in this session, so the inspector can switch between their prompts.
    const mode = playModeOf(session.frontmatter)
    const vault = vaultService.require()
    const firstPath = session.frontmatter.characters[0] ? await resolveCharacterLink(vault, session.frontmatter.characters[0]).catch(() => null) : null
    const first = firstPath ? await readCharacter(vault, firstPath).catch(() => null) : null
    const views: PromptView[] = []
    if (mode !== 'user-dm') views.push({ key: 'dm', label: 'DM', speaker: 'dm' })
    if (mode !== 'ai-dm') views.push({ key: 'player', label: first?.card.name || session.frontmatter.persona || s.general.playerName || 'Character', speaker: 'player' })
    if (mode !== 'user-dm') for (const c of await this.companions(session)) views.push({ key: `as:${c.path}`, label: c.card.name, speaker: 'player', as: c.path })

    // The history block only says how many messages fit; show the messages themselves.
    const blocks = prompt.blocks.map((b) => ({ ...b }))
    const history = blocks.find((b) => b.id === 'history')
    const counts = /^(\d+) of (\d+) messages/.exec(history?.content ?? '')
    if (history && prompt.messages.length && !/transcript/i.test(history.label)) {
      history.content = `${history.content}\n\n${prompt.messages.map((m) => `[${m.role}]\n${m.content}`).join('\n\n')}`
    }
    const historyTokens = history?.tokens ?? 0
    return {
      backendId: backend.id,
      backendName: backend.name,
      url: req.url,
      headers: req.headers,
      body: req.body,
      blocks,
      totalTokens: prompt.totalTokens,
      budget: Math.min(s.prompt.contextBudget || window, window),
      view: view.as ? `as:${view.as}` : speaker,
      views,
      stats: {
        mode,
        model: backend.model,
        window,
        replyTokens: backend.generation.maxTokens,
        systemTokens: Math.max(0, prompt.totalTokens - historyTokens),
        historyTokens,
        messagesKept: counts ? Number(counts[1]) : prompt.messages.length,
        messagesTotal: counts ? Number(counts[2]) : prompt.messages.length
      }
    }
  }

  /**
   * Posts the user's text, in their role for the session's mode (their
   * character, the DM, or a director's note in AI-only play), then starts the
   * next AI reply.
   */
  async send(sessionPath: VaultPath, text: string, persona?: string, speaker?: Speaker, as?: string): Promise<{ requestId: string }> {
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
    if (!speaker && !as && mode === 'ai-only' && session.frontmatter.companions?.length) {
      // AI-only party: the character, each companion, then the DM.
      const party = await this.partyOrder(session)
      if (party.length > 1) {
        const turn = nextPartyTurn(session.messages, party.map((c) => c.card.name))
        return this.start('new', sessionPath, newMessageId(), turn.speaker, turn.index !== undefined ? party[turn.index]!.path : undefined)
      }
    }
    return this.start('new', sessionPath, newMessageId(), speaker ?? nextSpeaker(mode, session.messages), as)
  }

  /** The session's characters, then its companions. */
  private async partyOrder(session: Session): Promise<CharacterNote[]> {
    const vault = vaultService.require()
    const paths = await Promise.all(session.frontmatter.characters.map((l) => resolveCharacterLink(vault, l).catch(() => null)))
    const players = (await Promise.all(paths.map((p) => (p ? readCharacter(vault, p).catch(() => null) : null)))).filter((n): n is CharacterNote => !!n)
    const companions = await this.companions(session)
    return [...players, ...companions.filter((c) => !players.some((p) => p.path === c.path))]
  }

  /** The session's AI companions, read from their notes (missing ones skipped). */
  private async companions(session: Session): Promise<CharacterNote[]> {
    const vault = vaultService.require()
    const links = session.frontmatter.companions ?? []
    const paths = await Promise.all(links.map((l) => resolveCharacterLink(vault, l).catch(() => null)))
    const notes = await Promise.all(paths.map((p) => (p ? readCharacter(vault, p).catch(() => null) : null)))
    return notes.filter((n): n is CharacterNote => !!n)
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

  private start(kind: JobKind, sessionPath: VaultPath, messageId: string, speaker: Speaker, as?: string): { requestId: string } {
    if (this.isBusy(sessionPath)) throw new AppError('BUSY', 'A reply is already being written for this session.')
    if (settingsStore.get().textBackends.length === 0) throw new AppError('NO_BACKEND', 'Add a text backend in Settings first.')
    const job: Job = { requestId: randomUUID(), kind, sessionPath, messageId, speaker, ...(as ? { as } : {}), controller: new AbortController() }
    this.jobs.set(job.requestId, job)
    const finished = this.run(job).finally(() => {
      this.jobs.delete(job.requestId)
      // Kept a little longer so a waiter that looks it up late still finds it.
      setTimeout(() => this.finished.delete(job.requestId), 60_000)
      if (this.jobs.size === 0) getMainWindow()?.setProgressBar(-1)
    })
    this.finished.set(job.requestId, finished)
    return { requestId: job.requestId }
  }

  /** Whether each running reply ended well (not stopped, no error). */
  private finished = new Map<string, Promise<boolean>>()

  /** Starts an AI reply and waits for it; false when it failed or was stopped. */
  async replyAndWait(sessionPath: VaultPath, speaker?: Speaker, as?: string): Promise<boolean> {
    const { requestId } = await this.send(sessionPath, '', undefined, speaker, as)
    return (await this.finished.get(requestId)) ?? false
  }

  private async run(job: Job): Promise<boolean> {
    const win = getMainWindow()
    const vault = vaultService.require()
    const s = settingsForSession(job.sessionPath)
    const chain = backendChain(s)
    let streamed = ''
    let result: GenerateResult | null = null
    let used: TextBackend | null = null
    let speakerName = job.speaker === 'dm' ? 'DM' : ''
    let lastError: unknown = null
    win?.setProgressBar(2) // indeterminate on the taskbar

    for (const backend of chain) {
      try {
        const ctx = await this.context(job.sessionPath, { upto: job.kind === 'swipe' ? job.messageId : undefined, backend, speaker: job.speaker, ...(job.as ? { as: job.as } : {}) })
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
          { system: ctx.prompt.system, messages: turns, userLabel: ctx.persona, assistantLabel: ctx.speakerName, ...(ctx.stop ? { stop: ctx.stop } : {}) },
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
    const { text: stated, changes } = extractState(raw)
    const text = stripSpeakerLabel(stated, speakerName || 'DM')

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
      if (session && !aborted) void this.maybeCompress(job.sessionPath).then((done) => (done ? undefined : this.maybeSummarize(job.sessionPath)))
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
        return !aborted
      }
    } catch (err) {
      send(win, 'chat:error', { requestId: job.requestId, error: toErrorInfo(err) })
    }
    return false
  }

  private summarizing = new Set<string>()

  /**
   * Auto-compress: once the next prompt would fill `autoCompressAt`% of the
   * context window, or older messages are already being cut to fit, fold all
   * but the newest few into the session summary. Returns true when it did.
   */
  async maybeCompress(sessionPath: VaultPath): Promise<boolean> {
    const s = settingsForSession(sessionPath)
    if (!s.prompt.autoCompressAt || !summaryInPrompt(s) || this.summarizing.has(sessionPath)) return false
    try {
      const backend = backendChain(s)[0]
      if (!backend) return false
      const { prompt } = await this.context(sessionPath, { backend })
      const window = await effectiveContext(backend)
      const budget = Math.min(s.prompt.contextBudget || window, window)
      if (!shouldCompress(prompt, budget, s.prompt.autoCompressAt)) return false
      await this.maybeSummarize(sessionPath, true)
      return true
    } catch (err) {
      console.warn('[chat] auto-compress check failed:', toErrorInfo(err).message)
      return false
    }
  }

  /**
   * Rolling memory: once `summaryEvery` messages have piled up since the last
   * summary, fold all but the newest few into the session's `summary`
   * frontmatter, using the "summaries" backend.
   */
  async maybeSummarize(sessionPath: VaultPath, force = false): Promise<void> {
    const s = settingsForSession(sessionPath)
    if ((!s.prompt.summaryEvery && !force) || this.summarizing.has(sessionPath)) return
    let backend = backendChain(s, 'summary')[0]
    if (!backend) return
    this.summarizing.add(sessionPath)
    try {
      const vault = vaultService.require()
      const session = await readSession(vault, sessionPath)
      // The world's own summary model, in the summaries backend (see world.ts).
      backend = withModel([backend], worldOf(session.campaignPath)?.summary_model)[0] ?? backend
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
