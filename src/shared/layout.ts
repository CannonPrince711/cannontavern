/**
 * The folder layout inside <Vault>/<rootFolder>/ and helpers to classify a
 * vault path by what kind of note it is.
 */
import { joinVaultPath } from './names'

export const FOLDERS = {
  characters: 'Characters',
  avatars: 'Characters/avatars',
  lorebooks: 'Lorebooks',
  campaigns: 'Campaigns',
  presets: 'Presets',
  npcs: 'NPCs'
} as const

export const CAMPAIGN_FILE = 'Campaign.md'
export const PARTY_FILE = 'Party.md'
export const SESSIONS_FOLDER = 'Sessions'
export const IMAGES_FOLDER = 'Images'

export type NoteKind = 'character' | 'npc' | 'lorebook' | 'preset' | 'campaign' | 'party' | 'session'

export interface Classified {
  kind: NoteKind
  /** For campaign, party and session notes: the campaign folder's vault path. */
  campaignPath?: string
}

/**
 * Classifies a vault path ("DND Tavern/Characters/Aria.md") relative to the
 * root folder. Returns null for anything that isn't one of the app's notes.
 */
export function classifyPath(rootFolder: string, path: string): Classified | null {
  const root = joinVaultPath(rootFolder)
  const p = joinVaultPath(path)
  const prefix = root ? `${root}/` : ''
  if (!p.toLowerCase().endsWith('.md')) return null
  if (prefix && !p.toLowerCase().startsWith(prefix.toLowerCase())) return null
  const parts = p.slice(prefix.length).split('/')

  if (parts.length === 2) {
    const [folder] = parts
    if (eq(folder, FOLDERS.characters)) return { kind: 'character' }
    if (eq(folder, FOLDERS.npcs)) return { kind: 'npc' }
    if (eq(folder, FOLDERS.lorebooks)) return { kind: 'lorebook' }
    if (eq(folder, FOLDERS.presets)) return { kind: 'preset' }
  }
  if (eq(parts[0], FOLDERS.campaigns)) {
    const campaignPath = joinVaultPath(root, FOLDERS.campaigns, parts[1] ?? '')
    if (parts.length === 3 && eq(parts[2], CAMPAIGN_FILE)) return { kind: 'campaign', campaignPath }
    if (parts.length === 3 && eq(parts[2], PARTY_FILE)) return { kind: 'party', campaignPath }
    if (parts.length === 4 && eq(parts[2], SESSIONS_FOLDER)) return { kind: 'session', campaignPath }
  }
  return null
}

function eq(a: string | undefined, b: string): boolean {
  return (a ?? '').toLowerCase() === b.toLowerCase()
}

/** Validates and normalises the root-folder setting. Returns null if invalid. */
export function normalizeRootFolder(input: string): string | null {
  const parts = input
    .split(/[\\/]+/)
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length === 0) return null
  for (const part of parts) {
    if (part === '.' || part === '..' || part.startsWith('.')) return null
    if (/[:*?"<>|]/.test(part)) return null
  }
  return parts.join('/')
}

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp']
