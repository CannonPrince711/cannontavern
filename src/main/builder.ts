/**
 * Campaign builder: asks the chat model for a draft campaign, then writes the
 * reviewed draft into the vault as ordinary notes (campaign, party, lorebook,
 * NPCs and an optional first session). Existing notes are never overwritten.
 */
import {
  adultRuleFrom,
  BUILDER_SYSTEM,
  DRAFT_PIECES,
  draftCampaignBody,
  draftLore,
  emptyDraft,
  mergePiece,
  piecePrompt,
  type CampaignConcept,
  type CampaignDraft,
  type DraftPiece
} from '@shared/builder'
import { FOLDERS, CAMPAIGN_FILE } from '@shared/layout'
import { joinVaultPath, sanitizeFileName, toWikilink } from '@shared/names'
import { serializeLorebookBody } from '@shared/notes'
import type { PlayMode } from '@shared/play'
import { SOURCEBOOKS, type Edition } from '@shared/editions'
import { readRuleset, rulesetValue } from './rulesets'
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
  let d = emptyDraft(concept.name.trim())
  const failed: string[] = []
  for (const [i, piece] of DRAFT_PIECES.entries()) {
    try {
      d = await writePiece(concept, d, piece.id, signal, { step: i + 1, steps: DRAFT_PIECES.length })
    } catch (err) {
      // Without an overview there's nothing to build on; a missing list can be redrafted or written by hand.
      if (signal.aborted || piece.id === 'overview') throw err
      failed.push(piece.label)
    }
  }
  if (!d.name.trim()) d.name = concept.name.trim() || 'Untitled Campaign'
  if (failed.length) {
    send(getMainWindow(), 'toast', {
      level: 'warning',
      title: `Couldn’t write ${failed.join(', ')}`,
      detail: 'Press Redraft on that section in the review, or fill it in by hand.'
    })
  }
  return d
}

/** Redoes one piece of a draft from the review step, keeping the rest. */
export async function redraftPiece(concept: CampaignConcept, current: CampaignDraft, piece: DraftPiece): Promise<CampaignDraft> {
  drafting?.abort()
  const controller = new AbortController()
  drafting = controller
  try {
    return await writePiece(concept, current, piece, controller.signal, { step: 1, steps: 1 })
  } finally {
    if (drafting === controller) drafting = null
  }
}

/**
 * Writes one piece of the campaign with the first backend that answers. A reply
 * that can't be read gets one more try; connection errors move on to the next
 * backend in the chain.
 */
async function writePiece(concept: CampaignConcept, d: CampaignDraft, piece: DraftPiece, signal: AbortSignal, at: { step: number; steps: number }): Promise<CampaignDraft> {
  const chain = backendChain(settingsStore.get(), 'chat')
  if (!chain.length) throw new AppError('NO_BACKEND', 'Add a text backend in Settings first, or fill in the campaign by hand.')
  const label = DRAFT_PIECES.find((p) => p.id === piece)!.label
  const prompt = piecePrompt(concept, d, piece, adultRuleFrom(settingsStore.get().extensions.settings['mature-mode']))
  let lastError: unknown = null
  let lastReply = ''
  for (const backend of chain) {
    const window = await effectiveContext(backend)
    // Leave the reply room inside the model's context window.
    const promptTokens = Math.ceil((BUILDER_SYSTEM.length + prompt.length) / 3.5)
    const room = window - promptTokens - 64
    if (room < 600) {
      throw new AppError(
        'PROMPT_TOO_LONG',
        `The premise is too long for this model: the request is about ${promptTokens.toLocaleString('en-US')} tokens, and its context window is ${window.toLocaleString('en-US')}. Shorten the premise, or raise the server's context size.`
      )
    }
    // Each piece is small: well under a server's reply cap (KoboldCpp stops at 2048).
    const maxTokens = Math.min(2000, room)
    const streaming = backend.generation.stream
    // Streaming resets the timeout with every token; a reply that only arrives at the end gets 10 minutes.
    const resolved = resolveTextBackend(backend)
    const net = streaming ? resolved.net : { ...resolved.net, timeoutMs: Math.max(resolved.net.timeoutMs, 600_000) }
    for (const retry of [false, true]) {
      let text = ''
      let sent = 0
      const progress = (force = false): void => {
        if (!force && Date.now() - sent < 250) return
        sent = Date.now()
        send(getMainWindow(), 'campaigns:draftProgress', {
          chars: text.length,
          tokens: Math.round(text.length / 3.5),
          maxTokens,
          section: label,
          attempt: retry ? 'compact' : 'full',
          streaming,
          step: at.step,
          steps: at.steps
        })
      }
      progress(true)
      try {
        const result = await textAdapter(backend.type).generate(
          { ...resolved, net },
          { system: BUILDER_SYSTEM, messages: [{ role: 'user', content: retry ? `${prompt}\n\nReply with the JSON object only, nothing else.` : prompt }], maxTokens },
          { stream: streaming, signal, onToken: (delta) => ((text += delta), progress()) }
        )
        lastReply = result.text
        return mergePiece(d, piece, result.text)
      } catch (err) {
        if (err instanceof AppError) {
          // Connection or backend errors: try the next backend.
          lastError = err
          break
        }
        lastError = new AppError(
          'BAD_DRAFT',
          `${err instanceof Error ? err.message : String(err)} Try again, pick a larger model in the model switcher, or fill it in by hand.`,
          lastReply ? `The model replied:\n${lastReply.slice(0, 1500)}` : undefined
        )
      }
    }
    if ((lastError as { code?: string })?.code === 'ABORTED') break
  }
  throw lastError
}

export interface BuildOptions {
  mode: PlayMode
  edition?: Edition
  /** Ruleset id or note path (see rulesets.ts). */
  ruleset?: string
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
  const ruleset = opts.ruleset ? await readRuleset(vault, opts.ruleset) : null
  await vault.mutate(joinVaultPath(campaign.path, CAMPAIGN_FILE), (cur) =>
    cur === null
      ? null
      : updateNote(cur, {
          lorebooks: links,
          ...(opts.mode !== 'ai-dm' ? { mode: opts.mode } : {}),
          ...(ruleset && !ruleset.sourcebooks
            ? { ruleset: rulesetValue(ruleset), ...(ruleset.engine !== '5e' ? { edition: ruleset.engine } : {}) }
            : opts.edition && opts.edition !== '5e'
              ? { edition: opts.edition, sources: SOURCEBOOKS[opts.edition].filter((b) => b.core).map((b) => b.name) }
              : {})
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
