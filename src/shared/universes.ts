/**
 * Universes: a world that several campaigns share. A universe note
 * (Universes/<Name>/Universe.md) holds the setting bible, a default ruleset
 * and lorebooks; each campaign in it links to the note with `universe:`.
 *
 * What a campaign gets from its universe: the bible in the DM prompt, the
 * universe's lorebooks, its ruleset when the campaign has none, NPCs that link
 * into the universe folder, and characters added to the whole universe.
 * Characters copied in from another universe are crossovers: the DM is told
 * where they come from and to translate their abilities.
 */
import { extractJson } from './builder'
import { joinVaultPath, toWikilink, wikilinkTarget } from './names'

export const UNIVERSES_FOLDER = 'Universes'
export const UNIVERSE_FILE = 'Universe.md'

export interface Universe {
  /** Folder path, e.g. "DND Vault/Universes/The Shattered Realms". */
  path: string
  name: string
  /** One line for pickers. */
  blurb: string
  /** The setting bible: what the world is, its history, places, powers and conflicts. */
  setting: string
  tone: string
  /** Default ruleset for its campaigns (id or link, see rulesets.ts). */
  ruleset?: string
  /** Wikilinks to lorebooks every campaign in the universe uses. */
  lorebooks: string[]
  body: string
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : [])

export function universeFromNote(path: string, data: Record<string, unknown>, body: string): Universe {
  return {
    path,
    name: str(data.name) || (path.split('/').pop() ?? 'Universe'),
    blurb: str(data.blurb),
    setting: str(data.setting),
    tone: str(data.tone),
    ...(str(data.ruleset) ? { ruleset: str(data.ruleset) } : {}),
    lorebooks: strs(data.lorebooks),
    body
  }
}

export function universeFrontmatter(u: Omit<Universe, 'path' | 'body'>): Record<string, unknown> {
  return {
    type: 'universe',
    name: u.name,
    blurb: u.blurb || undefined,
    tone: u.tone || undefined,
    ruleset: u.ruleset || undefined,
    lorebooks: u.lorebooks.length ? u.lorebooks : undefined,
    setting: u.setting
  }
}

/** The `universe:` link a campaign stores. */
export function universeLink(folder: string, name?: string): string {
  return toWikilink(joinVaultPath(folder, UNIVERSE_FILE), { full: true, alias: name ?? folder.split('/').pop() })
}

/** "[[DND Vault/Universes/X/Universe|X]]", "Universes/X" or "X" → the universe folder. */
export function universeFolderFromLink(link: string, rootFolder: string): string | null {
  const target = wikilinkTarget(link).replace(/\.md$/i, '')
  if (!target) return null
  const parts = joinVaultPath(target).split('/')
  const i = parts.findIndex((p) => p.toLowerCase() === UNIVERSES_FOLDER.toLowerCase())
  if (i > 0 && parts[i + 1]) return joinVaultPath(...parts.slice(0, i + 2))
  if (i === 0 && parts[1]) return joinVaultPath(rootFolder, UNIVERSES_FOLDER, parts[1])
  if (i === -1 && parts.length === 1) return joinVaultPath(rootFolder, UNIVERSES_FOLDER, parts[0]!)
  return null
}

/** True for a link into a universe folder (as opposed to a campaign). */
export function isUniverseLink(link: string): boolean {
  return new RegExp(`(^|/)${UNIVERSES_FOLDER}/`, 'i').test(wikilinkTarget(link))
}

/** The block the DM sees about the universe, ahead of the campaign's own setting. */
export function universePromptBlock(u: Universe): string {
  return [`Universe: ${u.name}. This campaign is one story in a larger world; keep to its facts.`, u.setting, u.tone ? `Universe tone: ${u.tone}` : '']
    .filter(Boolean)
    .join('\n')
}

export interface Crossover {
  name: string
  /** Universe or campaign they come from. */
  from: string
  /** Rules they were made under, when different. */
  rules?: string
}

