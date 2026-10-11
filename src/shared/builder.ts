/**
 * Campaign builder: a concept → (AI or hand-written) draft → vault notes.
 * The draft is plain data the user reviews and edits before anything is written.
 */
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

const str = (max = 4000) => z.preprocess((v) => (v == null ? '' : typeof v === 'string' ? v : String(v)), z.string().max(max))
const list = <T extends z.ZodTypeAny>(item: T, max = 12) => z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(item).max(max))

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

export function builderPrompt(c: CampaignConcept): string {
  const size = c.length === 'one-shot' ? 'a one-shot (one session): 3 locations, 3 NPCs, 1–2 factions, a 3-beat outline' : c.length === 'short' ? 'a short arc (3–6 sessions): 4–5 locations, 4–5 NPCs, 2–3 factions, a 3–4 act outline' : 'a long campaign: 6 locations, 6 NPCs, 3 factions, a 5–6 act outline'
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

/** Reads a draft out of a model reply (tolerates code fences and prose around the JSON). */
export function parseDraft(reply: string): CampaignDraft {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('The model did not return a campaign (no JSON found).')
  let data: unknown
  try {
    data = JSON.parse(reply.slice(start, end + 1))
  } catch {
    throw new Error('The model returned invalid JSON. Try again, or use a stronger model.')
  }
  const draft = CampaignDraftSchema.parse(data)
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

/** Lorebook entries from a draft: what players may learn (no secrets). */
export function draftLore(d: CampaignDraft): LoreEntry[] {
  const words = (name: string): string[] => {
    const first = name.split(/\s+/)[0] ?? ''
    return [...new Set([name.toLowerCase(), first.length > 3 ? first.toLowerCase() : ''].filter(Boolean))]
  }
  const entries: LoreEntry[] = []
  if (d.setting.trim()) entries.push({ title: d.name.trim() || 'The setting', keys: [], content: d.setting.trim(), always_on: true, priority: 0, enabled: true })
  for (const l of d.locations) entries.push({ title: l.name.trim(), keys: [...new Set([...words(l.name), ...l.keys.map((k) => k.toLowerCase().trim()).filter(Boolean)])], content: l.description.trim(), always_on: false, priority: 5, enabled: true })
  for (const f of d.factions) entries.push({ title: f.name.trim(), keys: words(f.name), content: [f.description.trim(), f.goal.trim() ? `Goal: ${f.goal.trim()}` : ''].filter(Boolean).join('\n'), always_on: false, priority: 4, enabled: true })
  for (const n of d.npcs) {
    const content = [n.role.trim() && `${n.role.trim()}.`, n.description.trim(), n.personality.trim() && `Personality: ${n.personality.trim()}`].filter(Boolean).join(' ')
    entries.push({ title: n.name.trim(), keys: words(n.name), content, always_on: false, priority: 6, enabled: true })
  }
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
