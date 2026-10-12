/**
 * Character generator support: the prompt, repairs for the usual small-model
 * JSON slips, and rules maths the model often gets wrong. After the model
 * writes a sheet, hit points, base attack bonus, saves (3.5e) and proficiency
 * (5e) are recalculated from the class tables below; other skill systems'
 * names are mapped to 3.5e skills. Classes not in the tables keep the model's
 * numbers.
 */
import type { AbilityKey, DndSheet } from './types'

type Prog = 'good' | 'avg' | 'poor'
interface Class35 {
  hd: number
  bab: Prog
  good: ('fort' | 'ref' | 'will')[]
  skills: number
}

/** D&D 3.5 base classes: hit die, base attack progression, good saves, skill points per level. */
export const CLASSES_35: Record<string, Class35> = {
  barbarian: { hd: 12, bab: 'good', good: ['fort'], skills: 4 },
  bard: { hd: 6, bab: 'avg', good: ['ref', 'will'], skills: 6 },
  cleric: { hd: 8, bab: 'avg', good: ['fort', 'will'], skills: 2 },
  druid: { hd: 8, bab: 'avg', good: ['fort', 'will'], skills: 4 },
  fighter: { hd: 10, bab: 'good', good: ['fort'], skills: 2 },
  monk: { hd: 8, bab: 'avg', good: ['fort', 'ref', 'will'], skills: 4 },
  paladin: { hd: 10, bab: 'good', good: ['fort'], skills: 2 },
  ranger: { hd: 8, bab: 'good', good: ['fort', 'ref'], skills: 6 },
  rogue: { hd: 6, bab: 'avg', good: ['ref'], skills: 8 },
  sorcerer: { hd: 4, bab: 'poor', good: ['will'], skills: 2 },
  wizard: { hd: 4, bab: 'poor', good: ['will'], skills: 2 },
  // Supplements
  warblade: { hd: 12, bab: 'good', good: ['fort'], skills: 4 },
  swordsage: { hd: 8, bab: 'avg', good: ['ref', 'will'], skills: 6 },
  crusader: { hd: 10, bab: 'good', good: ['fort', 'will'], skills: 4 },
  scout: { hd: 8, bab: 'avg', good: ['ref'], skills: 8 },
  swashbuckler: { hd: 10, bab: 'good', good: ['fort'], skills: 4 },
  warmage: { hd: 6, bab: 'poor', good: ['will'], skills: 2 },
  beguiler: { hd: 6, bab: 'poor', good: ['will'], skills: 6 },
  'favored soul': { hd: 8, bab: 'avg', good: ['fort', 'ref', 'will'], skills: 2 },
  hexblade: { hd: 10, bab: 'good', good: ['will'], skills: 2 },
  marshal: { hd: 8, bab: 'avg', good: ['fort', 'will'], skills: 4 },
  duskblade: { hd: 8, bab: 'good', good: ['fort', 'will'], skills: 2 },
  knight: { hd: 12, bab: 'good', good: ['fort'], skills: 2 },
  'dragon shaman': { hd: 10, bab: 'avg', good: ['fort', 'will'], skills: 2 },
  warlock: { hd: 6, bab: 'avg', good: ['will'], skills: 2 },
  ninja: { hd: 6, bab: 'avg', good: ['ref'], skills: 6 },
  spellthief: { hd: 6, bab: 'avg', good: ['ref'], skills: 6 },
  samurai: { hd: 10, bab: 'good', good: ['fort'], skills: 2 },
  psion: { hd: 4, bab: 'poor', good: ['will'], skills: 2 },
  'psychic warrior': { hd: 8, bab: 'avg', good: ['fort'], skills: 2 }
}

/** D&D 5e classes: hit die and saving throw proficiencies. */
export const CLASSES_5E: Record<string, { hd: number; saves: AbilityKey[] }> = {
  artificer: { hd: 8, saves: ['con', 'int'] },
  barbarian: { hd: 12, saves: ['str', 'con'] },
  bard: { hd: 8, saves: ['dex', 'cha'] },
  cleric: { hd: 8, saves: ['wis', 'cha'] },
  druid: { hd: 8, saves: ['int', 'wis'] },
  fighter: { hd: 10, saves: ['str', 'con'] },
  monk: { hd: 8, saves: ['str', 'dex'] },
  paladin: { hd: 10, saves: ['wis', 'cha'] },
  ranger: { hd: 10, saves: ['str', 'dex'] },
  rogue: { hd: 8, saves: ['dex', 'int'] },
  sorcerer: { hd: 6, saves: ['con', 'cha'] },
  warlock: { hd: 8, saves: ['wis', 'cha'] },
  wizard: { hd: 6, saves: ['int', 'wis'] }
}

