import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isInsideFolder, vaultInInstallFolder } from '../src/main/vault/location'

const base = resolve('/tmp/dnd-tavern-test')
const client = join(base, 'MY DND CLIENT')
const install = join(client, 'DND Tavern')

describe('vault location', () => {
  it('spots a vault folder that is the install folder or inside it', () => {
    expect(vaultInInstallFolder(client, 'DND Tavern', install)).toBe(true)
    expect(vaultInInstallFolder(install, 'Data', install)).toBe(true)
  })

  it('allows a vault folder next to the install folder', () => {
    expect(vaultInInstallFolder(client, 'DND Vault', install)).toBe(false)
    // Same name prefix, different folder.
    expect(vaultInInstallFolder(client, 'DND Tavern2', install)).toBe(false)
  })

  it('never blocks when unpackaged (no install folder)', () => {
    expect(vaultInInstallFolder(client, 'DND Tavern', null)).toBe(false)
  })

  it('treats a folder as inside itself, but not its parent', () => {
    expect(isInsideFolder(install, install)).toBe(true)
    expect(isInsideFolder(client, install)).toBe(false)
  })
})