/** Tells the DM about characters visiting from another world. */
export function crossoverBlock(list: Crossover[], here: { universe?: string; rules: string }): string {
  if (!list.length) return ''
  const lines = list.map((c) => `- ${c.name} comes from ${c.from}${c.rules && c.rules !== here.rules ? ` (made under ${c.rules})` : ''}.`)
  return [
    `Crossover: ${list.length === 1 ? 'this character has' : 'these characters have'} crossed over from another world into ${here.universe ?? 'this one'}:`,
    ...lines,
    `They keep their personality, memories and history. Translate their powers, gear and numbers into ${here.rules}, keeping what they can do recognisable, and let the world react to how strange they are.`
  ].join('\n')
}

// ─── AI-made universes ───────────────────────────────────────────────────────

export interface UniverseDraft {
  name: string
  blurb: string
  tone: string
  setting: string
  /** A built-in ruleset id that fits, or "". */
  ruleset: string
  places: { name: string; text: string }[]
  factions: { name: string; text: string }[]
  history: { name: string; text: string }[]
}

export const UNIVERSE_SYSTEM = `You are a worldbuilder for tabletop roleplaying games. You create rich, original settings that many different campaigns can be set in. Reply with JSON only. Inside text values, use single quotes, never double quotes.`

export function universeDesignPrompt(concept: string, rulesetIds: string[]): string {
  return `Create a universe (a shared setting) for this idea: ${concept.trim() || 'surprise me'}

If the idea names an existing franchise, setting or genre, build an original world in that spirit (new names), unless it is plainly the user's own world.
Make it big enough for many campaigns: several regions, competing powers, open mysteries and conflicts that never fully resolve.

Reply with:
{"name": "the universe's name", "blurb": "one sentence pitch", "tone": "a few words on mood",
 "setting": "the setting bible for a game master, 250-400 words: what the world is, how it works (magic, tech, powers), its history in brief, the major powers, what ordinary life is like, and the big tensions",
 "ruleset": "the best fit of: ${rulesetIds.join(', ')}",
 "places": [{"name": "...", "text": "2-3 sentences"}],
 "factions": [{"name": "...", "text": "2-3 sentences: what they want and how they get it"}],
 "history": [{"name": "an era or event", "text": "1-2 sentences"}]}
Give 5-8 places, 4-6 factions and 3-5 history entries.`
}

const entries = (v: unknown, n: number): { name: string; text: string }[] =>
  (Array.isArray(v) ? v : [])
    .map((e) => (e && typeof e === 'object' ? (e as Record<string, unknown>) : {}))
    .map((e) => ({ name: str(e.name).slice(0, 80), text: str(e.text ?? e.description).slice(0, 800) }))
    .filter((e) => e.name && e.text)
    .slice(0, n)

/** Reads the AI's reply; null when it isn't a universe. */
export function parseUniverseDraft(reply: string, rulesetIds: string[]): UniverseDraft | null {
  let raw: unknown
  try {
    raw = extractJson(reply)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const name = str(o.name).slice(0, 80)
  const setting = str(o.setting).slice(0, 6000)
  if (!name || !setting) return null
  const ruleset = str(o.ruleset)
  return {
    name,
    blurb: str(o.blurb).slice(0, 300),
    tone: str(o.tone).slice(0, 300),
    setting,
    ruleset: rulesetIds.includes(ruleset) ? ruleset : '',
    places: entries(o.places, 12),
    factions: entries(o.factions, 10),
    history: entries(o.history, 8)
  }
}

/** A campaign as its prompt sees it: the universe's bible first, its lorebooks added, its ruleset when the campaign has none. */
export function withUniverse<T extends { setting: string; lorebooks: string[]; ruleset?: string }>(c: T, u: Universe | null): T {
  if (!u) return c
  return {
    ...c,
    setting: [universePromptBlock(u), c.setting.trim() ? `This campaign: ${c.setting.trim()}` : ''].filter(Boolean).join('\n\n'),
    lorebooks: [...new Set([...c.lorebooks, ...u.lorebooks])],
    ...(c.ruleset || !u.ruleset ? {} : { ruleset: u.ruleset })
  }
}
