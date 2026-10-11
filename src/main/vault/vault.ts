import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { joinVaultPath } from '@shared/names'
import type { VaultPath } from '@shared/types'
import { writeFileAtomic } from '../atomic'
import { AppError } from '../errors'

const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin'

export interface FileState {
  mtimeMs: number
  size: number
  hash: string
}

export interface WriteOptions {
  /**
   * Hash of the version this write is based on.
   *  - string:    the file on disk must still have this hash
   *  - null:      the file must not exist yet
   *  - undefined: use the hash recorded when the app last read/wrote the file
   */
  baseHash?: string | null
  /** Skip the conflict check (the user chose "overwrite"). */
  force?: boolean
}

export function hashContent(data: string | Uint8Array): string {
  return createHash('sha1').update(data).digest('hex')
}

/** Thrown when a file changed on disk since the app last saw it. */
export class VaultConflictError extends AppError {
  constructor(
    readonly path: VaultPath,
    readonly diskContent: string | null,
    readonly diskHash: string | null
  ) {
    super(
      'VAULT_CONFLICT',
      `“${path}” was changed outside DND Tavern since it was loaded.`,
      'Reload the note to see the other changes, or overwrite them.'
    )
  }
}

/**
 * All file access to the vault goes through this class.
 *
 * - Paths are vault-relative with forward slashes and can never escape the
 *   vault or touch .obsidian/.
 * - Writes are atomic (temp file + rename) and limited to the root folder.
 * - The last known hash of every file is recorded; a write whose base version
 *   no longer matches the disk is refused with VaultConflictError.
 * - Hashes of the app's own writes are remembered so the watcher can ignore
 *   the change events they cause.
 */
export class Vault {
  readonly root: string
  readonly rootFolder: string
  private states = new Map<string, FileState>()
  private ownWrites = new Map<string, string[]>()
  private locks = new Map<string, Promise<unknown>>()
  private trash: (abs: string) => Promise<void>

  /** Told about every text file the app writes (the watcher ignores those); `created` when it didn't exist before. */
  private readonly onWrite?: (path: VaultPath, content: string, created: boolean) => void

  constructor(opts: {
    vaultPath: string
    rootFolder: string
    trash?: (abs: string) => Promise<void>
    onWrite?: (path: VaultPath, content: string, created: boolean) => void
  }) {
    this.root = resolve(opts.vaultPath)
    this.rootFolder = joinVaultPath(opts.rootFolder)
    this.trash = opts.trash ?? ((abs) => fs.rm(abs, { force: true }))
    this.onWrite = opts.onWrite
  }

  // ─── Paths ──────────────────────────────────────────────────────────────

