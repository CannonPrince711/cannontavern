import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { classifyPath, isSharedLorebook } from '../src/shared/layout'
import { parseWorld, worldGroups } from '../src/shared/world'
import { createResources, ensureResources, resourceImages } from '../src/main/resources'
import { VaultIndexer } from '../src/main/vault/indexer'
import { Vault } from '../src/main/vault/vault'

let dir: string
let vault: Vault

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dnd-resources-'))
  vault = new Vault({ vaultPath: dir, rootFolder: 'DND Tavern' })
  await vault.mkdir('DND Tavern')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('shared Resources folder', () => {
  it('treats Resources/Lore notes as shared lorebooks', () => {
    expect(classifyPath('DND Tavern', 'DND Tavern/Resources/Lore/Creatures.md')).toEqual({ kind: 'lorebook' })
    expect(classifyPath('DND Tavern', 'DND Tavern/Resources/About Resources.md')).toBeNull()
    expect(classifyPath('DND Tavern', 'DND Tavern/Resources/Images/Maps/x.md')).toBeNull()
    expect(isSharedLorebook('DND Tavern', 'DND Tavern/Resources/Lore/Creatures.md')).toBe(true)
    expect(isSharedLorebook('DND Tavern', 'DND Tavern/Lorebooks/Creatures.md')).toBe(false)
  })

  it('writes the starter lorebooks once, and indexes them as shared', async () => {
    await ensureResources(vault)
    const index = new VaultIndexer(vault, { vaultName: 'test', isObsidianVault: false })
    await index.build()
    const shared = index.snapshot().lorebooks.filter((l) => l.shared)
    expect(shared.map((l) => l.name).sort()).toEqual(['Creatures', 'Gear and Prices', 'Settlements and Services', 'Townsfolk'])
    expect(shared.every((l) => l.entryCount > 0)).toBe(true)
  })

  it('stays deleted once removed, and never overwrites an edited note', async () => {
    await ensureResources(vault)
    const creatures = join(dir, 'DND Tavern', 'Resources', 'Lore', 'Creatures.md')
    await writeFile(creatures, '---\ntype: lorebook\n---\n## My own\nkeys:: mine\n\nEdited.\n')
    await rm(join(dir, 'DND Tavern', 'Resources', 'Lore', 'Townsfolk.md'))
    await ensureResources(vault)
    expect(await vault.exists('DND Tavern/Resources/Lore/Townsfolk.md')).toBe(false)
    expect(await readFile(creatures, 'utf8')).toContain('Edited.')
    // Restoring on request brings back only what's missing.
    await createResources(vault)
    expect(await vault.exists('DND Tavern/Resources/Lore/Townsfolk.md')).toBe(true)
    expect(await readFile(creatures, 'utf8')).toContain('Edited.')
  })

  it('lists shared images for the image choosers', async () => {
    await createResources(vault)
    await writeFile(join(dir, 'DND Tavern', 'Resources', 'Images', 'Maps', 'harbour.png'), 'x')
    await writeFile(join(dir, 'DND Tavern', 'Resources', 'Images', 'notes.txt'), 'x')
    const images = await resourceImages(vault, (n) => n.endsWith('.png'))
    expect(images).toEqual(['DND Tavern/Resources/Images/Maps/harbour.png'])
  })

  it('lets a world opt out of the shared lore', () => {
    expect(parseWorld({ shared_resources: false })).toEqual({ shared_resources: false })
    expect(worldGroups({ shared_resources: false })).toEqual(['prompt'])
  })
})
