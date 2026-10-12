/**
 * Campaign builder: a concept → (AI or hand-written) draft → vault notes.
 * The draft is plain data the user reviews and edits before anything is written.
 */
import { jsonrepair } from 'jsonrepair'
import { z } from 'zod'
import type { LoreEntry } from './types'
import { PLAY_MODES } from './play'
import { EDITIONS } from './editions'

export const CAMPAIGN_TONES = ['Heroic', 'Grim', 'Horror', 'Mystery', 'Comedic', 'Political intrigue', 'Exploration', 'Swashbuckling', 'Romantic', 'Epic', 'Action', 'Anime', 'Slice of life'] as const
export const CAMPAIGN_SETTINGS = ['Classic high fantasy', 'Coastal & seafaring', 'Frozen north', 'Desert kingdoms', 'Deep jungle', 'City of intrigue', 'The Underdark', 'Gothic lands', 'Planar & strange', 'Modern day', 'Urban fantasy', 'School / academy', 'Sci-fi', 'Post-apocalyptic', 'Your own idea'] as const

/** Long enough for a full pasted campaign prompt. */
export const PREMISE_MAX = 12_000

export const CampaignConceptSchema = z.object({
  name: z.string().max(120).default(''),
  premise: z.string().max(PREMISE_MAX).default(''),
  tones: z.array(z.string().max(40)).max(6).default([]),
  /** Picked setting chips; a campaign can mix several (Modern day + Urban fantasy). */
  settings: z.array(z.string().max(60)).max(CAMPAIGN_SETTINGS.length).default([]),
  /** The player's own setting idea, alongside or instead of the chips. */
  setting: z.string().max(500).default(''),
  levels: z.string().max(40).default('1–5'),
  length: z.enum(['one-shot', 'short', 'long']).default('short'),
  players: z.number().int().min(1).max(8).default(1),
  mode: z.enum(PLAY_MODES).default('ai-dm'),
  edition: z.enum(EDITIONS).default('5e'),
  /** Lines and veils: things to keep out of the story. */
  avoid: z.string().max(1000).default('')
})
export type CampaignConcept = z.infer<typeof CampaignConceptSchema>

// Over-long text and lists are trimmed rather than rejected: models don't count.
const str = (max = 4000) => z.preprocess((v) => (v == null ? '' : typeof v === 'string' ? v : String(v)).slice(0, max), z.string())
const list = <T extends z.ZodTypeAny>(item: T, max = 12) => z.preprocess((v) => (Array.isArray(v) ? v.slice(0, max) : []), z.array(item))

export const CampaignDraftSchema = z.object({
  name: str(120),
  pitch: str(),
  setting: str(),
  tone: str(1000),
  houseRules: str(2000),
  hook: str(),
  opening: str(6000),
  locations: list(z.object({ name: str(120), description: str(2000), keys: list(str(60), 8) })),
  npcs: list(z.object({ name: str(120), role: str(200), description: str(2000), personality: str(1000), want: str(500), secret: str(1000) })),
  factions: list(z.object({ name: str(120), goal: str(500), description: str(2000) }), 8),
  outline: list(z.object({ title: str(120), summary: str(3000) }), 10),
  quests: list(str(300), 10),
  secrets: list(str(1000), 12)
})
export type CampaignDraft = z.infer<typeof CampaignDraftSchema>

export function emptyDraft(name = ''): CampaignDraft {
  return { name, pitch: '', setting: '', tone: '', houseRules: '', hook: '', opening: '', locations: [], npcs: [], factions: [], outline: [], quests: [], secrets: [] }
}

export const BUILDER_SYSTEM = `You are an expert Dungeons & Dragons campaign designer. You turn a concept into a ready-to-run campaign: vivid but concise, with clear hooks, memorable NPCs who each want something, factions with conflicting goals, and secrets the DM can reveal over time. If the concept is based on an existing story or setting, use its names and lore; otherwise avoid well-known published settings and characters and invent your own names. Reply with JSON only. Inside text values, write quotations and dialogue with single quotes ('like this'), never double quotes.`


/** Reads a reply that holds only some of a draft's sections. */
export function parseSections(reply: string): CampaignDraft {
  return CampaignDraftSchema.parse(coerceDraft(extractJson(reply)))
}

