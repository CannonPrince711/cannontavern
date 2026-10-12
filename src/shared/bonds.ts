/**
 * Relationships between characters ("lover status") and big story events.
 * The DM marks turning points with hidden tags at the end of a reply:
 *   <bond>{"a":"Kazuki","b":"Seraphine","status":"lovers"}</bond>
 *   <milestone>{"who":"Kazuki","event":"awakened Balance Breaker","look":"crimson dragon-scale armour"}</milestone>
 * The app strips them, keeps the relationships in Party.md, posts a short
 * note in the chat and, for events that change how someone looks, paints a
 * new portrait.
 */

export const BOND_STATUSES = ['strangers', 'acquaintances', 'friends', 'close friends', 'crush', 'dating', 'lovers', 'engaged', 'married', 'rivals', 'enemies', 'exes'] as const

export interface Bond {
  a: string
  b: string
  status: string
  /** When it turned to this status, e.g. "Session 03". */
  since?: string
  note?: string
}

export interface Milestone {
  who: string
  event: string
  /** What changed visually (outfit, armour, scar, transformation…), for the new portrait. */
  look: string
}

/** Relationship turns that are big enough for new portraits of both, with the look they add. */
export const BOND_PORTRAIT_LOOK: Record<string, string> = {
  lovers: 'glowing, in love, soft warm smile',
  engaged: 'wearing an engagement ring, happy, glowing',
  married: 'wearing a wedding ring, radiant, joyful'
}

const ICON: Record<string, string> = {
  crush: '💗',
  dating: '💕',
  lovers: '💞',
  engaged: '💍',
  married: '💒',
  rivals: '⚔️',
  enemies: '🗡️',
  exes: '💔'
}

export function bondIcon(status: string): string {
  return ICON[status.trim().toLowerCase()] ?? '🤝'
}

const pairKey = (a: string, b: string): string => [a.trim().toLowerCase(), b.trim().toLowerCase()].sort().join('|')

/** Reads the `bonds` list of Party.md leniently. */
export function parseBonds(raw: unknown): Bond[] {
  if (!Array.isArray(raw)) return []
  const out: Bond[] = []
  const seen = new Set<string>()
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const a = typeof o.a === 'string' ? o.a.trim() : ''
    const b = typeof o.b === 'string' ? o.b.trim() : ''
    const status = typeof o.status === 'string' ? o.status.trim().toLowerCase() : ''
    if (!a || !b || !status || a.toLowerCase() === b.toLowerCase() || seen.has(pairKey(a, b))) continue
    seen.add(pairKey(a, b))
    out.push({ a, b, status, ...(typeof o.since === 'string' && o.since.trim() ? { since: o.since.trim() } : {}), ...(typeof o.note === 'string' && o.note.trim() ? { note: o.note.trim() } : {}) })
  }
  return out
}

/** Sets a pair's status; returns the new list and the status it had before (undefined if new). */
export function setBond(bonds: Bond[], change: Bond): { bonds: Bond[]; previous: string | undefined; changed: boolean } {
  const key = pairKey(change.a, change.b)
  const i = bonds.findIndex((x) => pairKey(x.a, x.b) === key)
  const status = change.status.trim().toLowerCase()
  if (i === -1) return { bonds: [...bonds, { ...change, status }], previous: undefined, changed: true }
  const previous = bonds[i]!.status
  if (previous === status) return { bonds, previous, changed: false }
  const next = bonds.slice()
  next[i] = { ...bonds[i]!, status, ...(change.since ? { since: change.since } : {}), ...(change.note ? { note: change.note } : {}) }
  return { bonds: next, previous, changed: true }
}

/** One line for prompts: who is what to whom. */
export function renderBonds(bonds: Bond[]): string {
  if (!bonds.length) return ''
  return `Relationships: ${bonds.map((b) => `${b.a} & ${b.b}: ${b.status}${b.since ? ` (since ${b.since})` : ''}`).join('; ')}`
}

export const STORY_TAGS_INSTRUCTION = `Story tracking: only at real turning points, end your reply with hidden lines in these exact formats (omit them otherwise):
- A relationship between two characters clearly changes: <bond>{"a":"Name","b":"Name","status":"friends"}</bond>. Status is one of: ${BOND_STATUSES.join(', ')}. Romance only between consenting adults.
- Something big changes how a character looks (new armour or outfit, a transformation, a lasting scar, a wedding, a promotion): <milestone>{"who":"Name","event":"what happened, a few words","look":"the visible change, a few words"}</milestone>.`

const BOND_RE = /<bond>([\s\S]*?)<\/bond>/gi
const MILESTONE_RE = /<milestone>([\s\S]*?)<\/milestone>/gi

/** Strips the story tags from a reply and returns what they said. */
export function extractStory(text: string): { text: string; bonds: Bond[]; milestones: Milestone[] } {
  const bonds: Bond[] = []
  const milestones: Milestone[] = []
  const read = (json: string): Record<string, unknown> | null => {
    try {
      const v = JSON.parse(json) as unknown
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
    } catch {
      return null
    }
  }
  let clean = text.replace(BOND_RE, (_, json: string) => {
    const o = read(json)
    const a = typeof o?.a === 'string' ? o.a.trim() : ''
    const b = typeof o?.b === 'string' ? o.b.trim() : ''
    const status = typeof o?.status === 'string' ? o.status.trim().toLowerCase() : ''
    if (a && b && status && a.toLowerCase() !== b.toLowerCase()) bonds.push({ a, b, status })
    return ''
  })
  clean = clean.replace(MILESTONE_RE, (_, json: string) => {
    const o = read(json)
    const who = typeof o?.who === 'string' ? o.who.trim() : ''
    const event = typeof o?.event === 'string' ? o.event.trim().slice(0, 200) : ''
    const look = typeof o?.look === 'string' ? o.look.trim().slice(0, 300) : ''
    if (who && (event || look)) milestones.push({ who, event: event || look, look })
    return ''
  })
  return { text: clean.replace(/\n{3,}/g, '\n\n').trim(), bonds, milestones }
}
