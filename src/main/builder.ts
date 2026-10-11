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
import type { VaultPath } from '@shared/types'
import { backendChain } from './backends/chain'
import { resolveTextBackend, textAdapter } from './backends/text'
import { AppError } from './errors'
import { createCampaign, readCharacter, saveParty } from './library'
import { createSession } from './sessions'
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
    cur === null ? null : updateNote(cur, { lorebooks: links, ...(opts.mode !== 'ai-dm' ? { mode: opts.mode } : {}) })
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
