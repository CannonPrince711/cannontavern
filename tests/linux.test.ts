import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { detectObsidianVaults, obsidianConfigFiles } from '../src/main/vault/obsidian'

vi.mock('electron', () => ({ app: {} }))
const { desktopExec } = await import('../src/main/autostart')

const dir = await mkdtemp(join(tmpdir(), 'dndt-linux-'))
afterAll(() => rm(dir, { recursive: true, force: true }))

describe('Obsidian vault detection', () => {
  it('looks in the native, Flatpak and Snap config folders on Linux', () => {
    const files = obsidianConfigFiles('/home/a/.config', '/home/a', 'linux').map((f) => f.replace(/\\/g, '/'))
    expect(files).toEqual([
      '/home/a/.config/obsidian/obsidian.json',
      '/home/a/.var/app/md.obsidian.Obsidian/config/obsidian/obsidian.json',
      '/home/a/snap/obsidian/current/.config/obsidian/obsidian.json'
    ])
    expect(obsidianConfigFiles('C:/Users/a/AppData/Roaming', 'C:/Users/a', 'win32')).toHaveLength(1)
  })

  it('merges every list it finds, skipping duplicates and missing files', async () => {
    const vaultA = join(dir, 'A')
    const vaultB = join(dir, 'B')
    await mkdir(vaultA)
    await mkdir(vaultB)
    const native = join(dir, 'native.json')
    const flatpak = join(dir, 'flatpak.json')
    await writeFile(native, JSON.stringify({ vaults: { x: { path: vaultA, ts: 1 } } }))
    await writeFile(flatpak, JSON.stringify({ vaults: { y: { path: vaultB, ts: 2, open: true }, z: { path: vaultA, ts: 1 } } }))
    const found = await detectObsidianVaults([native, flatpak, join(dir, 'missing.json')])
    expect(found.map((v) => v.name)).toEqual(['B', 'A'])
  })
})

describe('Linux autostart entry', () => {
  it('quotes the executable path for the Exec line', () => {
    expect(desktopExec('/opt/DND Tavern/dnd-tavern')).toBe('"/opt/DND Tavern/dnd-tavern"')
    expect(desktopExec('/home/a/$weird "name"')).toBe('"/home/a/\\$weird \\"name\\""')
  })
})