/** Skill names from 5e / Pathfinder → their 3.5e equivalents. */
const SKILLS_TO_35: Record<string, string> = {
  perception: 'spot',
  stealth: 'hide',
  acrobatics: 'tumble',
  athletics: 'climb',
  insight: 'sense motive',
  investigation: 'search',
  linguistics: 'speak language',
  arcana: 'knowledge (arcana)',
  history: 'knowledge (history)',
  religion: 'knowledge (religion)',
  nature: 'knowledge (nature)',
  medicine: 'heal',
  persuasion: 'diplomacy',
  deception: 'bluff',
  intimidation: 'intimidate',
  'sleight of hand': 'sleight of hand',
  'animal handling': 'handle animal',
  research: 'decipher script',
  'sense motives': 'sense motive',
  repair: 'craft (mechanism)',
  engineering: 'knowledge (architecture and engineering)',
  'disable device': 'disable device',
  'knowledge (any)': 'knowledge (arcana)'
}

const mod = (score: number): number => Math.floor((score - 10) / 2)

/** "Fighter 2 / Rogue 1" → [{ name: "fighter", level: 2 }, …]; a bare "Fighter" uses the sheet's level. */
export function parseClasses(cls: string, level: number): { name: string; level: number }[] {
  const parts = [...cls.matchAll(/([a-z][a-z' ]*?)\s*(\d+)/gi)].map((m) => ({ name: m[1]!.trim().toLowerCase(), level: Number(m[2]) }))
  if (parts.length) return parts
  const name = cls.trim().toLowerCase()
  return name ? [{ name, level: Math.max(1, level) }] : []
}

const save35 = (good: boolean, lvl: number): number => (good ? 2 + Math.floor(lvl / 2) : Math.floor(lvl / 3))
const bab35 = (p: Prog, lvl: number): number => (p === 'good' ? lvl : p === 'avg' ? Math.floor((lvl * 3) / 4) : Math.floor(lvl / 2))

/**
 * Recalculates what the class tables decide. Only classes it knows are used;
 * if any class is unknown the model's numbers are kept for that part.
 * Returns the sheet and a list of what changed (shown to the player).
 */
export function fixSheet(sheet: DndSheet): { sheet: DndSheet; changes: string[] } {
  const s: DndSheet = { ...sheet }
  const changes: string[] = []
  const classes = parseClasses(s.class, s.level)
  const total = classes.reduce((n, c) => n + c.level, 0)
  if (total > 0 && total !== s.level) {
    changes.push(`level ${s.level} → ${total}`)
    s.level = total
  }
  const con = mod(s.con)

  if (s.edition === '3.5e') {
    const known = classes.map((c) => ({ ...c, t: CLASSES_35[c.name] }))
    if (known.length && known.every((k) => k.t)) {
      const bab = known.reduce((n, k) => n + bab35(k.t!.bab, k.level), 0)
      const saves = { fort: 0, ref: 0, will: 0 }
      for (const k of known) for (const sv of ['fort', 'ref', 'will'] as const) saves[sv] += save35(k.t!.good.includes(sv), k.level)
      let hp = 0
      known.forEach((k, i) => {
        for (let l = 1; l <= k.level; l++) hp += Math.max(1, (i === 0 && l === 1 ? k.t!.hd : Math.floor(k.t!.hd / 2) + 1) + con)
      })
      if (s.bab !== bab) changes.push(`base attack ${s.bab ?? '?'} → ${bab}`)
      const was = s.base_saves
      if (!was || was.fort !== saves.fort || was.ref !== saves.ref || was.will !== saves.will) changes.push(`base saves → Fort ${saves.fort}, Ref ${saves.ref}, Will ${saves.will}`)
      if (s.max_hp !== hp) changes.push(`hit points ${s.max_hp} → ${hp}`)
      s.bab = bab
      s.base_saves = saves
      s.max_hp = hp
      s.hp = hp
    }
    // Other systems' skill names → 3.5e, and no more ranks than level + 3.
    const ranks: Record<string, number> = {}
    for (const [raw, r] of Object.entries(s.skill_ranks ?? {})) {
      const key = raw.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
      const name = SKILLS_TO_35[key] ?? key
      if (name !== key) changes.push(`skill ${raw} → ${name}`)
      ranks[name] = Math.min(s.level + 3, (ranks[name] ?? 0) + Math.max(0, Math.round(Number(r) || 0)))
    }
    s.skill_ranks = ranks
  } else {
    const first = classes[0] ? CLASSES_5E[classes[0].name] : undefined
    const known = classes.map((c) => ({ ...c, t: CLASSES_5E[c.name] }))
    if (first && known.every((k) => k.t)) {
      let hp = 0
      known.forEach((k, i) => {
        for (let l = 1; l <= k.level; l++) hp += Math.max(1, (i === 0 && l === 1 ? k.t!.hd : Math.floor(k.t!.hd / 2) + 1) + con)
      })
      if (s.max_hp !== hp) changes.push(`hit points ${s.max_hp} → ${hp}`)
      s.max_hp = hp
      s.hp = hp
      s.saves = first.saves
      s.hit_dice = { die: first.hd, max: s.level, used: 0 }
    }
    const pb = 2 + Math.floor((Math.max(1, s.level) - 1) / 4)
    if (s.proficiency_bonus !== pb) changes.push(`proficiency bonus ${s.proficiency_bonus} → +${pb}`)
    s.proficiency_bonus = pb
  }
  return { sheet: s, changes }
}

/** Fixes the JSON slips small models make before parsing: units in numbers, a list of lines left without brackets. */
export function repairCharacterJson(reply: string): string {
  return reply
    .replace(/:\s*(-?\d+(?:\.\d+)?)\s*(?:ft|feet|gp|lbs?)\.?(?=\s*[,}\n])/gi, ': $1')
    .replace(/:\s*"\+(\d+)"/g, ': $1')
    .replace(/("mes_example":\s*)("(?:[^"\\]|\\.)*")(\s*,\s*"(?:[^"\\]|\\.)*")+(?=\s*,\s*"[a-z_]+"\s*:)/, (m: string, key: string) => {
      const parts = [...m.slice(key.length).matchAll(/"(?:[^"\\]|\\.)*"/g)].map((x) => JSON.parse(x[0]) as string)
      return key + JSON.stringify(parts.join('\n'))
    })
}

export interface CharacterRequest {
  concept: string
  level: number
  race?: string
  cls?: string
  edition: '5e' | '3.5e'
  minAge: number
  campaign?: { name: string; setting: string; tone: string; houseRules: string; sources: string[] }
  avoidNames: string[]
}

/** Follow-up when the reply had no usable sheet: just the sheet for the character already written. */
export function sheetOnlyPrompt(r: CharacterRequest, name: string, description: string): string {
  return `${chargenPrompt(r)}

You already wrote this character: ${name}. ${description.slice(0, 600)}
Now reply with only their sheet, in this shape: {"dnd": { ... }} with every field above filled in.`
}

export const CHARGEN_SYSTEM = `You are an expert Dungeons & Dragons character designer. You turn a short concept into a complete, playable player character with a vivid personality. Reply with JSON only. Inside text values, write dialogue with single quotes, never double quotes.`

export function chargenPrompt(r: CharacterRequest): string {
  const rules = r.edition === '3.5e'
    ? `D&D 3.5 edition: 3.5e classes, races, feats and skills only (Spot, Listen, Hide, Move Silently, Tumble… not Perception or Stealth). Point buy 32. Include base attack bonus, base saves and skill ranks.`
    : `D&D 5th edition: 5e classes, species, backgrounds and skills. Point buy 27 or standard array.`
  const campaign = r.campaign
    ? [
        `Campaign: ${r.campaign.name}`,
        r.campaign.setting && `Setting: ${r.campaign.setting.slice(0, 800)}`,
        r.campaign.tone && `Tone: ${r.campaign.tone.slice(0, 300)}`,
        r.campaign.houseRules && `House rules: ${r.campaign.houseRules.slice(0, 1500)}`,
        r.campaign.sources.length ? `Allowed books: ${r.campaign.sources.join(', ')}` : ''
      ]
        .filter(Boolean)
        .join('\n')
    : 'No campaign: a classic fantasy adventurer.'
  const sheet35 = `"bab": 0, "base_saves": {"fort": 0, "ref": 0, "will": 0}, "skill_ranks": {"spot": 4}, "feats": ["..."],`
  const sheet5e = `"proficiency_bonus": 2, "skills": ["perception"], "saves": ["dex", "int"],`
  return `${campaign}

Rules: ${rules}
Create a player character at level ${r.level}${r.race ? `, race: ${r.race}` : ''}${r.cls ? `, class: ${r.cls}` : ''}.
Concept from the player: ${r.concept.trim() || 'surprise me with something that fits the campaign'}
They are an adult (${r.minAge} or older; state their age). Give them a distinct voice, a want, a flaw, a secret or tie to the setting, and gear that fits.${r.avoidNames.length ? ` Do not reuse these names: ${r.avoidNames.slice(0, 60).join(', ')}.` : ''}

Reply with:
{"name": "...", "description": "appearance, age and background, 3-4 sentences", "personality": "2-3 sentences", "scenario": "why they are in this story, 1-2 sentences", "first_mes": "a short in-character first line", "mes_example": "two short example lines in their voice", "tags": ["..."],
 "dnd": {"edition": "${r.edition}", "race": "...", "class": "Class ${r.level}", "level": ${r.level}, "hp": 0, "max_hp": 0, "ac": 10, "speed": 30, "str": 10, "dex": 10, "con": 10, "int": 10, "wis": 10, "cha": 10, ${r.edition === '3.5e' ? sheet35 : sheet5e} "inventory": [{"name": "...", "qty": 1}], "gold": 0, "spells": [{"name": "...", "level": 0}]}}`
}
