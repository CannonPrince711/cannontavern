/**
 * Idea generator: random ingredients ("idea dice") plus the chat model turn into
 * pitches for campaigns, one-shots, characters and universes. A pitch is plain
 * data; "Use this" hands it to the matching creator (campaign builder, new
 * character, universes) already filled in. Nothing is written by generating.
 */
import { jsonrepair } from 'jsonrepair'
import { z } from 'zod'
import { CAMPAIGN_SETTINGS, CAMPAIGN_TONES, extractJson } from './builder'

export const IDEA_KINDS = [
  { id: 'campaign', label: 'Campaigns', one: 'campaign' },
  { id: 'oneshot', label: 'One-shots', one: 'one-shot' },
  { id: 'character', label: 'Characters', one: 'character' },
  { id: 'universe', label: 'Worlds', one: 'universe' }
] as const
export type IdeaKind = (typeof IDEA_KINDS)[number]['id']
export const IDEA_KIND_IDS = IDEA_KINDS.map((k) => k.id) as [IdeaKind, ...IdeaKind[]]

/** Vibe chips: a subset of the builder's tones, so a pitch's vibe carries straight into the campaign builder. */
export const IDEA_VIBES = ['Heroic', 'Dark fantasy', 'Horror', 'Mystery', 'Comedic', 'Cozy', 'Political intrigue', 'Heist', 'Swashbuckling', 'Romantic', 'Spicy (18+)'] as const

export const IDEA_COUNT_MAX = 6

export const IdeaRequestSchema = z.object({
  kind: z.enum(IDEA_KIND_IDS),
  count: z.number().int().min(1).max(IDEA_COUNT_MAX).default(4),
  vibes: z.array(z.string().max(40)).max(6).default([]),
  /** The player's own words: a theme, a name, "for my Drowned Crown campaign"… */
  theme: z.string().max(500).default('')
})
export type IdeaRequest = z.infer<typeof IdeaRequestSchema>

// ---------- Idea dice ----------
const SETTINGS = [
  "a city built inside a dead god's ribcage", 'a sky of floating islands over a bottomless storm', 'a desert of glass that remembers footsteps',
  "a drowned empire's flooded capital", 'an endless winter forest', 'a moon-sized clockwork machine', 'a fey court frozen at a feast',
  'a megacity where magic is code', 'a manor seen at mouse size', 'a mining town over something alive', 'a pilgrim road between two warring heavens',
  'a carnival that travels between worlds', 'a swamp where time runs backwards', 'an archipelago of sleeping titans', 'a library the size of a continent',
  'a frontier of iron trains and old spirits', 'an underground sea lit by fungus', 'a vampire-ruled river kingdom', "the inside of a giant's dream",
  'a prison plane for gods', 'a jungle grown over a fallen star', 'a salt flat of mirages and mirror-folk'
]
const HEROES = [
  'oath-bound knights', 'ghosts possessing the living', 'smugglers with a stolen relic', 'monster hunters with cursed blood', "the villain's former henchmen",
  'exiled royals', 'couriers who never miss a delivery', 'a travelling theatre troupe', 'plague doctors', 'gods reborn as mortals', 'beast-tamers',
  "the last members of a mages' guild", 'debt-collectors for a devil', 'mercenaries hired by both sides', 'monsters trying to become people',
  'archaeologists of forbidden ruins', 'airship crew', 'convicts given one chance at freedom', 'witches of a single bloodline'
]
const VILLAINS = [
  'a saint who is secretly the plague', 'a kind king buying souls', "the party's future selves", 'a dragon who wants to retire', 'a guild that owns the sun',
  'the dungeon itself', 'a child-god throwing a tantrum', 'a lich running a bank', 'a hero who already won and became a tyrant',
  'a hive-mind of grateful refugees', 'a cartographer erasing places', 'a mother of monsters protecting her brood'
]
const COMPLICATIONS = [
  'the client is the culprit', 'a rival party wants the same thing', 'the monster is the victim', 'everything resets at midnight',
  'the floor is slowly flooding', 'one hero is secretly wanted here', 'the guards think the party did it', 'the treasure is alive',
  'a storm traps everyone inside', 'the villain offers a better deal', 'the map lies', 'an old ally arrives on the wrong side'
]
const PLACES = [
  'a lighthouse whose keeper vanished', 'a wedding at a haunted estate', 'a sinking ship', 'a monastery during a blizzard', 'a goblin market at midnight',
  "a dragon's abandoned lair", 'a besieged toll bridge', 'a museum after closing', 'a train robbed mid-journey', 'a crypt beneath a tavern',
  "a sky-whale's belly", 'a masquerade ball', 'a flooded mine', 'a festival where everyone wears masks', "a witch's cottage that walks"
]
const GOALS = [
  'rescue a hostage before dawn', 'steal a cursed painting', 'escort a talking corpse to its funeral', 'win a rigged tournament', 'find who poisoned the host',
  'close a portal before it opens fully', 'deliver a letter no one may read', 'survive one night', 'recover a stolen voice', 'break an ancient contract',
  'catch a shapeshifter among the guests', "bring a dragon's egg home"
]
const ROLES = [
  'disgraced paladin', 'retired pirate queen', 'tiefling bounty hunter', 'half-orc poet', 'elven necromancer-medic', 'dwarven clockmaker',
  'gnome con artist', 'dragonborn monk', 'halfling spy', 'witch-hunter who uses magic', 'goliath chef', 'changeling actor', 'aasimar who hates heaven',
  'kobold inventor', 'warforged gardener', 'vampire librarian', 'sea-witch barmaid', 'knight who lost a duel to a goose'
]
const FLAWS = [
  "can't refuse a bet", 'lies when nervous', 'too proud to ask for help', 'hoards keepsakes', 'trusts the wrong people', 'holds grudges for decades',
  'afraid of the dark', 'talks to their weapon', 'painfully honest', 'never finishes a job'
]
const WANTS = [
  "to clear their family's name", 'to find the one who got away', 'to repay an impossible debt', 'to be remembered', 'to quit adventuring and open a shop',
  'revenge on a former mentor', 'to break a curse', 'to win back a title', 'to protect a younger sibling', 'the truth about their birth'
]
const SECRETS = [
  'is already dead', 'works for the villain', 'is royalty in hiding', 'caused the disaster they fight', 'has a twin', 'is a dragon in disguise',
  'made a deal with a devil', "is the prophecy's real chosen one", 'stole their identity', 'is hunted by their own guild'
]
const PREMISES = [
  'the gods died and their corpses became continents', 'magic is a dwindling resource mined like coal', 'the sun has not risen in a century',
  'everyone is born bound by contract to a spirit', 'the world is the inside of a sphere', 'dragons rule as bureaucrats', 'the sea is made of memory',
  'the empire won the last war against the fey', 'the moon is falling, very slowly', 'the dead outnumber the living and vote',
  'islands are the backs of migrating beasts'
]
const CONFLICTS = [
  'two religions, both right about different gods', 'a dying empire and its rebel colonies', 'the elves have come back', 'guilds at open war over trade routes',
  'the living against the political dead', 'a cult trying to wake the world', 'nobles who hoard daylight', 'a plague that grants powers'
]
const WONDERS = [
  'cities that walk', 'rivers that flow upward', 'libraries that dream', 'a wall around the world', 'floating cathedrals', 'forests of crystal',
  'a tower no one has seen the top of', 'storms that carry ghosts'
]