  /** Vault path → absolute path. Throws for anything outside the vault or in .obsidian. */
  resolve(path: VaultPath): string {
    const norm = joinVaultPath(path)
    const parts = norm.split('/')
    if (!norm || parts.includes('..')) throw new AppError('VAULT_PATH', `Invalid vault path: ${path}`)
    if (parts[0]?.toLowerCase() === '.obsidian') {
      throw new AppError('VAULT_PATH', 'DND Tavern never reads or writes .obsidian/.')
    }
    const abs = resolve(this.root, ...parts)
    const rel = relative(this.root, abs)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
      throw new AppError('VAULT_PATH', `Path is outside the vault: ${path}`)
    }
    return abs
  }

  /** Absolute path → vault path, or null when outside the vault or in .obsidian. */
  toVaultPath(abs: string): VaultPath | null {
    const rel = relative(this.root, resolve(abs))
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
    const path = rel.split(sep).join('/')
    if (path.split('/')[0]?.toLowerCase() === '.obsidian') return null
    return path
  }

  /** Vault path inside the root folder, e.g. rootPath('Characters', 'Aria.md'). */
  rootPath(...parts: string[]): VaultPath {
    return joinVaultPath(this.rootFolder, ...parts)
  }

  isInRoot(path: VaultPath): boolean {
    // Windows and macOS ignore case in paths; on Linux "dnd tavern" is another folder.
    const fold = (s: string): string => (CASE_INSENSITIVE ? s.toLowerCase() : s)
    const p = fold(joinVaultPath(path))
    const r = fold(this.rootFolder)
    return p === r || p.startsWith(`${r}/`)
  }

  private assertWritable(path: VaultPath): string {
    if (!this.isInRoot(path)) {
      throw new AppError('VAULT_READONLY', `DND Tavern only writes inside “${this.rootFolder}/”.`, path)
    }
    return this.resolve(path)
  }

  // ─── Reading ────────────────────────────────────────────────────────────

  async read(path: VaultPath): Promise<{ content: string; state: FileState }> {
    const abs = this.resolve(path)
    const [content, stat] = await Promise.all([fs.readFile(abs, 'utf8'), fs.stat(abs)])
    const state = { mtimeMs: stat.mtimeMs, size: stat.size, hash: hashContent(content) }
    this.states.set(key(path), state)
    return { content, state }
  }

  async readIfExists(path: VaultPath): Promise<{ content: string; state: FileState } | null> {
    try {
      return await this.read(path)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  async readBinary(path: VaultPath): Promise<Buffer> {
    return fs.readFile(this.resolve(path))
  }

  async exists(path: VaultPath): Promise<boolean> {
    try {
      await fs.access(this.resolve(path))
      return true
    } catch {
      return false
    }
  }

  /** Lists direct children of a folder. Missing folders list as empty. */
  async list(dir: VaultPath): Promise<{ name: string; path: VaultPath; isDir: boolean }[]> {
    try {
      const entries = await fs.readdir(this.resolve(dir), { withFileTypes: true })
      return entries
        .filter((e) => !e.name.startsWith('.'))
        .map((e) => ({ name: e.name, path: joinVaultPath(dir, e.name), isDir: e.isDirectory() }))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
  }

  /** Recursively lists files below a folder (skipping dot-folders). */
  async walk(dir: VaultPath, filter?: (path: VaultPath) => boolean, limit = 20_000): Promise<VaultPath[]> {
    const out: VaultPath[] = []
    const visit = async (d: VaultPath): Promise<void> => {
      for (const entry of await this.list(d)) {
        if (out.length >= limit) return
        if (entry.isDir) await visit(entry.path)
        else if (!filter || filter(entry.path)) out.push(entry.path)
      }
    }
    await visit(dir)
    return out
  }

  /** Walks the whole vault (used for note search); the root itself has no vault path. */
  async walkVault(filter?: (path: VaultPath) => boolean, limit = 20_000): Promise<VaultPath[]> {
    const out: VaultPath[] = []
    const visit = async (absDir: string): Promise<void> => {
      let entries: import('node:fs').Dirent[]
      try {
        entries = await fs.readdir(absDir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        if (out.length >= limit) return
        if (e.name.startsWith('.')) continue
        const abs = join(absDir, e.name)
        if (e.isDirectory()) await visit(abs)
        else {
          const p = this.toVaultPath(abs)
          if (p && (!filter || filter(p))) out.push(p)
        }
      }
    }
    await visit(this.root)
    return out
  }

  // ─── Writing ────────────────────────────────────────────────────────────

  /** Writes a text file atomically, refusing to clobber changes made elsewhere. */
  async write(path: VaultPath, content: string, opts: WriteOptions = {}): Promise<FileState> {
    return this.withLock(path, () => this.writeUnlocked(path, content, opts))
  }

  private async writeUnlocked(path: VaultPath, content: string, opts: WriteOptions): Promise<FileState> {
    const abs = this.assertWritable(path)
    if (!opts.force) await this.checkConflict(path, abs, content, opts.baseHash)
    const hash = hashContent(content)
    this.rememberOwnWrite(path, hash)
    const existed = this.onWrite ? await fs.access(abs).then(() => true, () => false) : true
    await writeFileAtomic(abs, content)
    const stat = await fs.stat(abs)
    const state = { mtimeMs: stat.mtimeMs, size: stat.size, hash }
    this.states.set(key(path), state)
    try {
      this.onWrite?.(path, content, !existed)
    } catch {
      // a listener's problem, not the write's
    }
    return state
  }

  private async checkConflict(
    path: VaultPath,
    abs: string,
    next: string,
    baseHash: string | null | undefined
  ): Promise<void> {
    let disk: string | null = null
    try {
      disk = await fs.readFile(abs, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    // Writing what's already there is never a conflict.
    if (disk !== null && disk === next) return

    const expected = baseHash !== undefined ? baseHash : (this.states.get(key(path))?.hash ?? null)
    if (disk === null) {
      // The file is gone (or never existed). Recreating it is fine unless the
      // caller insisted it must already exist.
      return
    }
    const diskHash = hashContent(disk)
    if (expected === null || diskHash !== expected) {
      throw new VaultConflictError(path, disk, diskHash)
    }
  }

  /**
   * Read-modify-write under the file's lock, always starting from the current
   * disk content. This is how concurrent edits are merged: the change is
   * re-applied to whatever Obsidian (or anyone) saved last.
   * Return null from `fn` to leave the file untouched.
   */
  async mutate(
    path: VaultPath,
    fn: (current: string | null) => string | null | Promise<string | null>
  ): Promise<{ content: string; state: FileState } | null> {
    return this.withLock(path, async () => {
      const abs = this.assertWritable(path)
      let current: string | null = null
      try {
        current = await fs.readFile(abs, 'utf8')
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }
      const next = await fn(current)
      if (next === null || next === current) return null
      const state = await this.writeUnlocked(path, next, { baseHash: current === null ? null : hashContent(current) })
      return { content: next, state }
    })
  }

  async writeBinary(path: VaultPath, data: Uint8Array): Promise<void> {
    const abs = this.assertWritable(path)
    this.rememberOwnWrite(path, hashContent(data))
    await writeFileAtomic(abs, data)
  }

  /** Returns "<dir>/<base><ext>", or "<base> 2<ext>", "<base> 3<ext>"… if taken. */
  async uniquePath(dir: VaultPath, base: string, ext: string): Promise<VaultPath> {
    for (let i = 1; i < 10_000; i++) {
      const candidate = joinVaultPath(dir, `${base}${i === 1 ? '' : ` ${i}`}${ext}`)
      if (!(await this.exists(candidate))) return candidate
    }
    throw new AppError('VAULT_NAME', `No free file name for ${base}${ext}`)
  }

  async mkdir(path: VaultPath): Promise<void> {
    await fs.mkdir(this.assertWritable(path), { recursive: true })
  }

  /** Moves a file to the recycle bin (never a hard delete). */
  async delete(path: VaultPath): Promise<void> {
    const abs = this.assertWritable(path)
    await this.trash(abs)
    this.states.delete(key(path))
  }

  async rename(from: VaultPath, to: VaultPath): Promise<void> {
    const src = this.assertWritable(from)
    const dst = this.assertWritable(to)
    if (await this.exists(to)) throw new AppError('VAULT_EXISTS', `“${to}” already exists.`)
    await fs.mkdir(resolve(dst, '..'), { recursive: true })
    await fs.rename(src, dst)
    const state = this.states.get(key(from))
    this.states.delete(key(from))
    if (state) this.states.set(key(to), state)
  }

  // ─── Watcher support ────────────────────────────────────────────────────

  private rememberOwnWrite(path: VaultPath, hash: string): void {
    const list = this.ownWrites.get(key(path)) ?? []
    list.push(hash)
    // Only the most recent few matter; a burst of writes can coalesce into one event.
    this.ownWrites.set(key(path), list.slice(-8))
  }

  /**
   * Called by the watcher with the content it found on disk. Returns true when
   * the change was caused by our own write (or nothing actually changed), in
   * which case it should be ignored.
   */
  isOwnChange(path: VaultPath, content: string | Uint8Array, opts: { added?: boolean } = {}): boolean {
    const hash = hashContent(content)
    const k = key(path)
    const own = this.ownWrites.get(k)
    if (own?.includes(hash)) {
      this.ownWrites.set(k, own.slice(own.indexOf(hash) + 1))
      return true
    }
    // For a newly added file, a known state only means it was read first, not that it's ours.
    return !opts.added && this.states.get(k)?.hash === hash
  }

  /** Records a file's state after an external change was processed. */
  noteState(path: VaultPath, content: string, mtimeMs: number): void {
    this.states.set(key(path), { mtimeMs, size: Buffer.byteLength(content), hash: hashContent(content) })
  }

  forget(path: VaultPath): void {
    this.states.delete(key(path))
    this.ownWrites.delete(key(path))
  }

  knownHash(path: VaultPath): string | undefined {
    return this.states.get(key(path))?.hash
  }

  private async withLock<T>(path: VaultPath, fn: () => Promise<T>): Promise<T> {
    const k = key(path)
    const prev = this.locks.get(k) ?? Promise.resolve()
    const run = prev.then(fn, fn)
    const tail = run.catch(() => undefined)
    this.locks.set(k, tail)
    try {
      return await run
    } finally {
      if (this.locks.get(k) === tail) this.locks.delete(k)
    }
  }
}

/** Windows paths are case-insensitive, so state is keyed case-insensitively. */
function key(path: VaultPath): string {
  return joinVaultPath(path).toLowerCase()
}
