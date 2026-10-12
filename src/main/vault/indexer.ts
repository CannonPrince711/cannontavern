import { FOLDERS, classifyPath, isSharedLorebook, type NoteKind } from '@shared/layout'
import { campaignFolderFromLink } from '@shared/membership'
import { joinVaultPath, noteName, wikilinkTarget } from '@shared/names'
import { worldFromFrontmatter } from '@shared/world'
import type {
  CampaignSummary,
  CharacterSummary,
  LorebookSummary,
  NoteRef,
  SessionSummary,
  VaultIndex,
  VaultPath
} from '@shared/types'
import { parseNote } from './frontmatter'
import type { Vault } from './vault'

const CALLOUT_RE = /^>\s*\[!(player|dm|roll|system|image)\][^\n]*$/gim

/**
 * In-memory index of the app's notes. The vault is the only source of truth;
 * this is rebuilt at startup and patched file by file as the watcher reports
 * changes.
 */
export class VaultIndexer {
  private characters = new Map<string, CharacterSummary>()
  private npcs = new Map<string, CharacterSummary>()
  private lorebooks = new Map<string, LorebookSummary>()
  private presets = new Map<string, NoteRef>()
  private campaigns = new Map<string, CampaignSummary>()
  private sessions = new Map<string, SessionSummary>()
  builtAt = new Date().toISOString()

  constructor(
    private vault: Vault,
    private meta: { vaultName: string; isObsidianVault: boolean }
  ) {}

  async build(): Promise<void> {
    for (const map of this.maps()) map.clear()
    const files = await this.vault.walk(this.vault.rootFolder, (p) => p.toLowerCase().endsWith('.md'))
    await pool(files, 16, (p) => this.indexFile(p).catch((err) => console.warn('[index] skipped', p, err)))
    this.builtAt = new Date().toISOString()
  }

