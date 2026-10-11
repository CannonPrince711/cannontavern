import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { VaultIndexer } from '../src/main/vault/indexer'
import { Vault, VaultConflictError, hashContent } from '../src/main/vault/vault'

let dir: string
let vault: Vault

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dnd-vault-'))
  await mkdir(join(dir, '.obsidian'))
  vault = new Vault({ vaultPath: dir, rootFolder: 'DND Tavern' })
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const note = 'DND Tavern/Characters/Aria.md'

describe('Vault paths', () => {
  it('never resolves outside the vault or into .obsidian', () => {
    expect(() => vault.resolve('../outside.md')).toThrow()
    expect(() => vault.resolve('DND Tavern/../../x.md')).toThrow()
    expect(() => vault.resolve('.obsidian/app.json')).toThrow(/never reads or writes/)
    expect(vault.resolve('Notes/a.md')).toBe(join(dir, 'Notes', 'a.md'))
  })

  it('only writes inside the root folder', async () => {
    await expect(vault.write('Notes/a.md', 'x', { baseHash: null })).rejects.toThrow(/only writes inside/)
  })

  it('maps absolute paths back, hiding .obsidian', () => {
    expect(vault.toVaultPath(join(dir, 'DND Tavern', 'a.md'))).toBe('DND Tavern/a.md')
    expect(vault.toVaultPath(join(dir, '.obsidian', 'app.json'))).toBeNull()
    expect(vault.toVaultPath(join(dir, '..', 'x'))).toBeNull()
  })
})

describe('Vault conflict check', () => {
  it('creates a new file when baseHash is null', async () => {
    await vault.write(note, 'one', { baseHash: null })
    expect(await readFile(join(dir, 'DND Tavern', 'Characters', 'Aria.md'), 'utf8')).toBe('one')
  })

  it('refuses to create over an existing file when baseHash is null', async () => {
    await vault.write(note, 'one', { baseHash: null })
    await expect(vault.write(note, 'two', { baseHash: null })).rejects.toBeInstanceOf(VaultConflictError)
  })

  it('writes when the disk still matches the base version', async () => {
    const s1 = await vault.write(note, 'one', { baseHash: null })
    await vault.write(note, 'two', { baseHash: s1.hash })
    expect((await vault.read(note)).content).toBe('two')
  })

  it('refuses to overwrite a change made on disk since the read', async () => {
    await vault.write(note, 'one', { baseHash: null })
    const { state } = await vault.read(note)
    // Obsidian edits the file.
    await writeFile(vault.resolve(note), 'edited in Obsidian')
    const err = await vault.write(note, 'app version', { baseHash: state.hash }).catch((e) => e)
    expect(err).toBeInstanceOf(VaultConflictError)
    expect(err.diskContent).toBe('edited in Obsidian')
    expect(await readFile(vault.resolve(note), 'utf8')).toBe('edited in Obsidian')
  })

  it('uses the last known hash when no base is given', async () => {
    await vault.write(note, 'one', { baseHash: null })
    await writeFile(vault.resolve(note), 'edited elsewhere')
    await expect(vault.write(note, 'two')).rejects.toBeInstanceOf(VaultConflictError)
  })

  it('refuses to overwrite a file it has never seen unless forced', async () => {
    await mkdir(join(dir, 'DND Tavern', 'Characters'), { recursive: true })
    await writeFile(vault.resolve(note), 'pre-existing')
    await expect(vault.write(note, 'x')).rejects.toBeInstanceOf(VaultConflictError)
    await vault.write(note, 'x', { force: true })
    expect((await vault.read(note)).content).toBe('x')
  })

  it('is not a conflict when the disk already has the new content', async () => {
    await vault.write(note, 'one', { baseHash: null })
    await writeFile(vault.resolve(note), 'same')
    await expect(vault.write(note, 'same', { baseHash: hashContent('one') })).resolves.toBeTruthy()
  })

  it('mutate() re-applies a change on top of external edits instead of conflicting', async () => {
    await vault.write(note, 'line 1\n', { baseHash: null })
    await writeFile(vault.resolve(note), 'line 1\nadded in Obsidian\n')
    await vault.mutate(note, (cur) => `${cur}added by app\n`)
    expect((await vault.read(note)).content).toBe('line 1\nadded in Obsidian\nadded by app\n')
  })

  it('serialises concurrent mutations of the same file', async () => {
    await vault.write(note, '', { baseHash: null })
    await Promise.all(Array.from({ length: 20 }, (_, i) => vault.mutate(note, (cur) => `${cur}${i}\n`)))
    const lines = (await vault.read(note)).content.trim().split('\n')
    expect(lines).toHaveLength(20)
  })
})

