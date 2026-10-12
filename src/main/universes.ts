/**
 * Universes on disk (see shared/universes.ts): reading and saving the
 * Universe.md notes, and the AI that writes a new universe with its lorebook.
 */
import { FOLDERS } from '@shared/layout'
import { joinVaultPath, sanitizeFileName, toWikilink } from '@shared/names'
import { nameKeys } from '@shared/npcs'
import { BUILTIN_RULESETS } from '@shared/rulesets'
import type { Campaign, LoreEntry, VaultPath } from '@shared/types'
import {
  parseUniverseDraft,
  UNIVERSE_FILE,
  UNIVERSE_SYSTEM,
  UNIVERSES_FOLDER,
  universeDesignPrompt,
  universeFolderFromLink,
  universeFrontmatter,
  universeFromNote,
  type Universe,
  type UniverseDraft
} from '@shared/universes'
import { backendChain } from './backends/chain'
import { resolveTextBackend, textAdapter } from './backends/text'
import { AppError, toErrorInfo } from './errors'
import { saveLorebook } from './library'
import { settingsStore } from './settings-store'
import { parseNote, serializeNote, updateNote } from './vault/frontmatter'
import { vaultService } from './vault/service'
import type { Vault } from './vault/vault'

export async function readUniverse(vault: Vault, folder: VaultPath): Promise<Universe | null> {
  const file = await vault.readIfExists(joinVaultPath(folder, UNIVERSE_FILE)).catch(() => null)
  if (!file) return null
  const { data, body } = parseNote(file.content)
  return universeFromNote(folder, data, body)
}

/** The universe a campaign is set in, if any. */
export async function campaignUniverse(vault: Vault, campaign: Pick<Campaign, 'universe'>): Promise<Universe | null> {
  if (!campaign.universe) return null
  const folder = universeFolderFromLink(campaign.universe, vault.rootFolder)
  return folder ? readUniverse(vault, folder) : null
}

/** Saves a universe: a new folder when it has no path, else over its note (keeping anything else in it). */
export async function saveUniverse(vault: Vault, u: Omit<Universe, 'path' | 'body'> & { path?: string; body?: string }): Promise<Universe> {
  const fields = universeFrontmatter(u)
  let folder = u.path
  if (!folder) {
    const parent = vault.rootPath(UNIVERSES_FOLDER)
    await vault.mkdir(parent)
    folder = joinVaultPath(parent, sanitizeFileName(u.name || 'Universe'))
    for (let i = 2; await vault.exists(joinVaultPath(folder, UNIVERSE_FILE)); i++) folder = joinVaultPath(parent, `${sanitizeFileName(u.name || 'Universe')} ${i}`)
    await vault.mkdir(folder)
  }
  const notePath = joinVaultPath(folder, UNIVERSE_FILE)
  const body = u.body ?? `\n# ${u.name}\n\n${u.blurb ? `${u.blurb}\n\n` : ''}Campaigns set here link to this note with \`universe:\` and share its setting, lorebooks and ruleset.\n`
  await vault.mutate(notePath, (cur) => (cur === null ? serializeNote(fields, body) : updateNote(cur, fields)))
  await vaultService.reindex(notePath)
  return (await readUniverse(vault, folder))!
}

/** Asks the DM's text model for a universe. Returns a draft; nothing is saved. */
export async function generateUniverse(concept: string): Promise<UniverseDraft> {
  const backend = backendChain(settingsStore.get())[0]
  if (!backend) throw new AppError('NO_BACKEND', 'Add a text backend in Settings first: it writes the universe.')
  const resolved = resolveTextBackend(backend)
  const streaming = backend.generation.stream
  const net = streaming ? resolved.net : { ...resolved.net, timeoutMs: Math.max(resolved.net.timeoutMs, 600_000) }
  const ids = BUILTIN_RULESETS.map((r) => r.id)
  const ask = universeDesignPrompt(concept, ids)
  let last = ''
  // A reply that can't be read gets one stricter retry.
  for (const retry of [false, true]) {
    try {
      const r = await textAdapter(backend.type).generate(
        { ...resolved, net },
        { system: UNIVERSE_SYSTEM, messages: [{ role: 'user', content: retry ? `${ask}\n\nReply with the JSON object only, nothing else.` : ask }], maxTokens: 3500 },
        { stream: streaming }
      )
      last = r.text
    } catch (err) {
      throw new AppError('UNIVERSE_FAILED', `Couldn’t ask ${backend.name} for the universe: ${toErrorInfo(err).message}`)
    }
    const draft = parseUniverseDraft(last, ids)
    if (draft) return draft
  }
  throw new AppError('UNIVERSE_FAILED', 'The model didn’t reply with a universe. Try again.', `${backend.name} replied: ${last.trim().slice(0, 300) || '(an empty reply)'}`)
}

/** Writes a drafted universe: the Universe.md note and a lorebook of its places, factions and history. */
export async function createUniverse(vault: Vault, draft: UniverseDraft): Promise<Universe> {
  const entries: LoreEntry[] = [
    ...draft.places.map((e) => ({ ...e, kind: 'Place' })),
    ...draft.factions.map((e) => ({ ...e, kind: 'Faction' })),
    ...draft.history.map((e) => ({ ...e, kind: 'History' }))
  ].map((e, i) => ({ title: e.name, keys: nameKeys(e.name), content: `${e.kind}. ${e.text}`, always_on: false, priority: 5 - Math.floor(i / 20), enabled: true }))
  const links: string[] = []
  if (entries.length) {
    const dir = vault.rootPath(FOLDERS.lorebooks)
    await vault.mkdir(dir)
    const bookPath = await vault.uniquePath(dir, sanitizeFileName(`${draft.name} lore`), '.md')
    await saveLorebook(vault, { path: bookPath, name: `${draft.name} lore`, entries, mtimeMs: 0, hash: '', intro: `Places, factions and history of the ${draft.name} universe, shared by every campaign set there.` })
    await vaultService.reindex(bookPath)
    links.push(toWikilink(bookPath, { full: true }))
  }
  return saveUniverse(vault, {
    name: draft.name,
    blurb: draft.blurb,
    tone: draft.tone,
    setting: draft.setting,
    ...(draft.ruleset ? { ruleset: draft.ruleset } : {}),
    lorebooks: links
  })
}