  /** (Re)indexes one file. Returns the kind of note, or null if it isn't one of ours. */
  async indexFile(path: VaultPath): Promise<NoteKind | null> {
    const cls = classifyPath(this.vault.rootFolder, path)
    if (!cls) return null
    const file = await this.vault.readIfExists(path)
    if (!file) {
      this.remove(path)
      return cls.kind
    }
    const { data, body } = parseNote(file.content)
    const ref: NoteRef = { path, name: noteName(path), mtimeMs: file.state.mtimeMs }
    const k = path.toLowerCase()

    switch (cls.kind) {
      case 'character':
      case 'npc':
        ;(cls.kind === 'character' ? this.characters : this.npcs).set(k, this.characterSummary(ref, data))
        break
      case 'lorebook':
        this.lorebooks.set(k, { ...ref, entryCount: (body.match(/^## /gm) ?? []).length, ...(isSharedLorebook(this.vault.rootFolder, path) ? { shared: true } : {}) })
        break
      case 'preset':
        this.presets.set(k, ref)
        break
      case 'campaign': {
        const folder = cls.campaignPath!
        this.campaigns.set(folder.toLowerCase(), {
          path: folder,
          name: noteName(folder),
          mtimeMs: ref.mtimeMs,
          displayName: str(data.name) || noteName(folder),
          sessionCount: 0,
          world: worldFromFrontmatter(data)
        })
        break
      }
      case 'session':
        this.sessions.set(k, {
          ...ref,
          id: str(data.id) || path,
          title: str(data.title) || ref.name,
          campaignPath: cls.campaignPath!,
          created: str(data.created),
          messageCount: (body.match(CALLOUT_RE) ?? []).length,
          cast: [...strs(data.characters), ...strs(data.companions)].map((l) => wikilinkTarget(l).replace(/\.md$/i, '').toLowerCase())
        })
        break
      case 'party':
        break
    }
    return cls.kind
  }

  remove(path: VaultPath): void {
    const k = path.toLowerCase()
    for (const map of this.maps()) map.delete(k)
  }

  /** Removes everything at or below a folder (folder deleted or renamed). */
  removeDir(dir: VaultPath): void {
    const prefix = `${dir.toLowerCase()}/`
    for (const map of this.maps()) {
      for (const k of [...map.keys()]) if (k === dir.toLowerCase() || k.startsWith(prefix)) map.delete(k)
    }
  }

  snapshot(): VaultIndex {
    const byName = <T extends { name: string }>(a: T, b: T): number => a.name.localeCompare(b.name)
    const campaigns = new Map(this.campaigns)
    // A campaign folder with sessions but no Campaign.md still shows up.
    for (const s of this.sessions.values()) {
      const k = s.campaignPath.toLowerCase()
      if (!campaigns.has(k)) {
        campaigns.set(k, {
          path: s.campaignPath,
          name: noteName(s.campaignPath),
          displayName: noteName(s.campaignPath),
          mtimeMs: 0,
          sessionCount: 0
        })
      }
    }
    const counts = new Map<string, number>()
    for (const s of this.sessions.values()) {
      const k = s.campaignPath.toLowerCase()
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    return {
      vaultPath: this.vault.root,
      vaultName: this.meta.vaultName,
      rootFolder: this.vault.rootFolder,
      isObsidianVault: this.meta.isObsidianVault,
      builtAt: this.builtAt,
      characters: this.withCampaigns([...this.characters.values()]).sort(byName),
      npcs: [...this.npcs.values()].sort(byName),
      campaigns: [...campaigns.entries()]
        .map(([k, c]) => ({ ...c, sessionCount: counts.get(k) ?? 0 }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
      // Newest first: file names start with the date, so reverse name order works.
      sessions: [...this.sessions.values()].sort((a, b) => b.created.localeCompare(a.created) || b.name.localeCompare(a.name)),
      lorebooks: [...this.lorebooks.values()].sort(byName),
      presets: [...this.presets.values()].sort(byName)
    }
  }

  private characterSummary(ref: NoteRef, data: Record<string, unknown>): CharacterSummary {
    const dnd = (data.dnd && typeof data.dnd === 'object' ? data.dnd : {}) as Record<string, unknown>
    return {
      ...ref,
      displayName: str(data.name) || ref.name,
      avatar: this.avatarPath(data.avatar),
      tags: Array.isArray(data.tags) ? data.tags.filter((t): t is string => typeof t === 'string') : [],
      race: str(dnd.race) || undefined,
      class: str(dnd.class) || undefined,
      level: num(dnd.level),
      hp: num(dnd.hp),
      max_hp: num(dnd.max_hp),
      campaigns: [...new Set(strs(data.campaigns).map((l) => campaignFolderFromLink(l, this.vault.rootFolder)).filter((f): f is string => !!f))]
    }
  }

  /** A character with no `campaigns` of its own belongs to the campaigns it has played in. */
  private withCampaigns(list: CharacterSummary[]): CharacterSummary[] {
    const played = new Map<string, Set<string>>()
    for (const s of this.sessions.values()) {
      for (const who of s.cast ?? []) played.set(who, (played.get(who) ?? new Set()).add(s.campaignPath))
    }
    return list.map((c) => {
      if (c.campaigns?.length) return c
      const key = c.path.replace(/\.md$/i, '').toLowerCase()
      const found = played.get(key) ?? played.get(c.name.toLowerCase())
      return found ? { ...c, campaigns: [...found] } : c
    })
  }

  /** "aria.png", "[[aria.png]]" or a full vault path → vault path. */
  private avatarPath(value: unknown): string | undefined {
    if (typeof value !== 'string' || !value.trim()) return undefined
    const target = wikilinkTarget(value)
    return target.includes('/') ? joinVaultPath(target) : this.vault.rootPath(FOLDERS.avatars, target)
  }

  private maps(): Map<string, unknown>[] {
    return [this.characters, this.npcs, this.lorebooks, this.presets, this.campaigns, this.sessions]
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
}

function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : []
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<unknown>): Promise<void> {
  let i = 0
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) await fn(items[i++] as T)
  })
  await Promise.all(workers)
}
