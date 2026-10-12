import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { syncBundled } from '../src/main/extensions/bundled'

let root: string
let ship: string
let user: string

const put = async (dir: string, name: string, files: Record<string, string>): Promise<void> => {
  await mkdir(join(dir, name), { recursive: true })
  for (const [f, text] of Object.entries(files)) await writeFile(join(dir, name, f), text)
}
const read = (name: string, f = 'main.js'): Promise<string> => readFile(join(user, name, f), 'utf8')

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dnd-bundled-'))
  ship = join(root, 'app')
  user = join(root, 'user')
  await put(ship, 'mature-mode', { 'extension.json': '{"version":"1.0.0"}', 'main.js': 'v1' })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('bundled extensions follow app updates', () => {
  it('installs once, then replaces a copy the user never touched when the app changes it', async () => {
    expect((await syncBundled(ship, user)).installed).toEqual(['mature-mode'])
    await put(ship, 'mature-mode', { 'main.js': 'v2' })
    const r = await syncBundled(ship, user)
    expect(r.updated).toEqual(['mature-mode'])
    expect(r.backedUp).toEqual([])
    expect(await read('mature-mode')).toBe('v2')
  })

  it('backs up the user’s edits before updating, and keeps them when the app did not change', async () => {
    await syncBundled(ship, user)
    await writeFile(join(user, 'mature-mode', 'main.js'), 'mine')
    expect((await syncBundled(ship, user)).updated).toEqual([])
    expect(await read('mature-mode')).toBe('mine')
    await put(ship, 'mature-mode', { 'main.js': 'v2' })
    const r = await syncBundled(ship, user, new Date('2026-10-12T03:00:00Z'))
    expect(r.backedUp).toEqual(['mature-mode'])
    expect(await read('mature-mode')).toBe('v2')
    expect(await readFile(join(user, '.backups', 'mature-mode-2026-10-12-03-00-00', 'main.js'), 'utf8')).toBe('mine')
  })

  it('leaves a deleted extension deleted, and adds new ones', async () => {
    await syncBundled(ship, user)
    await rm(join(user, 'mature-mode'), { recursive: true })
    await put(ship, 'mature-mode', { 'main.js': 'v2' })
    await put(ship, 'dice-tray', { 'main.js': 'd' })
    const r = await syncBundled(ship, user)
    expect(r.installed).toEqual(['dice-tray'])
    expect((await readdir(user)).filter((n) => !n.startsWith('.'))).toEqual(['dice-tray'])
  })

  it('updates copies installed by older versions, which only recorded names', async () => {
    await put(user, 'mature-mode', { 'extension.json': '{"version":"1.0.0"}', 'main.js': 'old' })
    await writeFile(join(user, '.bundled.json'), '["mature-mode"]')
    const r = await syncBundled(ship, user)
    expect(r.updated).toEqual(['mature-mode'])
    expect(r.backedUp).toEqual(['mature-mode'])
    expect(await read('mature-mode')).toBe('v1')
  })
})
