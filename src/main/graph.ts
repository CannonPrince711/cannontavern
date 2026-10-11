/** Builds the note graph for the graph view from the vault and its index. */
import { buildGraph, type VaultGraph } from '@shared/graph'
import { CAMPAIGN_FILE } from '@shared/layout'
import { joinVaultPath } from '@shared/names'
import { vaultService } from './vault/service'

export async function buildVaultGraph(): Promise<VaultGraph> {
  const vault = vaultService.require()
  const index = vaultService.getIndex()
  const allPaths = await vault.walkVault((p) => p.toLowerCase().endsWith('.md'))
  const inRoot = allPaths.filter((p) => vault.isInRoot(p))
  const files = await Promise.all(inRoot.map(async (path) => ({ path, content: (await vault.readIfExists(path).catch(() => null))?.content ?? '' })))

  const labels = new Map<string, string>()
  if (index) {
    for (const c of [...index.characters, ...index.npcs]) labels.set(c.path, c.displayName)
    for (const c of index.campaigns) labels.set(joinVaultPath(c.path, CAMPAIGN_FILE), c.displayName)
    for (const s of index.sessions) labels.set(s.path, s.title)
    for (const l of index.lorebooks) labels.set(l.path, l.name)
    for (const p of index.presets) labels.set(p.path, p.name)
  }
  return buildGraph({ rootFolder: vault.rootFolder, allPaths, files, labels })
}
