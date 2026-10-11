/**
 * Campaign builder: a concept → (AI or hand-written) draft → vault notes.
 * The draft is plain data the user reviews and edits before anything is written.
 */
import { jsonrepair } from 'jsonrepair'
import { z } from 'zod'
import type { LoreEntry } from './types'
import { PLAY_MODES } from './play'
import { EDITIONS } from './editions'

export const CAMPAIGN_TONES = ['Heroic', 'Grim', 'Horror', 'Mystery', 'Comedic', 'Political intrigue', 'Exploration', 'Swashbuckling', 'Romantic', 'Epic'] as const
export const CAMPAIGN_SETTINGS = ['Classic high fantasy', 'Coastal & seafaring', 'Frozen north', 'Desert kingdoms', 'Deep jungle', 'City of intrigue', 'The Underdark', 'Gothic lands', 'Planar & strange', 'Your own idea'] as const

export const CampaignConceptSchema = z.object({
  name: z.string().max(120).default(''),
  premise: z.string().max(4000).default(''),
  tones: z.array(z.string().max(40)).max(6).default([]),
  setting: z.string().max(200).default(''),
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

export const BUILDER_SYSTEM = `You are an expert Dungeons & Dragons 5th edition campaign designer. You turn a short concept into a ready-to-run campaign: vivid but concise, with clear hooks, memorable NPCs who each want something, factions with conflicting goals, and secrets the DM can reveal over time. Avoid well-known published settings and characters; invent your own names. Reply with JSON only.`

const SHAPE = `{
  "name": "campaign name",
  "pitch": "one-paragraph summary for the players",
  "setting": "2–4 sentences about the region and its feel",
  "tone": "one sentence on tone and themes",
  "houseRules": "optional house rules, or empty",
  "hook": "why the party gets involved",
  "opening": "the opening scene, read aloud to the players in second person, ending with a question to act on",
  "locations": [{ "name": "", "description": "", "keys": ["trigger words"] }],
  "npcs": [{ "name": "", "role": "", "description": "", "personality": "", "want": "", "secret": "" }],
  "factions": [{ "name": "", "goal": "", "description": "" }],
  "outline": [{ "title": "Act or chapter", "summary": "" }],
  "quests": ["starting quest"],
  "secrets": ["DM-only truths"]
}`

export function builderPrompt(c: CampaignConcept, opts: { compact?: boolean } = {}): string {
  const size = opts.compact
    ? 'a small campaign: 3 locations, 3 NPCs, 2 factions, a 3-beat outline. Keep every text field to one or two sentences'
    : c.length === 'one-shot' ? 'a one-shot (one session): 3 locations, 3 NPCs, 1–2 factions, a 3-beat outline' : c.length === 'short' ? 'a short arc (3–6 sessions): 4–5 locations, 4–5 NPCs, 2–3 factions, a 3–4 act outline' : 'a long campaign: 6 locations, 6 NPCs, 3 factions, a 5–6 act outline'
  const lines = [
    c.name.trim() ? `Name: ${c.name.trim()}` : 'Name: invent a fitting one',
    `Premise: ${c.premise.trim() || 'surprise me'}`,
    c.tones.length ? `Tone: ${c.tones.join(', ')}` : '',
    c.setting.trim() ? `Setting: ${c.setting.trim()}` : '',
    `Rules: ${c.edition === '3.5e' ? 'D&D 3.5 edition (use 3.5 classes, prestige classes, monsters and skills)' : 'D&D 5th edition'}`,
    `Character levels: ${c.levels || '1–5'}`,
    `Players: ${c.players} ${c.players === 1 ? 'player character' : 'player characters'}`,
    `Size: ${size}`,
    c.mode === 'user-dm' ? 'A human DM will run it, so make the outline and secrets practical to improvise from.' : 'An AI DM will run it, so make the secrets and outline explicit.',
    c.avoid.trim() ? `Keep out of the story: ${c.avoid.trim()}` : ''
  ].filter(Boolean)
  return `Design a campaign from this concept.\n\n${lines.join('\n')}\n\nReply with a single JSON object shaped exactly like this:\n${SHAPE}`
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
  for (const c of candidates) {
    try {
      return JSON.parse(jsonrepair(c))
    } catch {
      // try the next candidate
    }
  }
  throw new Error('The model’s reply couldn’t be read as a campaign, even after repairs.')
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
