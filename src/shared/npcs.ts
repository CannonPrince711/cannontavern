/**
 * NPC notes as lore. Every NPC note that belongs to the campaign becomes a
 * lore entry that's sent when their name (or an alias) comes up in recent
 * messages, so the AI knows who's who without a hand-written lorebook entry.
 */
import type { CharacterCard, LoreEntry } from './types'

/** Words before a name that don't identify anyone on their own. */
const TITLES = new Set(
  (
    'the old young little big lord lady king queen prince princess duke duchess baron baroness count countess earl sir dame ' +
    'master mistress mister madam madame mother father sister brother uncle aunt granny grandma grandpa elder saint ' +
    'captain general commander sergeant chief chieftain emperor empress high grand doctor professor priest priestess ' +
    'archmage magister abbot abbess bishop warden keeper'
  ).split(' ')
)

/**
 * Trigger words for a name: the full name, plus the given name and family
 * name when they're distinctive (titles and short words skipped), plus any
 * aliases. "Queen Maelis Varn" → queen maelis varn, maelis, varn.
 */
export function nameKeys(name: string, aliases: string[] = []): string[] {
  const full = name.trim().toLowerCase()
  // "Aldric of Thornwall", "Gorm the Red": only the part before is their name.
  const own = full.split(/\s+(?:of|the|from|von|van|de)\s+/)[0] ?? full
  const words = own
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}'-]/gu, ''))
    .filter((w) => w.length > 3 && !TITLES.has(w))
  const parts = words.length > 1 ? [words[0]!, words[words.length - 1]!] : words
  return [...new Set([full, ...parts, ...aliases.map((a) => a.trim().toLowerCase())].filter(Boolean))]
}

/** Note body as plain text for the prompt: no title, links as their text, no embeds or bold. */
export function plainNoteText(body: string, name: string): string {
  return body
    .split('\n')
    .filter((line) => !(/^#\s/.test(line.trim()) && line.trim().replace(/^#\s+/, '').toLowerCase() === name.trim().toLowerCase()))
    .join('\n')
    .replace(/!\[\[[^\]]*\]\]/g, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, (_, t: string) => t.split('/').pop()!.replace(/\.md$/i, ''))
    .replace(/\*\*|__/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const MAX_NOTES = 1200

/**
 * One NPC as a lore entry. The DM gets the whole note (wants, secrets and
 * all); when the AI is writing as a player character it gets only what you'd
 * see meeting them: the description and personality.
 */
export function npcLoreEntry(card: CharacterCard, body: string, opts: { forPlayer?: boolean } = {}): LoreEntry {
  const description = card.description.trim()
  const parts = [description ? `NPC. ${description}` : 'NPC.']
  if (card.personality.trim()) parts.push(`Personality: ${card.personality.trim()}`)
  if (!opts.forPlayer) {
    if (card.scenario.trim()) parts.push(card.scenario.trim())
    // The NPC generator repeats the description in the body; don't send it twice.
    let notes = plainNoteText(body, card.name)
      .split(/\n{2,}/)
      .filter((p) => p.trim() && p.trim() !== description)
      .join('\n')
    if (notes.length > MAX_NOTES) notes = `${notes.slice(0, MAX_NOTES).replace(/\s+\S*$/, '')}…`
    if (notes) parts.push(notes)
  }
  return { title: card.name.trim(), keys: nameKeys(card.name, card.aliases), content: parts.join('\n'), always_on: false, priority: 6, enabled: true }
}

/**
 * Adds NPC entries to the lorebook entries. When a lorebook already has an
 * entry with the NPC's name, the two become one: the NPC note first, then
 * anything the lorebook entry adds, with both sets of trigger words.
 */
export function mergeNpcLore(lore: LoreEntry[], npcs: LoreEntry[]): LoreEntry[] {
  const byTitle = new Map(npcs.map((n) => [n.title.toLowerCase(), { ...n }]))
  const rest: LoreEntry[] = []
  for (const e of lore) {
    const npc = e.enabled ? byTitle.get(e.title.trim().toLowerCase()) : undefined
    if (!npc) {
      rest.push(e)
      continue
    }
    npc.keys = [...new Set([...npc.keys, ...e.keys.map((k) => k.toLowerCase())])]
    npc.priority = Math.max(npc.priority, e.priority)
    npc.always_on = npc.always_on || e.always_on
    const known = npc.content.toLowerCase()
    const extra = e.content
      .split(/(?<=[.!?])\s+/)
      .filter((s) => s.trim() && !known.includes(s.trim().toLowerCase()))
      .join(' ')
    if (extra) npc.content = `${npc.content}\n${extra}`
  }
  return [...rest, ...byTitle.values()]
}

const inFolder = (path: string, folder: string): boolean => path.toLowerCase().startsWith(`${folder.toLowerCase().replace(/\/+$/, '')}/`)

/**
 * The campaigns an NPC belongs to: those whose files it links to (the
 * campaign note, a session where they were met…) and those whose campaign
 * note links to it. An NPC tied to none is a recurring character who can
 * turn up anywhere.
 */
export function npcCampaigns(npcPath: string, npcLinks: string[], campaigns: { folder: string; links: string[]; universe?: string }[]): string[] {
  const self = npcPath.toLowerCase()
  return campaigns
    // Linking to the campaign, being linked from it, or linking to its universe (every campaign there).
    .filter((c) => npcLinks.some((l) => inFolder(l, c.folder) || (c.universe && inFolder(l, c.universe))) || c.links.some((l) => l.toLowerCase() === self))
    .map((c) => c.folder)
}

export function npcBelongsTo(campaignFolder: string, tied: string[]): boolean {
  return tied.length === 0 || tied.some((f) => f.toLowerCase() === campaignFolder.toLowerCase())
}