export const IDEA_DICE: Record<IdeaKind, { label: string; table: readonly string[] }[]> = {
  campaign: [
    { label: 'Setting', table: SETTINGS },
    { label: 'Heroes', table: HEROES },
    { label: 'Villain', table: VILLAINS },
    { label: 'Complication', table: COMPLICATIONS }
  ],
  oneshot: [
    { label: 'Place', table: PLACES },
    { label: 'Goal', table: GOALS },
    { label: 'Complication', table: COMPLICATIONS }
  ],
  character: [
    { label: 'Who', table: ROLES },
    { label: 'Flaw', table: FLAWS },
    { label: 'Wants', table: WANTS },
    { label: 'Secret', table: SECRETS }
  ],
  universe: [
    { label: 'Premise', table: PREMISES },
    { label: 'Conflict', table: CONFLICTS },
    { label: 'Wonder', table: WONDERS }
  ]
}

/** One roll per idea; no ingredient repeats within a batch (while the table lasts). */
export function rollIdeaDice(kind: IdeaKind, count: number, rand: () => number = Math.random): string[] {
  const columns = IDEA_DICE[kind].map(({ label, table }) => {
    const pool = [...table]
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[pool[i], pool[j]] = [pool[j]!, pool[i]!]
    }
    return { label, pool }
  })
  return Array.from({ length: count }, (_, i) => columns.map(({ label, pool }) => `${label}: ${pool[i % pool.length]}`).join(' | '))
}

// ---------- Prompt ----------
export const IDEAS_SYSTEM = `You pitch ideas for a tabletop roleplaying app (D&D-style, played with an AI game master). You get random ingredients for each idea; combine them creatively into something fresh and playable. You may bend or swap one ingredient when it makes a much better idea, and you must honour the player's own wishes. Never copy a published setting, adventure or character. Reply with JSON only. Inside text values use single quotes ('like this'), never double quotes.`

const SHAPES: Record<IdeaKind, string> = {
  campaign: `"pitch": two exciting sentences, "details": ["You play: …", "Villain: …", "Act 1: …", "Act 2: …", "Act 3: …", "Signature NPCs: …"], "premise": a full paragraph (setting, heroes, villain, the arc, key NPCs) to hand to the campaign builder, "tones": up to 3 from the tone list, "settings": up to 2 from the setting list`,
  oneshot: `"pitch": two exciting sentences, "details": ["Where: …", "Goal: …", "Twist: …", "Showdown: …"], "premise": a full paragraph for a one-evening adventure to hand to the campaign builder, "tones": up to 3 from the tone list, "settings": up to 2 from the setting list`,
  character: `"pitch": two sentences on who they are, "details": ["Wants: …", "Flaw: …", "Secret: …", "Voice: 'a line they would say'"], "premise": a full character concept paragraph (looks, personality, history, goal, flaw, secret) to hand to the character generator, "race": a D&D race, "cls": a D&D class`,
  universe: `"pitch": two exciting sentences, "details": ["Premise: …", "Conflict: …", "Wonders: …", "Hooks: three campaign hooks in one line"], "premise": a full world concept paragraph to hand to the universe generator, "tones": up to 3 from the tone list`
}

