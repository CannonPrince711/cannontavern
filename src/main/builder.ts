/**
 * Campaign builder: asks the chat model for a draft campaign, then writes the
 * reviewed draft into the vault as ordinary notes (campaign, party, lorebook,
 * NPCs and an optional first session). Existing notes are never overwritten.
 */
import { BUILDER_SYSTEM, builderPrompt, draftCampaignBody, draftLore, draftSection, parseDraft, type CampaignConcept, type CampaignDraft } from '@shared/builder'
import { FOLDERS, CAMPAIGN_FILE } from '@shared/layout'
import { joinVaultPath, sanitizeFileName, toWikilink } from '@shared/names'
import { serializeLorebookBody } from '@shared/notes'
import type { PlayMode } from '@shared/play'
import { SOURCEBOOKS, type Edition } from '@shared/editions'
import type { VaultPath } from '@shared/types'
import { backendChain } from './backends/chain'
import { effectiveContext } from './backends/context'
import { resolveTextBackend, textAdapter } from './backends/text'
import { AppError } from './errors'
import { createCampaign, readCharacter, saveParty } from './library'
import { createSession } from './sessions'
import { saveMap } from './maps'
import { autoLayout } from '@shared/map'
import { settingsStore } from './settings-store'
import { send } from './ipc'
import { getMainWindow } from './window'
import { serializeNote, updateNote } from './vault/frontmatter'
import { vaultService } from './vault/service'

/** The draft being written, so Cancel can stop it. */
let drafting: AbortController | null = null

export function cancelDraft(): void {
  drafting?.abort()
}

export async function draftCampaign(concept: CampaignConcept): Promise<CampaignDraft> {
  drafting?.abort()
  const controller = new AbortController()
  drafting = controller
  try {
    return await draft(concept, controller.signal)
  } finally {
    if (drafting === controller) drafting = null
  }
}

async function draft(concept: CampaignConcept, signal: AbortSignal): Promise<CampaignDraft> {
  const s = settingsStore.get()
  const chain = backendChain(s, 'chat')
  if (!chain.length) throw new AppError('NO_BACKEND', 'Add a text backend in Settings first, or fill in the campaign by hand.')
  let lastError: unknown = null
  let lastReply = ''
  for (const backend of chain) {
    const window = await effectiveContext(backend)
    // A full campaign first; if the reply can't be read, a smaller one (easier for small models).
    for (const compact of [false, true]) {
      const prompt = builderPrompt(concept, { compact })
      // Leave the reply room inside the model's context window.
      const promptTokens = Math.ceil((BUILDER_SYSTEM.length + prompt.length) / 3.5)
      const room = window - promptTokens - 64
      if (room < 800) {
        // The request alone would fill the model's window: say so rather than send something that gets cut.
        lastError = new AppError(
          'PROMPT_TOO_LONG',
          `The premise is too long for this model: the request is about ${promptTokens.toLocaleString('en-US')} tokens, and its context window is ${window.toLocaleString('en-US')}. Shorten the premise, or raise the server's context size.`
        )
        if (compact) break
        continue
      }
      const maxTokens = Math.max(800, Math.min(6000, room))
      // Stream the reply (when the backend streams) so the builder can show how far along it is.
      const streaming = backend.generation.stream
      let text = ''
      let sent = 0
      const progress = (force = false): void => {
        if (!force && Date.now() - sent < 250) return
        sent = Date.now()
        send(getMainWindow(), 'campaigns:draftProgress', { chars: text.length, tokens: Math.round(text.length / 3.5), maxTokens, section: draftSection(text), attempt: compact ? 'compact' : 'full', streaming })
      }
      progress(true)
      try {
        // Streaming resets the timeout with every token; a reply that only arrives at the end gets 10 minutes.
        const resolved = resolveTextBackend(backend)
        const net = streaming ? resolved.net : { ...resolved.net, timeoutMs: Math.max(resolved.net.timeoutMs, 600_000) }
        const result = await textAdapter(backend.type).generate(
          { ...resolved, net },
          { system: BUILDER_SYSTEM, messages: [{ role: 'user', content: prompt }], maxTokens },
          { stream: streaming, signal, onToken: (delta) => ((text += delta), progress()) }
        )
        lastReply = result.text
        const draft = parseDraft(result.text)
        if (!draft.name.trim()) draft.name = concept.name.trim() || 'Untitled Campaign'
        return draft
      } catch (err) {
        if (err instanceof AppError) {
          // Connection or backend errors: no point in a smaller request on this backend.
          lastError = err
          break
        }
        lastError = new AppError(
          'BAD_DRAFT',
          `${err instanceof Error ? err.message : String(err)} Try again, pick a larger model in the model switcher, or fill the campaign in by hand.`,
          lastReply ? `The model replied:\n${lastReply.slice(0, 1500)}` : undefined
        )
      }
    }
  }
  throw lastError
}

