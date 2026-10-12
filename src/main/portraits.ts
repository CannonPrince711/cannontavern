/**
 * Automatic portraits (Settings → Image backends → Image triggers). When a
 * character or NPC note is created without a portrait, it is painted in the
 * background with the default image backend and set as the note's avatar.
 * One at a time, so a campaign's worth of NPCs doesn't swamp the backend.
 *
 * "Created" covers notes written by the app (New character, the campaign
 * builder, /npc and other extensions) and notes added in Obsidian. A note
 * created without a description yet (New character) is painted once it gets
 * one. Existing characters are never touched.
 */
import { FOLDERS } from '@shared/layout'
import type { VaultPath } from '@shared/types'
import { toErrorInfo } from './errors'
import { imageService } from './images'
import { send } from './ipc'
import { settingsStore } from './settings-store'
import { parseNote } from './vault/frontmatter'
import { vaultService } from './vault/service'
import { getMainWindow } from './window'
import { noteCampaigns } from './npcs'
import { anyAutoPortraits, settingsFor } from './world'

const key = (p: string): string => p.toLowerCase()

class PortraitService {
  private queue: VaultPath[] = []
  private queued = new Set<string>()
  /** Created this run without a description; painted once they get one. */
  private waiting = new Set<string>()
  /** Painted (or tried) this run: never twice. */
  private tried = new Set<string>()
  private running = false
  private painted: string[] = []

  start(): void {
    vaultService.on('write', ({ path, content, created }) => this.consider(path, content, created))
    // Notes added or edited in Obsidian.
    vaultService.on('change', ({ path, event }) => {
      if (event === 'unlink') return this.forget(path)
      void vaultService.vault
        ?.readIfExists(path)
        .then((file) => file && this.consider(path, file.content, event === 'add'))
        .catch(() => {})
    })
  }

  private isCharacterNote(path: VaultPath): boolean {
    const vault = vaultService.vault
    if (!vault || !path.toLowerCase().endsWith('.md')) return false
    const k = key(path)
    const inFolder = (f: string): boolean => {
      const dir = `${key(vault.rootPath(f))}/`
      return k.startsWith(dir) && !k.slice(dir.length).includes('/')
    }
    return inFolder(FOLDERS.characters) || inFolder(FOLDERS.npcs)
  }

  private consider(path: VaultPath, content: string, created: boolean): void {
    if (!anyAutoPortraits() || !settingsStore.get().imageBackends.length || !this.isCharacterNote(path)) return
    const k = key(path)
    if (this.tried.has(k) || this.queued.has(k) || (!created && !this.waiting.has(k))) return
    let data: Record<string, unknown>
    try {
      data = parseNote(content).data
    } catch {
      return
    }
    if (data.type !== undefined && data.type !== 'character' && data.type !== 'npc') return
    if (typeof data.avatar === 'string' && data.avatar.trim()) {
      this.waiting.delete(k)
      return
    }
    if (typeof data.description !== 'string' || !data.description.trim()) {
      this.waiting.add(k)
      return
    }
    this.waiting.delete(k)
    this.queued.add(k)
    this.queue.push(path)
    void this.drain()
  }

  private forget(path: VaultPath): void {
    const k = key(path)
    this.waiting.delete(k)
    this.queued.delete(k)
    this.queue = this.queue.filter((p) => key(p) !== k)
  }

  private async drain(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (this.queue.length) {
        const path = this.queue.shift()!
        this.queued.delete(key(path))
        this.tried.add(key(path))
        // It may have been deleted, given a portrait, or the setting turned off while it waited.
        const vault = vaultService.vault
        const file = await vault?.readIfExists(path).catch(() => null)
        if (!vault || !file) continue
        const { data } = parseNote(file.content)
        if (typeof data.avatar === 'string' && data.avatar.trim()) continue
        // A note tied to one campaign is painted with that world's settings.
        const tied = await noteCampaigns(vault, vaultService.getIndex(), path).catch(() => [])
        const campaignPath = tied.length === 1 ? tied[0] : undefined
        if (!settingsFor(campaignPath).imageTriggers.autoPortraits) continue
        const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : (path.split('/').pop() ?? path).replace(/\.md$/i, '')
        try {
          await imageService.generateNow({ kind: 'portrait', characterPath: path, ...(campaignPath ? { campaignPath } : {}) })
          this.painted.push(name)
        } catch (err) {
          // A broken backend would fail for every one: stop and say so once.
          const dropped = this.queue.length
          this.queue = []
          this.queued.clear()
          send(getMainWindow(), 'toast', {
            level: 'warning',
            title: `Couldn’t paint a portrait for ${name}`,
            detail: `${toErrorInfo(err).message}${dropped ? ` (${dropped} more skipped)` : ''}`
          })
        }
      }
    } finally {
      this.running = false
    }
    if (this.painted.length) {
      const names = this.painted
      this.painted = []
      const list = names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', ').replace(/, ([^,]*)$/, ' and $1')
      send(getMainWindow(), 'toast', { level: 'success', title: names.length === 1 ? `Painted a portrait of ${list}` : `Painted portraits of ${list}` })
    }
  }
}

export const portraitService = new PortraitService()
