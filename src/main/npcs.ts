/**
 * Finds the NPC notes that belong to a campaign (see shared/npcs.ts for the
 * rule) and reads them, for the lorebook block of the prompt.
 */
import { extractLinks, makeResolver } from '@shared/graph'
import { CAMPAIGN_FILE } from '@shared/layout'
import { joinVaultPath } from '@shared/names'
import { normalizeCard } from '@shared/notes'
import { npcBelongsTo, npcCampaigns } from '@shared/npcs'
import type { CharacterCard, VaultIndex, VaultPath } from '@shared/types'
import { parseNote } from './vault/frontmatter'
import type { Vault } from './vault/vault'

export interface CampaignNpc {
  path: VaultPath
  card: CharacterCard
  body: string
}

/** Resolves links between notes and reads which notes each campaign note links to. */
async function linkContext(vault: Vault, index: VaultIndex): Promise<{ target: (link: string, from: string) => string; campaigns: { folder: string; links: string[]; universe?: string }[] }> {
  const campaignNotes = index.campaigns.map((c) => ({ folder: c.path, note: joinVaultPath(c.path, CAMPAIGN_FILE), universe: c.universe }))
  const resolve = makeResolver([
    ...index.npcs.map((n) => n.path),
    ...index.characters.map((c) => c.path),
    ...index.sessions.map((s) => s.path),
    ...index.lorebooks.map((l) => l.path),
    ...campaignNotes.map((c) => c.note)
  ])
  // A link that doesn't resolve to a known note (the party note, a map…) still counts by its path.
  const target = (link: string, from: string): string => resolve(link, from) ?? link.replace(/\.md$/i, '')

  const campaigns = await Promise.all(
    campaignNotes.map(async (c) => {
      const file = await vault.readIfExists(c.note).catch(() => null)
      return { folder: c.folder, links: file ? extractLinks(file.content).map((l) => target(l, c.note)) : [], ...(c.universe ? { universe: c.universe } : {}) }
    })
  )
  return { target, campaigns }
}

/** The campaign folders a character or NPC note is tied to; empty when it can turn up anywhere. */
export async function noteCampaigns(vault: Vault, index: VaultIndex | null, notePath: VaultPath): Promise<VaultPath[]> {
  if (!index?.campaigns.length) return []
  const file = await vault.readIfExists(notePath).catch(() => null)
  if (!file) return []
  const { target, campaigns } = await linkContext(vault, index)
  return npcCampaigns(notePath, extractLinks(file.content).map((l) => target(l, notePath)), campaigns)
}

export async function campaignNpcs(vault: Vault, index: VaultIndex | null, campaignFolder: VaultPath): Promise<CampaignNpc[]> {
  if (!index?.npcs.length) return []
  const { target, campaigns } = await linkContext(vault, index)

  const npcs = await Promise.all(
    index.npcs.map(async (ref): Promise<CampaignNpc | null> => {
      const file = await vault.readIfExists(ref.path).catch(() => null)
      if (!file) return null
      const links = extractLinks(file.content).map((l) => target(l, ref.path))
      if (!npcBelongsTo(campaignFolder, npcCampaigns(ref.path, links, campaigns))) return null
      try {
        const { data, body } = parseNote(file.content)
        return { path: ref.path, card: normalizeCard(data, ref.name), body }
      } catch {
        return null
      }
    })
  )
  return npcs.filter((n): n is CampaignNpc => !!n && !!n.card.name.trim())
}