/**
 * Pulls a JSON object out of a model reply: code fences, prose around it, and
 * the usual small-model mistakes (trailing commas, comments, single or curly
 * quotes, line breaks inside strings, or a reply cut off mid-way).
 */
export function extractJson(reply: string): unknown {
  const text = reply.replace(/```(?:json|JSON)?/g, '')
  const start = text.indexOf('{')
  if (start === -1) throw new Error('The model didn’t return a campaign (there was no JSON in its reply).')
  const end = text.lastIndexOf('}')
  // The whole object, or (for a reply that was cut off) everything after the first brace.
  const candidates = [...new Set([end > start ? text.slice(start, end + 1) : '', text.slice(start)].filter(Boolean))]
  for (const c of candidates) {
    try {
      return JSON.parse(c)
    } catch {
      // try the next candidate
    }
  }
  // Then with stray quotes escaped ("the vigilante "Shadow," fighting…"), then jsonrepair on top.
  const attempts = candidates.flatMap((c) => [() => JSON.parse(escapeStrayQuotes(c)), () => JSON.parse(jsonrepair(escapeStrayQuotes(c))), () => JSON.parse(jsonrepair(c))])
  for (const attempt of attempts) {
    try {
      return attempt()
    } catch {
      // try the next one
    }
  }
  // Last resort: pull each list out on its own, keeping every item that reads cleanly.
  const lists = salvageLists(text)
  if (Object.keys(lists).length) return lists
  throw new Error('The model’s reply couldn’t be read as a campaign, even after repairs.')
}

/** List fields (and the names models use for them) that salvageLists looks for. */
const SALVAGE_KEYS: Record<string, string[]> = {
  locations: ['locations', 'places'],
  npcs: ['npcs', 'characters'],
  factions: ['factions'],
  outline: ['outline', 'acts', 'chapters'],
  quests: ['quests', 'startingQuests', 'starting_quests'],
  secrets: ['secrets', 'dmSecrets', 'dm_secrets']
}

/**
 * For JSON too broken to repair as a whole (mismatched brackets, a list that
 * mixes objects, "Title": "text" lines and bare sentences, a list missing its
 * brackets): finds each list by its key and reads what it can from it.
 */
export function salvageLists(text: string): Record<string, unknown[]> {
  const marks: { field: string; at: number; start: number }[] = []
  for (const [field, names] of Object.entries(SALVAGE_KEYS)) {
    for (const name of names) {
      for (const m of text.matchAll(new RegExp(`"${name}"\\s*:\\s*\\[?`, 'gi'))) marks.push({ field, at: m.index!, start: m.index! + m[0].length })
    }
  }
  marks.sort((a, b) => a.at - b.at)
  const out: Record<string, unknown[]> = {}
  marks.forEach((mark, i) => {
    if (out[mark.field]) return
    const region = text.slice(mark.start, i + 1 < marks.length ? marks[i + 1]!.at : text.length)
    const items = readListRegion(region)
    if (items.length) out[mark.field] = items
  })
  return out
}

function readListRegion(region: string): unknown[] {
  // The whole list, if it repairs (not when it holds "Title": "text" pairs, which repairs split apart).
  const close = region.lastIndexOf(']')
  const pairs = /"\s*:/.test(region.replace(/\{[^{}]*\}/g, ' '))
  if (close > 0 && !pairs) {
    try {
      const v = JSON.parse(jsonrepair(escapeStrayQuotes(`[${region.slice(0, close)}]`)))
      if (Array.isArray(v) && v.length && v.every((x) => x && (typeof x === 'string' || typeof x === 'object'))) return v
    } catch {
      // read it piece by piece below
    }
  }
  // Objects one by one…
  const items: unknown[] = []
  for (const m of region.matchAll(/\{[^{}]*\}/g)) {
    try {
      items.push(JSON.parse(jsonrepair(m[0])))
    } catch {
      // skip an object that won't read
    }
  }
  // …then loose strings, pairing "Title": "description" (or "Title:" "description").
  const strings = [...region.replace(/\{[^{}]*\}/g, ' ').matchAll(/"((?:[^"\\]|\\.){2,})"\s*(:)?/g)].map((m) => ({ text: m[1]!.replace(/\\"/g, '"').trim(), title: !!m[2] || m[1]!.trim().endsWith(':') }))
  for (let i = 0; i < strings.length; i++) {
    const s = strings[i]!
    const next = strings[i + 1]
    if (s.title && next && !next.title) {
      items.push(`${s.text.replace(/:$/, '')}: ${next.text}`)
      i++
    } else if (s.text) items.push(s.text.replace(/:$/, ''))
  }
  return items
}

/**
 * Escapes double quotes that can't end a JSON string, the commonest small-model
 * mistake: dialogue or a nickname quoted inside a value. A quote ends a string
 * only when what follows is `:`, `}`, `]`, the end, or a comma followed by the
 * start of another value. Raw line breaks inside strings become \n escapes.
 * Valid JSON passes through unchanged.
 */
export function escapeStrayQuotes(text: string): string {
  const skipSpace = (i: number): number => {
    while (i < text.length && /\s/.test(text[i]!)) i++
    return i
  }
  const ends = (from: number): boolean => {
    const j = skipSpace(from)
    const next = text[j]
    if (next === undefined || next === ':' || next === '}' || next === ']') return true
    if (next !== ',') return false
    const k = skipSpace(j + 1)
    const after = text[k]
    return after === undefined || '"{[}]-'.includes(after) || /\d/.test(after) || /^(true|false|null)\b/.test(text.slice(k, k + 6))
  }
  let out = ''
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (!inString) {
      if (c === '"') inString = true
      out += c
    } else if (c === '\\') {
      out += c + (text[i + 1] ?? '')
      i++
    } else if (c === '"') {
      if (ends(i + 1)) {
        inString = false
        out += c
      } else out += '\\"'
    } else if (c === '\n') out += '\\n'
    else if (c !== '\r') out += c
  }
  return out
}

const norm = (k: string): string => k.toLowerCase().replace(/[^a-z]/g, '')

/** Finds a field under any of several names ("house_rules", "House Rules", "houseRules"…). */
function pick(o: Record<string, unknown>, ...names: string[]): unknown {
  const wanted = names.map(norm)
  for (const [k, v] of Object.entries(o)) if (wanted.includes(norm(k))) return v
  return undefined
}

function asText(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(v.every((x) => typeof x === 'string') ? '\n' : ' ')
  if (typeof v === 'object') return Object.values(v as Record<string, unknown>).map(asText).filter(Boolean).join(' ')
  return String(v)
}

function asList(v: unknown): unknown[] {
  if (Array.isArray(v)) return v
  if (v && typeof v === 'object') {
    // {"Cinderhold": "the capital", …} → [{name, description}, …]
    return Object.entries(v as Record<string, unknown>).map(([name, value]) => (value && typeof value === 'object' && !Array.isArray(value) ? { name, ...(value as object) } : { name, description: asText(value) }))
  }
  if (typeof v === 'string' && v.trim()) return v.split(/\n+/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')).filter(Boolean)
  return []
}

/** "Cinderhold – the capital" → name and description. */
function splitNamed(s: string): { name: string; description: string } {
  const m = /^\s*\**([^:–—-]{1,80}?)\**\s*[:–—-]\s+(.*)$/s.exec(s)
  return m ? { name: m[1]!.trim(), description: m[2]!.trim() } : { name: s.trim().slice(0, 80), description: s.trim().length > 80 ? s.trim() : '' }
}

function item(v: unknown, fields: Record<string, string[]>): Record<string, unknown> {
  if (typeof v === 'string') {
    const { name, description } = splitNamed(v)
    return { name, title: name, description, summary: description }
  }
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  return Object.fromEntries(Object.entries(fields).map(([key, names]) => [key, pick(o, key, ...names)]))
}

/** Maps whatever shape a model used onto the draft's fields, before validation. */
export function coerceDraft(raw: unknown): Record<string, unknown> {
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
  // Some models wrap everything: {"campaign": {…}}.
  const inner = pick(o, 'campaign', 'draft', 'data')
  const src = inner && typeof inner === 'object' && !Array.isArray(inner) && Object.keys(o).length <= 2 ? (inner as Record<string, unknown>) : o
  const texts = (v: unknown): string[] => asList(v).map(asText).filter((s) => s.trim())
  return {
    name: asText(pick(src, 'name', 'title', 'campaignName', 'campaignTitle')),
    pitch: asText(pick(src, 'pitch', 'summary', 'premise', 'overview', 'description')),
    setting: asText(pick(src, 'setting', 'world', 'region')),
    tone: asText(pick(src, 'tone', 'themes', 'mood')),
    houseRules: asText(pick(src, 'houseRules', 'rules')),
    hook: asText(pick(src, 'hook', 'adventureHook', 'incitingIncident')),
    opening: asText(pick(src, 'opening', 'openingScene', 'intro', 'introduction', 'readAloud')),
    locations: asList(pick(src, 'locations', 'places', 'areas')).map((v) => {
      const l = item(v, { name: ['title'], description: ['summary', 'details'], keys: ['keywords', 'triggers', 'tags'] })
      return { ...l, keys: texts(l.keys) }
    }),
    npcs: asList(pick(src, 'npcs', 'characters', 'nonPlayerCharacters', 'people')).map((v) =>
      item(v, { name: [], role: ['occupation', 'title', 'job'], description: ['appearance', 'summary'], personality: ['traits', 'demeanor'], want: ['wants', 'goal', 'goals', 'motivation', 'desire'], secret: ['secrets', 'hidden'] })
    ),
    factions: asList(pick(src, 'factions', 'organizations', 'groups')).map((v) => item(v, { name: [], goal: ['goals', 'aim', 'agenda', 'motivation'], description: ['summary'] })),
    outline: asList(pick(src, 'outline', 'acts', 'chapters', 'plot', 'beats', 'arc')).map((v) => item(v, { title: ['name', 'act', 'chapter'], summary: ['description', 'details', 'events'] })),
    quests: texts(pick(src, 'quests', 'startingQuests', 'objectives')),
    secrets: texts(pick(src, 'secrets', 'dmSecrets', 'twists'))
  }
}

/** Reads a draft out of a model reply, repairing what it can. */
export function parseDraft(reply: string): CampaignDraft {
  const draft = CampaignDraftSchema.parse(coerceDraft(extractJson(reply)))
  // Repairs can turn gibberish into an empty object; that's not a campaign.
  const substance = [draft.pitch, draft.setting, draft.hook, draft.opening].some((t) => t.trim()) || draft.locations.length + draft.npcs.length + draft.outline.length > 0
  if (!substance) throw new Error('The model’s reply had no campaign in it.')
  // Drop half-empty list items.
  return {
    ...draft,
    locations: draft.locations.filter((l) => l.name.trim()),
    npcs: draft.npcs.filter((n) => n.name.trim()),
    factions: draft.factions.filter((f) => f.name.trim()),
    outline: draft.outline.filter((o) => o.title.trim() || o.summary.trim()),
    quests: draft.quests.filter((q) => q.trim()),
    secrets: draft.secrets.filter((s) => s.trim())
  }
}

/** Lorebook entries from a draft: the setting, places and factions (no secrets). */
export function draftLore(d: CampaignDraft): LoreEntry[] {
  const words = (name: string): string[] => {
    const first = name.split(/\s+/)[0] ?? ''
    return [...new Set([name.toLowerCase(), first.length > 3 ? first.toLowerCase() : ''].filter(Boolean))]
  }
  const entries: LoreEntry[] = []
  if (d.setting.trim()) entries.push({ title: d.name.trim() || 'The setting', keys: [], content: d.setting.trim(), always_on: true, priority: 0, enabled: true })
  for (const l of d.locations) entries.push({ title: l.name.trim(), keys: [...new Set([...words(l.name), ...l.keys.map((k) => k.toLowerCase().trim()).filter(Boolean)])], content: l.description.trim(), always_on: false, priority: 5, enabled: true })
  for (const f of d.factions) entries.push({ title: f.name.trim(), keys: words(f.name), content: [f.description.trim(), f.goal.trim() ? `Goal: ${f.goal.trim()}` : ''].filter(Boolean).join('\n'), always_on: false, priority: 4, enabled: true })
  // NPCs get notes of their own (see buildCampaign), which reach the prompt the same way.
  // Headings must be unique within a lorebook.
  const seen = new Set<string>()
  return entries.filter((e) => e.title && !seen.has(e.title.toLowerCase()) && seen.add(e.title.toLowerCase()))
}

/** The Campaign.md body: pitch, hook, opening, outline, factions and DM secrets. */
export function draftCampaignBody(d: CampaignDraft): string {
  const parts = [`# ${d.name.trim()}`]
  if (d.pitch.trim()) parts.push(d.pitch.trim())
  if (d.hook.trim()) parts.push(`## The hook\n${d.hook.trim()}`)
  if (d.opening.trim()) parts.push(`## Opening scene\n${d.opening.trim().split('\n').map((l) => `> ${l}`).join('\n')}`)
  if (d.outline.length) parts.push(`## Outline\n${d.outline.map((o) => `### ${o.title.trim() || 'Untitled'}\n${o.summary.trim()}`).join('\n\n')}`)
  if (d.factions.length) parts.push(`## Factions\n${d.factions.map((f) => `- **${f.name.trim()}**${f.goal.trim() ? `: ${f.goal.trim()}` : ''}`).join('\n')}`)
  if (d.npcs.length) parts.push(`## NPCs\n${d.npcs.map((n) => `- [[${n.name.trim()}]]${n.role.trim() ? `, ${n.role.trim()}` : ''}`).join('\n')}`)
  const secrets = [...d.secrets.map((s) => s.trim()), ...d.npcs.filter((n) => n.secret.trim()).map((n) => `${n.name.trim()}: ${n.secret.trim()}`)].filter(Boolean)
  if (secrets.length) parts.push(`## Secrets (for the DM)\n${secrets.map((s) => `- ${s}`).join('\n')}`)
  return `\n${parts.join('\n\n')}\n`
}


// ─── Drafting in pieces ─────────────────────────────────────────────────────

/**
 * A campaign is drafted in five small requests instead of one big one: easier
 * for small models, never past a server's reply cap, and each can be redone on
 * its own from the review step.
 */
export const DRAFT_PIECES = [
  { id: 'overview', label: 'the overview', keys: ['name', 'pitch', 'setting', 'tone', 'houseRules', 'hook', 'opening'] },
  { id: 'locations', label: 'places', keys: ['locations'] },
  { id: 'npcs', label: 'NPCs', keys: ['npcs'] },
  { id: 'factions', label: 'factions', keys: ['factions'] },
  { id: 'story', label: 'the story', keys: ['outline', 'quests', 'secrets'] }
] as const
export type DraftPiece = (typeof DRAFT_PIECES)[number]['id']

const PIECE_SHAPES: Record<DraftPiece, string> = {
  overview: `{
  "name": "campaign name",
  "pitch": "two or three sentences for the players",
  "setting": "two to four sentences about the world and its feel",
  "tone": "one sentence on tone and themes",
  "houseRules": "house rules from the concept, or empty",
  "hook": "why the party gets involved",
  "opening": "the opening scene, read aloud to the players in second person, one paragraph, ending with a question to act on"
}`,
  locations: `{ "locations": [{ "name": "", "description": "one or two sentences", "keys": ["trigger words"] }] }`,
  npcs: `{ "npcs": [{ "name": "", "role": "", "description": "", "personality": "", "want": "", "secret": "" }] }`,
  factions: `{ "factions": [{ "name": "", "goal": "", "description": "" }] }`,
  story: `{ "outline": [{ "title": "Act or chapter", "summary": "" }], "quests": ["one sentence per quest"], "secrets": ["one sentence per secret"] }`
}

function pieceCounts(c: CampaignConcept): Record<'locations' | 'npcs' | 'factions' | 'acts', string> {
  if (c.length === 'one-shot') return { locations: '3', npcs: '3', factions: '1–2', acts: '3 beats' }
  if (c.length === 'short') return { locations: '4–5', npcs: '4–5', factions: '2–3', acts: '3–4 acts' }
  return { locations: '6', npcs: '6', factions: '3', acts: '5–6 acts' }
}

/** What's been written so far, briefly, so later pieces keep the same names (the piece being redrafted is left out). */
function draftSoFar(d: CampaignDraft, piece: DraftPiece): string {
  const lines: string[] = []
  if (piece !== 'overview') {
    if (d.name) lines.push(`Name: ${d.name}`)
    if (d.pitch) lines.push(`Pitch: ${d.pitch}`)
    if (d.setting) lines.push(`Setting: ${d.setting}`)
    if (d.hook) lines.push(`Hook: ${d.hook}`)
  }
  if (piece !== 'locations' && d.locations.length) lines.push(`Places: ${d.locations.map((l) => l.name).join(', ')}`)
  if (piece !== 'npcs' && d.npcs.length) lines.push(`NPCs: ${d.npcs.map((n) => (n.role ? `${n.name} (${n.role})` : n.name)).join(', ')}`)
  if (piece !== 'factions' && d.factions.length) lines.push(`Factions: ${d.factions.map((f) => f.name).join(', ')}`)
  if (piece !== 'story' && d.outline.length) lines.push(`Outline: ${d.outline.map((o) => o.title).join('; ')}`)
  return lines.join('\n')
}

/** Every setting the player picked, plus their own idea: "Modern day + Urban fantasy. The Underworld". */
export function conceptSetting(c: Pick<CampaignConcept, 'settings' | 'setting'>): string {
  const picked = (c.settings ?? []).map((s) => s.trim()).filter(Boolean).join(' + ')
  const own = c.setting.trim()
  return picked && own ? `${picked}. ${own}` : picked || own
}

/**
 * The request for one piece. The concept comes first and is the same for every
 * piece, so local servers can reuse it instead of re-reading it each time.
 */
export function piecePrompt(c: CampaignConcept, d: CampaignDraft, piece: DraftPiece): string {
  const n = pieceCounts(c)
  const lines = [
    c.name.trim() ? `Name: ${c.name.trim()}` : 'Name: invent a fitting one',
    `Premise: ${c.premise.trim() || 'surprise me'}`,
    c.tones.length ? `Tone: ${c.tones.join(', ')}` : '',
    conceptSetting(c) ? `Setting: ${conceptSetting(c)}` : '',
    `Rules: ${c.edition === '3.5e' ? 'D&D 3.5 edition (use 3.5 classes, prestige classes, monsters and skills)' : 'D&D 5th edition'}`,
    `Character levels: ${c.levels || '1–5'}`,
    `Players: ${c.players} ${c.players === 1 ? 'player character' : 'player characters'}`,
    `Length: ${c.length === 'one-shot' ? 'a one-shot (one session)' : c.length === 'short' ? 'a short arc (3–6 sessions)' : 'a long campaign'}`,
    c.mode === 'user-dm' ? 'A human DM will run it, so keep things practical to improvise from.' : 'An AI DM will run it, so make secrets and plans explicit.',
    c.avoid.trim() ? `Keep out of the story: ${c.avoid.trim()}` : ''
  ].filter(Boolean)
  const ask: Record<DraftPiece, string> = {
    overview: 'Write the campaign overview.',
    locations: `Write ${n.locations} key locations.`,
    npcs: `Write ${n.npcs} memorable NPCs, each wanting something, with a secret the DM can reveal.`,
    factions: `Write ${n.factions} factions with conflicting goals.`,
    story: `Write the story: an outline of ${n.acts}, 2–4 starting quests and 3–5 DM-only secrets. Quests and secrets are plain sentences in a list, not objects.`
  }
  const sofar = draftSoFar(d, piece)
  return `Campaign concept:\n${lines.join('\n')}${sofar ? `\n\nThe campaign so far:\n${sofar}` : ''}\n\n${ask[piece]} Keep each text short. Reply with a single JSON object shaped exactly like this:\n${PIECE_SHAPES[piece]}`
}

/** Reads a piece's reply and puts it into the draft (only that piece's fields change). */
export function mergePiece(d: CampaignDraft, piece: DraftPiece, reply: string): CampaignDraft {
  let got: CampaignDraft
  try {
    got = parseSections(reply)
  } catch {
    got = emptyDraft()
  }
  const keys = DRAFT_PIECES.find((p) => p.id === piece)!.keys as readonly (keyof CampaignDraft)[]
  // A repair can "succeed" and still lose lists; fill any that came back empty from the list rescue.
  if (keys.some((k) => Array.isArray(got[k]) && (got[k] as unknown[]).length === 0)) {
    const rescued = CampaignDraftSchema.parse(coerceDraft(salvageLists(reply.replace(/```(?:json|JSON)?/g, ''))))
    for (const k of keys) if (Array.isArray(got[k]) && (got[k] as unknown[]).length === 0) (got as Record<string, unknown>)[k] = rescued[k]
  }
  if (piece === 'overview' ? !got.name.trim() && !got.pitch.trim() && !got.setting.trim() : keys.every((k) => (got[k] as unknown[]).length === 0)) {
    throw new Error(`The model didn’t write ${DRAFT_PIECES.find((p) => p.id === piece)!.label}.`)
  }
  const next = { ...d }
  for (const k of keys) (next as Record<string, unknown>)[k] = got[k]
  return next
}