export interface BuildOptions {
  mode: PlayMode
  edition?: Edition
  /** Create "Session 01" (opening with the draft's scene unless you are the DM). */
  session: boolean
  characterPath?: VaultPath
}

export async function buildCampaign(draft: CampaignDraft, opts: BuildOptions): Promise<{ campaignPath: VaultPath; sessionPath: VaultPath | null }> {
  const vault = vaultService.require()
  const s = settingsStore.get()
  const name = draft.name.trim()
  if (!name) throw new AppError('NO_NAME', 'Give the campaign a name first.')

  const campaign = await createCampaign(vault, name, {
    setting: draft.setting.trim(),
    tone: draft.tone.trim(),
    house_rules: draft.houseRules.trim(),
    body: draftCampaignBody(draft)
  })

  const campaignLink = toWikilink(joinVaultPath(campaign.path, CAMPAIGN_FILE), { full: true, alias: name })

  // Lorebook with what players may learn; linked from Campaign.md.
  const lore = draftLore(draft)
  const links: string[] = []
  if (lore.length) {
    const lorePath = await vault.uniquePath(vault.rootPath(FOLDERS.lorebooks), `${sanitizeFileName(name)} Lore`, '.md')
    await vault.write(
      lorePath,
      serializeNote({ type: 'lorebook', name: `${name} Lore` }, serializeLorebookBody(`World notes for ${campaignLink}. Each “## Heading” is an entry the DM sees when a trigger word comes up.`, lore)),
      { baseHash: null }
    )
    links.push(toWikilink(lorePath, { full: true }))
  }
  await vault.mutate(joinVaultPath(campaign.path, CAMPAIGN_FILE), (cur) =>
    cur === null
      ? null
      : updateNote(cur, {
          lorebooks: links,
          ...(opts.mode !== 'ai-dm' ? { mode: opts.mode } : {}),
          ...(opts.edition && opts.edition !== '5e' ? { edition: opts.edition, sources: SOURCEBOOKS[opts.edition].filter((b) => b.core).map((b) => b.name) } : {})
        })
  )

  await saveParty(vault, campaign.path, {
    gold: 0,
    inventory: [],
    quests: draft.quests.map((title) => ({ title: title.trim(), status: 'active' as const })),
    body: '\n# Party\n\nShared notes, loot and leads.\n'
  })

  // One note per NPC, with their secret kept for the DM.
  const tag = sanitizeFileName(name).toLowerCase().replace(/\s+/g, '-')
  for (const npc of draft.npcs) {
    const path = vault.rootPath(FOLDERS.npcs, `${sanitizeFileName(npc.name.trim())}.md`)
    if (await vault.exists(path)) continue
    const body = [
      `# ${npc.name.trim()}`,
      npc.role.trim() ? `*${npc.role.trim()}* in ${campaignLink}` : `In ${campaignLink}`,
      npc.want.trim() && `- **Wants:** ${npc.want.trim()}`,
      npc.secret.trim() && `- **Secret (DM only):** ${npc.secret.trim()}`
    ].filter(Boolean)
    await vault.write(
      path,
      serializeNote({ type: 'npc', name: npc.name.trim(), description: npc.description.trim(), personality: npc.personality.trim(), tags: ['npc', tag] }, `\n${body.join('\n\n')}\n`),
      { baseHash: null }
    )
  }

  // A starter map: the locations laid out on a grid, the party at the first one.
  if (draft.locations.length) {
    const places = draft.locations.map((l) => l.name.trim()).filter(Boolean)
    const spots = autoLayout(places)
    const pins = places.map((name, i) => ({ id: `loc${i + 1}`, name, x: spots[i]!.x, y: spots[i]!.y, kind: 'location' as const, description: draft.locations[i]!.description.trim().slice(0, 300), note: undefined }))
    await saveMap(vault, campaign.path, { image: '', pins, party: pins[0] ? { x: pins[0].x, y: pins[0].y, at: pins[0].id } : null })
  }

  let sessionPath: VaultPath | null = null
  if (opts.session) {
    const character = opts.characterPath ? await readCharacter(vault, opts.characterPath).catch(() => null) : null
    const session = await createSession(vault, {
      campaignPath: campaign.path,
      characterPath: character?.path,
      characterName: character?.card.name,
      persona: character?.card.name,
      title: 'Session 01',
      dateFormat: s.general.sessionDateFormat,
      // The draft's opening scene starts the session (when the AI runs the game).
      firstMessage: draft.opening.trim() || undefined,
      mode: opts.mode
    })
    sessionPath = session.path
  }

  for (const p of await vault.walk(vault.rootFolder, (x) => x.endsWith('.md'))) await vaultService.reindex(p)
  return { campaignPath: campaign.path, sessionPath }
}
