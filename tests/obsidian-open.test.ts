import { describe, expect, it } from 'vitest'
import { obsidianPathUri, obsidianVaultFor } from '../src/main/vault/obsidian'

const vault = (path: string) => ({ path, name: path.split(/[\\/]/).pop()!, open: false })

describe('opening notes in Obsidian', () => {
  const vaults = [vault('C:\\Users\\Seth\\Desktop\\DND\\Hollowmere'), vault('C:\\Users\\Seth\\Desktop\\MY DND CLIENT'), vault('C:\\Users\\Seth\\Desktop\\MY DND CLIENT\\DND Vault')]

  it('finds the vault that holds a file, the deepest one first, ignoring case on Windows', () => {
    expect(obsidianVaultFor('C:\\Users\\Seth\\Desktop\\my dnd client\\DND Vault\\NPCs\\Ddraig.md', vaults, 'win32')?.name).toBe('DND Vault')
    expect(obsidianVaultFor('C:\\Users\\Seth\\Desktop\\MY DND CLIENT\\notes.md', vaults, 'win32')?.name).toBe('MY DND CLIENT')
  })

  it('returns nothing when Obsidian does not know the folder (the "Vault not found" case)', () => {
    expect(obsidianVaultFor('C:\\Users\\Seth\\Desktop\\Elsewhere\\note.md', vaults, 'win32')).toBeNull()
    // A folder whose name only starts the same is not inside it.
    expect(obsidianVaultFor('C:\\Users\\Seth\\Desktop\\DND\\Hollowmere2\\note.md', vaults, 'win32')).toBeNull()
  })

  it('compares case-sensitively on Linux', () => {
    expect(obsidianVaultFor('/home/seth/Vault/a.md', [vault('/home/seth/vault')], 'linux')).toBeNull()
    expect(obsidianVaultFor('/home/seth/vault/a.md', [vault('/home/seth/vault')], 'linux')?.path).toBe('/home/seth/vault')
  })

  it('opens by absolute path, so the vault’s name does not matter', () => {
    expect(obsidianPathUri('C:\\Vault\\NPCs\\Ddraig.md')).toBe('obsidian://open?path=C%3A%5CVault%5CNPCs%5CDdraig.md')
  })
})
