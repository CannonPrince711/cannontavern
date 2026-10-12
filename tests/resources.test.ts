import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { classifyPath, isSharedLorebook } from '../src/shared/layout'
import { parseWorld, worldGroups } from '../src/shared/world'
import { createResources, ensureResources, resourceImages, starterFiles } from '../src/main/resources'
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

  it('refreshes starter notes an update changed, unless the user edited or deleted them', async () => {
    await ensureResources(vault)
    const v2 = starterFiles().map((f) => ({ ...f, content: f.content.replace('Change prices to suit your world.', 'Prices updated.').replace('Small, cunning raiders', 'Sly raiders') }))
    const creatures = join(dir, 'DND Tavern', 'Resources', 'Lore', 'Creatures.md')
    const gear = join(dir, 'DND Tavern', 'Resources', 'Lore', 'Gear and Prices.md')
    await writeFile(creatures, '---\ntype: lorebook\n---\n## Mine\nkeys:: mine\n\nEdited.\n')
    await rm(join(dir, 'DND Tavern', 'Resources', 'Lore', 'Townsfolk.md'))
    const extra = { rel: 'Resources/Lore/Factions.md', content: '---\ntype: lorebook\nname: Factions\n---\n' }
    await ensureResources(vault, [...v2, extra])
    expect(await readFile(gear, 'utf8')).toContain('Prices updated.')
    expect(await readFile(creatures, 'utf8')).toContain('Edited.')
    expect(await vault.exists('DND Tavern/Resources/Lore/Townsfolk.md')).toBe(false)
    expect(await vault.exists('DND Tavern/Resources/Lore/Factions.md')).toBe(true)
    // The next update refreshes the gear note again: its new text is now the recorded one.
    await ensureResources(vault, v2.map((f) => ({ ...f, content: f.content.replace('Prices updated.', 'Prices v3.') })))
    expect(await readFile(gear, 'utf8')).toContain('Prices v3.')
  })

  it('moves an older vault over without touching edited or deleted notes', async () => {
    await ensureResources(vault)
    // The marker used to be prose, with no hashes.
    await writeFile(join(dir, 'DND Tavern', '.resources-created'), 'Remembers that DND Tavern already set up the Resources folder in this vault.\n')
    const creatures = join(dir, 'DND Tavern', 'Resources', 'Lore', 'Creatures.md')
    await writeFile(creatures, '---\ntype: lorebook\n---\nEdited.\n')
    await rm(join(dir, 'DND Tavern', 'Resources', 'Lore', 'Townsfolk.md'))
    await ensureResources(vault)
    const v2 = starterFiles().map((f) => ({ ...f, content: `${f.content}\nNew line.\n` }))
    await ensureResources(vault, v2)
    expect(await readFile(join(dir, 'DND Tavern', 'Resources', 'Lore', 'Gear and Prices.md'), 'utf8')).toContain('New line.')
    expect(await readFile(creatures, 'utf8')).not.toContain('New line.')
    expect(await vault.exists('DND Tavern/Resources/Lore/Townsfolk.md')).toBe(false)
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