describe('Vault own-write tracking', () => {
  it('recognises the change events caused by its own writes', async () => {
    await vault.write(note, 'mine', { baseHash: null })
    expect(vault.isOwnChange(note, 'mine')).toBe(true)
    expect(vault.isOwnChange(note, 'someone else')).toBe(false)
  })

  it('treats a write with identical content as no change', async () => {
    await vault.write(note, 'mine', { baseHash: null })
    vault.isOwnChange(note, 'mine')
    // A second event for the same content (e.g. a touch) is still not external.
    expect(vault.isOwnChange(note, 'mine')).toBe(true)
  })

  it('counts a file added elsewhere as new even if it was read before the event arrived', async () => {
    await mkdir(join(dir, 'DND Tavern', 'Characters'), { recursive: true })
    await writeFile(join(dir, 'DND Tavern', 'Characters', 'Aria.md'), 'from obsidian')
    await vault.read(note)
    expect(vault.isOwnChange(note, 'from obsidian')).toBe(true)
    expect(vault.isOwnChange(note, 'from obsidian', { added: true })).toBe(false)
  })

  it('reports app writes and whether they created the file', async () => {
    const seen: [string, boolean][] = []
    const v = new Vault({ vaultPath: dir, rootFolder: 'DND Tavern', onWrite: (p, _c, created) => seen.push([p, created]) })
    await v.write(note, 'one', { baseHash: null })
    await v.write(note, 'two')
    expect(seen).toEqual([[note, true], [note, false]])
  })
})

describe('Vault helpers', () => {
  it('finds a free file name', async () => {
    await vault.write('DND Tavern/NPCs/Bob.md', 'x', { baseHash: null })
    await vault.write('DND Tavern/NPCs/Bob 2.md', 'x', { baseHash: null })
    expect(await vault.uniquePath('DND Tavern/NPCs', 'Bob', '.md')).toBe('DND Tavern/NPCs/Bob 3.md')
  })

  it('lists and walks, skipping dot-folders', async () => {
    await vault.write('DND Tavern/a.md', 'x', { baseHash: null })
    await vault.write('DND Tavern/sub/b.md', 'x', { baseHash: null })
    await mkdir(join(dir, 'DND Tavern', '.trash'))
    await writeFile(join(dir, 'DND Tavern', '.trash', 'c.md'), 'x')
    expect((await vault.walk('DND Tavern')).sort()).toEqual(['DND Tavern/a.md', 'DND Tavern/sub/b.md'])
    expect(await vault.walkVault()).not.toContain('.obsidian/app.json')
  })
})

describe('VaultIndexer', () => {
  it('indexes characters, campaigns and sessions', async () => {
    await vault.write(
      note,
      '---\nname: Aria the Grey\navatar: aria.png\ntags: [elf]\ndnd:\n  class: Ranger\n  level: 3\n  hp: 20\n  max_hp: 24\n---\n',
      { baseHash: null }
    )
    await vault.write('DND Tavern/Campaigns/Lantern/Campaign.md', '---\nname: The Sunken Lantern\n---\n', {
      baseHash: null
    })
    await vault.write(
      'DND Tavern/Campaigns/Lantern/Sessions/2026-10-10 Session 01.md',
      '---\ntype: session\nid: s1\ntitle: Arrival\ncreated: 2026-10-10T10:00:00Z\n---\n> [!dm]\n> Hello\n\n> [!player] Aria\n> Hi\n',
      { baseHash: null }
    )
    await vault.write('DND Tavern/Campaigns/Orphan/Sessions/x.md', '> [!dm]\n> x\n', { baseHash: null })
    await vault.write('DND Tavern/Lorebooks/World.md', '## Dragons\nkeys:: dragon\n\n## Elves\n', { baseHash: null })

    const indexer = new VaultIndexer(vault, { vaultName: 'Test', isObsidianVault: true })
    await indexer.build()
    const index = indexer.snapshot()

    expect(index.characters).toHaveLength(1)
    expect(index.characters[0]).toMatchObject({
      displayName: 'Aria the Grey',
      avatar: 'DND Tavern/Characters/avatars/aria.png',
      class: 'Ranger',
      level: 3,
      hp: 20,
      max_hp: 24,
      tags: ['elf']
    })
    expect(index.campaigns.map((c) => [c.displayName, c.sessionCount])).toEqual([
      ['Orphan', 1],
      ['The Sunken Lantern', 1]
    ])
    const s = index.sessions.find((x) => x.id === 's1')!
    expect(s).toMatchObject({ title: 'Arrival', messageCount: 2, campaignPath: 'DND Tavern/Campaigns/Lantern' })
    expect(index.lorebooks[0]?.entryCount).toBe(2)

    // Incremental update and removal.
    await vault.write(note, '---\nname: Aria\n---\n', { force: true })
    await indexer.indexFile(note)
    expect(indexer.snapshot().characters[0]?.displayName).toBe('Aria')
    indexer.remove(note)
    expect(indexer.snapshot().characters).toHaveLength(0)
  })
})
