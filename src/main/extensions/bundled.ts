/**
 * Keeps the bundled extensions in userData in step with the app. Each one is
 * copied the first time it appears; after an app update, any whose shipped
 * files changed is replaced, so whatever was worked on reaches the user
 * without a version bump. A copy the user edited is moved to
 * .backups/<name>-<date> first (dot-folders are never loaded, so it can't
 * clash with the new copy). An extension the user deleted stays deleted.
 *
 * The marker file remembers, per extension, the hash of the files last
 * installed. Older markers were a plain list of names; those count as
 * installed with an unknown hash.
 */
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join, relative } from 'node:path'
import { readJson, writeFileAtomic } from '../atomic'

export const BUNDLED_MARKER = '.bundled.json'
type Marker = Record<string, string | null>

async function listFiles(dir: string, root = dir): Promise<string[]> {
  const out: string[] = []
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await listFiles(p, root)))
    else if (e.isFile()) out.push(relative(root, p).replace(/\\/g, '/'))
  }
  return out.sort()
}

/** One hash over every file's path and bytes; null when the folder is missing. Line endings are ignored. */
export async function hashDir(dir: string): Promise<string | null> {
  let files: string[]
  try {
    files = await listFiles(dir)
  } catch {
    return null
  }
  const h = createHash('sha256')
  for (const f of files) {
    h.update(f).update('\0')
    h.update((await fs.readFile(join(dir, f))).toString('latin1').replace(/\r\n/g, '\n')).update('\0')
  }
  return h.digest('hex')
}

async function readMarker(file: string): Promise<Marker> {
  const raw = await readJson(file).catch(() => undefined)
  if (Array.isArray(raw)) return Object.fromEntries(raw.filter((n): n is string => typeof n === 'string').map((n) => [n, null]))
  if (raw && typeof raw === 'object') return raw as Marker
  return {}
}

export interface SyncResult {
  installed: string[]
  updated: string[]
  backedUp: string[]
}

export async function syncBundled(sourceRoot: string, targetRoot: string, now = new Date()): Promise<SyncResult> {
  const result: SyncResult = { installed: [], updated: [], backedUp: [] }
  let names: string[]
  try {
    names = (await fs.readdir(sourceRoot, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return result
  }
  await fs.mkdir(targetRoot, { recursive: true })
  const markerFile = join(targetRoot, BUNDLED_MARKER)
  const marker = await readMarker(markerFile)
  for (const name of names) {
    const source = join(sourceRoot, name)
    const target = join(targetRoot, name)
    const shipped = await hashDir(source)
    if (!shipped) continue
    const have = await hashDir(target)
    try {
      if (!(name in marker)) {
        // First time: install, unless something of the same name is already there.
        if (!have) {
          await fs.cp(source, target, { recursive: true })
          result.installed.push(name)
        }
        marker[name] = have ?? shipped
        continue
      }
      if (!have) continue // the user deleted it
      if (have === shipped) {
        marker[name] = shipped
        continue
      }
      if (marker[name] === shipped) continue // unchanged in the app; the user's edits stay
      // The app ships different files. Keep the user's own edits as a backup.
      if (have !== marker[name]) {
        const backups = join(targetRoot, '.backups')
        await fs.mkdir(backups, { recursive: true })
        const backup = join(backups, `${name}-${now.toISOString().slice(0, 19).replace(/[:T]/g, '-')}`)
        await fs.cp(target, backup, { recursive: true })
        result.backedUp.push(name)
      }
      await fs.rm(target, { recursive: true, force: true })
      await fs.cp(source, target, { recursive: true })
      marker[name] = shipped
      result.updated.push(name)
    } catch (err) {
      console.warn(`[extensions] could not install or update the bundled extension “${name}”:`, err)
    }
  }
  await writeFileAtomic(markerFile, JSON.stringify(marker, null, 2))
  return result
}
