/**
 * Reading and writing the app's notes (characters, campaigns, parties,
 * presets, lorebooks). Writes go through updateNote so keys and text the user
 * added in Obsidian survive, and through the Vault's conflict check.
 */
import { CAMPAIGN_FILE, FOLDERS, IMAGES_FOLDER, PARTY_FILE, SESSIONS_FOLDER } from '@shared/layout'
import { joinVaultPath, noteName, sanitizeFileName, wikilinkTarget } from '@shared/names'
import {
  cardToFrontmatter,
  defaultCard,
  normalizeCampaign,
  normalizeCard,
  normalizeParty,
  parseLorebookBody,
  serializeLorebookBody
} from '@shared/notes'
import type { PromptPreset } from '@shared/prompt'
import type { Campaign, CharacterNote, Lorebook, Party, VaultPath } from '@shared/types'
import { AppError } from './errors'
import { parseNote, serializeNote, updateNote } from './vault/frontmatter'
import type { Vault } from './vault/vault'

// ─── Characters ─────────────────────────────────────────────────────────────

export async function readCharacter(vault: Vault, path: VaultPath): Promise<CharacterNote> {
  const file = await vault.readIfExists(path)
  if (!file) throw new AppError('NOT_FOUND', `The character note “${path}” no longer exists.`)
  const { data, body } = parseNote(file.content)
  return { path, card: normalizeCard(data, noteName(path)), body, mtimeMs: file.state.mtimeMs, hash: file.state.hash }
}

/** Saves a character, refusing if the note changed on disk since `note.hash` (unless forced). */
export async function saveCharacter(vault: Vault, note: CharacterNote, force = false): Promise<CharacterNote> {
  const file = await vault.readIfExists(note.path)
  const base = file?.content ?? ''
  const next = file ? updateNote(base, cardToFrontmatter(note.card), note.body) : serializeNote(cardToFrontmatter(note.card), note.body)
  await vault.write(note.path, next, force ? { force: true } : { baseHash: file ? note.hash : null })
  return readCharacter(vault, note.path)
}

export async function createCharacter(vault: Vault, name: string, npc = false): Promise<CharacterNote> {
  const folder = vault.rootPath(npc ? FOLDERS.npcs : FOLDERS.characters)
  const path = await vault.uniquePath(folder, sanitizeFileName(name), '.md')
  const card = { ...defaultCard(name.trim() || 'New character') }
  await vault.write(path, serializeNote({ type: npc ? 'npc' : 'character', ...cardToFrontmatter(card) }, '\n'), { baseHash: null })
  return readCharacter(vault, path)
}

/** Writes a new character note from a full card (used by import). */
export async function createCharacterFromCard(vault: Vault, card: CharacterNote['card'], body = '\n', npc = false): Promise<CharacterNote> {
  const folder = vault.rootPath(npc ? FOLDERS.npcs : FOLDERS.characters)
  const path = await vault.uniquePath(folder, sanitizeFileName(card.name), '.md')
  await vault.write(path, serializeNote({ type: npc ? 'npc' : 'character', ...cardToFrontmatter(card) }, body), { baseHash: null })
  return readCharacter(vault, path)
}

/** Finds a character note from a wikilink ("[[Aria]]" or "[[DND Tavern/Characters/Aria|Aria]]"). */
export async function resolveCharacterLink(vault: Vault, link: string): Promise<VaultPath | null> {
  const target = wikilinkTarget(link)
  if (!target) return null
  const candidates = target.includes('/')
    ? [`${target}.md`, target]
    : [vault.rootPath(FOLDERS.characters, `${target}.md`), vault.rootPath(FOLDERS.npcs, `${target}.md`)]
  for (const c of candidates) if (c.endsWith('.md') && (await vault.exists(c))) return joinVaultPath(c)
  return null
}

// ─── Campaigns ──────────────────────────────────────────────────────────────

export async function readCampaign(vault: Vault, folder: VaultPath): Promise<{ campaign: Campaign; party: Party }> {
  const name = noteName(folder)
  const cFile = await vault.readIfExists(joinVaultPath(folder, CAMPAIGN_FILE))
  const pFile = await vault.readIfExists(joinVaultPath(folder, PARTY_FILE))
  const c = cFile ? parseNote(cFile.content) : { data: {}, body: '' }
  const p = pFile ? parseNote(pFile.content) : { data: {}, body: '' }
  return { campaign: normalizeCampaign(folder, name, c.data, c.body), party: normalizeParty(p.data, p.body) }
}

/**
 * A campaign's own models, from its Campaign.md frontmatter, under image_models or text_models:
 *   image_models:
 *     portrait: FLUX1/flux1-dev-fp8.safetensors
 *   text_models:
 *     chat: Gemsicle-31B-Q4_K_M.gguf
 * Anything the note doesn't name uses the app's global settings.
 */
