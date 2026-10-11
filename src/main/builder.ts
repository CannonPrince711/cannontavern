/**
 * Campaign builder: asks the chat model for a draft campaign, then writes the
 * reviewed draft into the vault as ordinary notes (campaign, party, lorebook,
 * NPCs and an optional first session). Existing notes are never overwritten.
 */
import { BUILDER_SYSTEM, builderPrompt, draftCampaignBody, draftLore, parseDraft, type CampaignConcept, type CampaignDraft } from '@shared/builder'
import { FOLDERS, CAMPAIGN_FILE } from '@shared/layout'
import { joinVaultPath, sanitizeFileName, toWikilink } from '@shared/names'
import { serializeLorebookBody } from '@shared/notes'
import type { PlayMode } from '@shared/play'
import { SOURCEBOOKS, type Edition } from '@shared/editions'
import type { VaultPath } from '@shared/types'
import { backendChain } from './backends/chain'
import { resolveTextBackend, textAdapter } from './backends/text'
import { AppError } from './errors'
import { createCampaign, readCharacter, saveParty } from './library'
import { createSession } from './sessions'
import { saveMap } from './maps'
import { autoLayout } from '@shared/map'
import { settingsStore } from './settings-store'
import { serializeNote, updateNote } from './vault/frontmatter'
import { vaultService } from './vault/service'

export async function draftCampaign(concept: CampaignConcept): Promise<CampaignDraft> {
  const s = settingsStore.get()
  const chain = backendChain(s, 'chat')
  if (!chain.length) throw new AppError('NO_BACKEND', 'Add a text backend in Settings first, or fill in the campaign by hand.')
  let lastError: unknown = null
  for (const backend of chain) {
    try {
      const result = await textAdapter(backend.type).generate(
        resolveTextBackend(backend),
        { system: BUILDER_SYSTEM, messages: [{ role: 'user', content: builderPrompt(concept) }], maxTokens: Math.max(4000, Math.min(backend.generation.maxTokens * 4, 8000)) },
        { stream: false }
      )
      const draft = parseDraft(result.text)
      if (!draft.name.trim()) draft.name = concept.name.trim() || 'Untitled Campaign'
      return draft
    } catch (err) {
      lastError = err instanceof Error && !(err instanceof AppError) ? new AppError('BAD_DRAFT', err.message) : err
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