export function ideasPrompt(req: IdeaRequest, rolls: string[], adultLine = ''): string {
  const kind = IDEA_KINDS.find((k) => k.id === req.kind)!
  return [
    `Write ${rolls.length} ${kind.one} ideas, one per ingredient line:`,
    ...rolls.map((r, i) => `${i + 1}. ${r}`),
    req.vibes.length ? `Vibe for all of them: ${req.vibes.join(', ')}.` : '',
    req.theme.trim() ? `The player wants: ${req.theme.trim()}` : '',
    adultLine,
    '',
    `Tone list: ${CAMPAIGN_TONES.join(', ')}`,
    req.kind === 'character' ? '' : `Setting list: ${CAMPAIGN_SETTINGS.join(', ')}`,
    '',
    `Reply shape: {"ideas":[{"title": an evocative name, ${SHAPES[req.kind]}}]}`
  ]
    .filter((l) => l !== '')
    .join('\n')
}

// ---------- Parsing ----------
const str = (max: number) => z.preprocess((v) => (v == null ? '' : typeof v === 'string' ? v : String(v)).trim().slice(0, max), z.string())
const strList = (max: number, each: number) =>
  z.preprocess((v) => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []).map((x) => String(x ?? '').trim().slice(0, each)).filter(Boolean).slice(0, max), z.array(z.string()))

export const IdeaSchema = z.object({
  kind: z.enum(IDEA_KIND_IDS),
  title: str(120),
  pitch: str(800),
  details: strList(8, 600),
  premise: str(4000),
  tones: strList(3, 40),
  settings: strList(2, 60),
  race: str(40),
  cls: str(40)
})
export type Idea = z.infer<typeof IdeaSchema>

function pick(list: readonly string[], values: string[]): string[] {
  const out: string[] = []
  for (const v of values) {
    const hit = list.find((x) => x.toLowerCase() === v.toLowerCase())
    if (hit && !out.includes(hit)) out.push(hit)
  }
  return out
}

/** A reply that is a bare JSON list ([{…}, {…}]) rather than {"ideas": […]}; undefined when it isn't one. */
function bareArray(reply: string): unknown[] | undefined {
  const text = reply.replace(/```(?:json|JSON)?/g, '')
  const start = text.indexOf('[')
  const brace = text.indexOf('{')
  if (start === -1 || (brace !== -1 && brace < start)) return undefined
  const end = text.lastIndexOf(']')
  const body = end > start ? text.slice(start, end + 1) : text.slice(start)
  for (const read of [() => JSON.parse(body), () => JSON.parse(jsonrepair(body))]) {
    try {
      const v = read()
      if (Array.isArray(v)) return v
    } catch {
      // try the next one
    }
  }
  return undefined
}

/** Reads the model's reply; tolerant of prose, code fences and loose shapes. Ideas without a title are dropped. */
export function parseIdeas(reply: string, kind: IdeaKind): Idea[] {
  let raw: unknown = bareArray(reply)
  if (raw === undefined) {
    try {
      raw = extractJson(reply)
    } catch {
      return []
    }
  }
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { ideas?: unknown }).ideas) ? (raw as { ideas: unknown[] }).ideas : []
  const ideas: Idea[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const r = IdeaSchema.safeParse({ ...(item as object), kind })
    if (!r.success || !r.data.title) continue
    const idea = r.data
    ideas.push({
      ...idea,
      premise: idea.premise || [idea.pitch, ...idea.details].filter(Boolean).join('\n'),
      tones: pick(CAMPAIGN_TONES, idea.tones),
      settings: pick(CAMPAIGN_SETTINGS, idea.settings)
    })
  }
  return ideas
}

/** The idea as Markdown, for saving to the vault's Ideas note. */
export function ideaMarkdown(idea: Idea, date = new Date()): string {
  const kind = IDEA_KINDS.find((k) => k.id === idea.kind)!.one
  return [
    `## ${idea.title} *(${kind}, ${date.toISOString().slice(0, 10)})*`,
    '',
    idea.pitch,
    '',
    ...idea.details.map((d) => `- ${d}`),
    ...(idea.race || idea.cls ? [`- ${[idea.race, idea.cls].filter(Boolean).join(' ')}`] : []),
    ...(idea.tones.length ? [`- Tones: ${idea.tones.join(', ')}`] : []),
    '',
    `> ${idea.premise.replace(/\n+/g, ' ')}`,
    ''
  ].join('\n')
}

export const IDEAS_NOTE = 'Ideas.md'