export async function readCampaignModelMap(vault: Vault, folder: VaultPath, key: 'image_models' | 'text_models'): Promise<Record<string, string>> {
  const cFile = await vault.readIfExists(joinVaultPath(folder, CAMPAIGN_FILE))
  if (!cFile) return {}
  const raw = parseNote(cFile.content).data[key]
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const models: Record<string, string> = {}
  for (const [purpose, model] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof model === "string" && model.trim()) models[purpose] = model.trim()
  }
  return models
}

export async function createCampaign(
  vault: Vault,
  name: string,
  fields: Partial<Pick<Campaign, 'setting' | 'tone' | 'house_rules' | 'body'>> = {}
): Promise<Campaign> {
  const folderName = sanitizeFileName(name)
  const folder = vault.rootPath(FOLDERS.campaigns, folderName)
  if (await vault.exists(joinVaultPath(folder, CAMPAIGN_FILE))) {
    throw new AppError('EXISTS', `A campaign called “${folderName}” already exists.`)
  }
  await vault.mkdir(joinVaultPath(folder, SESSIONS_FOLDER))
  await vault.mkdir(joinVaultPath(folder, IMAGES_FOLDER))
  await vault.write(
    joinVaultPath(folder, CAMPAIGN_FILE),
    serializeNote(
      { type: 'campaign', name, setting: fields.setting ?? '', tone: fields.tone ?? '', house_rules: fields.house_rules ?? '', lorebooks: [] },
      fields.body ?? `\n# ${name}\n\nNotes about the world, factions and secrets go here.\n`
    ),
    { baseHash: null }
  )
  await vault.write(
    joinVaultPath(folder, PARTY_FILE),
    serializeNote({ type: 'party', gold: 0, inventory: [], quests: [] }, `\n# Party\n\nShared notes for the party.\n`),
    { baseHash: null }
  )
  return (await readCampaign(vault, folder)).campaign
}

export async function saveParty(vault: Vault, folder: VaultPath, party: Party): Promise<Party> {
  const path = joinVaultPath(folder, PARTY_FILE)
  await vault.mutate(path, (cur) => {
    const fm = { type: 'party', gold: party.gold, inventory: party.inventory, quests: party.quests }
    return cur === null ? serializeNote(fm, party.body) : updateNote(cur, fm, party.body)
  })
  return (await readCampaign(vault, folder)).party
}

// ─── Presets and lorebooks ──────────────────────────────────────────────────

/** A preset note: frontmatter `dm_mode`, body = the system prompt. */
export async function readPreset(vault: Vault, path: VaultPath): Promise<PromptPreset | null> {
  const file = await vault.readIfExists(path)
  if (!file) return null
  const { data, body } = parseNote(file.content)
  return {
    name: typeof data.name === 'string' ? data.name : noteName(path),
    system_prompt: (typeof data.system_prompt === 'string' && data.system_prompt) || body.trim(),
    dm_mode: data.dm_mode !== false
  }
}

export async function readLorebook(vault: Vault, path: VaultPath): Promise<Lorebook & { intro: string }> {
  const file = await vault.readIfExists(path)
  if (!file) throw new AppError('NOT_FOUND', `The lorebook “${path}” no longer exists.`)
  const { data, body } = parseNote(file.content)
  const { intro, entries } = parseLorebookBody(body)
  return {
    path,
    name: typeof data.name === 'string' ? data.name : noteName(path),
    entries,
    intro,
    mtimeMs: file.state.mtimeMs,
    hash: file.state.hash
  }
}

export async function saveLorebook(vault: Vault, book: Lorebook & { intro?: string }, force = false): Promise<Lorebook> {
  const file = await vault.readIfExists(book.path)
  const intro = book.intro ?? (file ? parseLorebookBody(parseNote(file.content).body).intro : '')
  const body = serializeLorebookBody(intro, book.entries)
  const next = file ? updateNote(file.content, { type: 'lorebook' }, body) : serializeNote({ type: 'lorebook', name: book.name }, body)
  await vault.write(book.path, next, force ? { force: true } : { baseHash: file ? book.hash : null })
  return readLorebook(vault, book.path)
}

/** Resolves lorebook wikilinks from a campaign note to existing lorebook paths. */
export async function resolveLorebookLinks(vault: Vault, links: string[]): Promise<VaultPath[]> {
  const out: VaultPath[] = []
  for (const link of links) {
    const target = wikilinkTarget(link)
    if (!target) continue
    const path = target.includes('/') ? `${target.replace(/\.md$/i, '')}.md` : vault.rootPath(FOLDERS.lorebooks, `${target}.md`)
    if (await vault.exists(path)) out.push(joinVaultPath(path))
  }
  return out
}
