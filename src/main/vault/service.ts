import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import { basename } from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import { FOLDERS, normalizeRootFolder, type NoteKind } from '@shared/layout'
import type { VaultIndex, VaultPath } from '@shared/types'
import { AppError } from '../errors'
import { ensureResources } from '../resources'
import { VaultIndexer } from './indexer'
import { validateVault } from './obsidian'
import { Vault } from './vault'

export interface ExternalChange {
  path: VaultPath
  event: 'add' | 'change' | 'unlink'
  kind: NoteKind | null
}

interface ServiceEvents {
  index: [VaultIndex]
  change: [ExternalChange]
  /** A text file the app itself wrote. */
  write: [{ path: VaultPath; content: string; created: boolean }]
}

/**
 * Owns the currently open vault: the Vault (file access), the index and the
 * chokidar watcher. Emits "index" (debounced) whenever the index changes and
 * "change" for every external edit, so open sessions/sheets can refresh.
 */
class VaultService extends EventEmitter<ServiceEvents> {
  vault: Vault | null = null
  private indexer: VaultIndexer | null = null
  private watcher: FSWatcher | null = null
  private broadcastTimer: NodeJS.Timeout | undefined
  private trash: (abs: string) => Promise<void> = (abs) => fs.rm(abs, { force: true })

  setTrash(fn: (abs: string) => Promise<void>): void {
    this.trash = fn
  }

  /** Opens a vault. With `create`, the root folder and its sub-folders are created. */
  async open(vaultPath: string, rootFolderInput: string, opts: { create: boolean }): Promise<VaultIndex> {
    const rootFolder = normalizeRootFolder(rootFolderInput)
    if (!rootFolder) throw new AppError('VAULT_ROOT', `“${rootFolderInput}” is not a valid folder name.`)
    const check = await validateVault(vaultPath)
    if (!check.exists) throw new AppError('VAULT_MISSING', `The folder “${vaultPath}” does not exist.`)
    if (!check.writable) throw new AppError('VAULT_READONLY', `DND Tavern cannot write to “${vaultPath}”.`)

    await this.close()
    const vault = new Vault({ vaultPath, rootFolder, trash: (abs) => this.trash(abs), onWrite: (path, content, created) => this.emit('write', { path, content, created }) })
    if (opts.create) {
      for (const folder of Object.values(FOLDERS)) await vault.mkdir(vault.rootPath(folder))
    } else if (!(await vault.exists(rootFolder))) {
      await vault.mkdir(rootFolder)
    }
    // Shared Resources, once per vault (before indexing so its lorebooks are in the first index).
    await ensureResources(vault).catch(() => {})
    const indexer = new VaultIndexer(vault, { vaultName: check.name, isObsidianVault: check.isObsidianVault })
    await indexer.build()
    this.vault = vault
    this.indexer = indexer
    this.startWatcher(vault)
    const snapshot = indexer.snapshot()
    this.emit('index', snapshot)
    return snapshot
  }

  async close(): Promise<void> {
    clearTimeout(this.broadcastTimer)
    await this.watcher?.close()
    this.watcher = null
    this.vault = null
    this.indexer = null
  }

  getIndex(): VaultIndex | null {
    return this.indexer?.snapshot() ?? null
  }

  /** The open vault, or a friendly error when none is configured. */
  require(): Vault {
    if (!this.vault) throw new AppError('VAULT_NOT_CONFIGURED', 'No vault is open. Choose one in Settings → General.')
    return this.vault
  }

  /** Re-indexes a file the app itself just wrote (the watcher ignores own writes). */
  async reindex(path: VaultPath): Promise<void> {
    if (!this.indexer) return
    await this.indexer.indexFile(path)
    this.scheduleBroadcast()
  }

  removeFromIndex(path: VaultPath): void {
    this.indexer?.remove(path)
    this.scheduleBroadcast()
  }

  private startWatcher(vault: Vault): void {
    const root = vault.resolve(vault.rootFolder)
    const watcher = watch(root, {
      ignoreInitial: true,
      // Dot-files: .obsidian (if the root is the vault), .trash, our .tmp files.
      ignored: (p: string) => basename(p).startsWith('.'),
      // Obsidian saves in several small writes; wait until the file settles.
      awaitWriteFinish: { stabilityThreshold: 180, pollInterval: 40 },
      depth: 10
    })
    watcher
      .on('add', (p) => void this.onFile(vault, p, 'add'))
      .on('change', (p) => void this.onFile(vault, p, 'change'))
      .on('unlink', (p) => this.onUnlink(vault, p))
      .on('unlinkDir', (p) => {
        const rel = vault.toVaultPath(p)
        if (rel) {
          this.indexer?.removeDir(rel)
          this.scheduleBroadcast()
        }
      })
      .on('error', (err) => console.error('[vault] watcher error:', err))
    this.watcher = watcher
  }

  private async onFile(vault: Vault, abs: string, event: 'add' | 'change'): Promise<void> {
    if (vault !== this.vault) return
    const path = vault.toVaultPath(abs)
    if (!path) return
    try {
      const isText = path.toLowerCase().endsWith('.md')
      const data = isText ? await fs.readFile(abs, 'utf8') : await fs.readFile(abs)
      // A new file counts unless we wrote it, even if something already read it before this event.
      if (vault.isOwnChange(path, data, { added: event === 'add' })) return
      if (typeof data === 'string') vault.noteState(path, data, (await fs.stat(abs)).mtimeMs)
      const kind = isText ? ((await this.indexer?.indexFile(path)) ?? null) : null
      this.emit('change', { path, event, kind })
      this.scheduleBroadcast()
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('[vault] could not process', path, err)
    }
  }

  private onUnlink(vault: Vault, abs: string): void {
    if (vault !== this.vault) return
    const path = vault.toVaultPath(abs)
    if (!path) return
    vault.forget(path)
    this.indexer?.remove(path)
    this.emit('change', { path, event: 'unlink', kind: null })
    this.scheduleBroadcast()
  }

  private scheduleBroadcast(): void {
    clearTimeout(this.broadcastTimer)
    this.broadcastTimer = setTimeout(() => {
      const snapshot = this.getIndex()
      if (snapshot) this.emit('index', snapshot)
    }, 120)
  }
}

export const vaultService = new VaultService()
