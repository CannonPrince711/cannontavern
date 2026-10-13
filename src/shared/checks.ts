/**
 * Ability checks, skill checks and saving throws against a D&D sheet
 * (5th edition by default, or 3.5 edition with skill ranks and Fort/Ref/Will).
 */
import { modifier, signed } from './prompt'
import { roll, type Rng, cryptoRng } from './dice'
import type { AbilityKey, DndSheet, RollMode, RollResult } from './types'
import { CONDITIONS_35, editionOf, levelForXp35, SAVES_35, SKILL_ALIASES_35, SKILLS_35, xpForLevel35, type Edition, type Save35 } from './editions'

export const ABILITIES: { key: AbilityKey; name: string }[] = [
  { key: 'str', name: 'Strength' },
  { key: 'dex', name: 'Dexterity' },
  { key: 'con', name: 'Constitution' },
  { key: 'int', name: 'Intelligence' },
  { key: 'wis', name: 'Wisdom' },
  { key: 'cha', name: 'Charisma' }
]

export const SKILLS: { key: string; name: string; ability: AbilityKey }[] = [
  { key: 'acrobatics', name: 'Acrobatics', ability: 'dex' },
  { key: 'animal handling', name: 'Animal Handling', ability: 'wis' },
  { key: 'arcana', name: 'Arcana', ability: 'int' },
  { key: 'athletics', name: 'Athletics', ability: 'str' },
  { key: 'deception', name: 'Deception', ability: 'cha' },
  { key: 'history', name: 'History', ability: 'int' },
  { key: 'insight', name: 'Insight', ability: 'wis' },
  { key: 'intimidation', name: 'Intimidation', ability: 'cha' },
  { key: 'investigation', name: 'Investigation', ability: 'int' },
  { key: 'medicine', name: 'Medicine', ability: 'wis' },
  { key: 'nature', name: 'Nature', ability: 'int' },
  { key: 'perception', name: 'Perception', ability: 'wis' },
  { key: 'performance', name: 'Performance', ability: 'cha' },
  { key: 'persuasion', name: 'Persuasion', ability: 'cha' },
  { key: 'religion', name: 'Religion', ability: 'int' },
  { key: 'sleight of hand', name: 'Sleight of Hand', ability: 'dex' },
  { key: 'stealth', name: 'Stealth', ability: 'dex' },
  { key: 'survival', name: 'Survival', ability: 'wis' }
]

export const CONDITIONS = [
  'blinded', 'charmed', 'deafened', 'exhaustion', 'frightened', 'grappled', 'incapacitated',
  'invisible', 'paralyzed', 'petrified', 'poisoned', 'prone', 'restrained', 'stunned', 'unconscious'
]

/** XP needed to reach each level (index = level). */
export const XP_FOR_LEVEL = [0, 0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000]

export function levelForXp(xp: number, edition: Edition = '5e'): number {
  if (edition === '3.5e') return levelForXp35(xp)
  let level = 1
  for (let l = 2; l <= 20; l++) if (xp >= XP_FOR_LEVEL[l]!) level = l
  return level
}

/** XP needed for a level in an edition. */
export function xpForLevel(level: number, edition: Edition = '5e'): number {
  return edition === '3.5e' ? xpForLevel35(level) : (XP_FOR_LEVEL[Math.max(1, Math.min(20, level))] ?? 0)
}

export function skillsFor(edition: Edition): { key: string; name: string; ability: AbilityKey }[] {
  return edition === '3.5e' ? SKILLS_35 : SKILLS
}

export function conditionsFor(edition: Edition): string[] {
  return edition === '3.5e' ? CONDITIONS_35 : CONDITIONS
}

/** Short reminders, in our own words, of what common conditions do. */
export const CONDITION_NOTES: Record<Edition, [string, string][]> = {
  '5e': [
    ['Blinded', 'Can’t see; attacks against it have advantage, its attacks have disadvantage.'],
    ['Charmed', 'Won’t attack the charmer; the charmer has advantage on social checks with it.'],
    ['Frightened', 'Disadvantage on checks and attacks while the source is in sight; can’t move closer.'],
    ['Grappled', 'Speed 0 until it escapes or the grappler is moved away.'],
    ['Incapacitated', 'No actions or reactions.'],
    ['Invisible', 'Attacks against it have disadvantage; its attacks have advantage.'],
    ['Paralyzed', 'Incapacitated, fails STR/DEX saves; hits from within 5 ft are crits.'],
    ['Poisoned', 'Disadvantage on attack rolls and ability checks.'],
    ['Prone', 'Melee attacks against it have advantage, ranged have disadvantage; standing costs half speed.'],
    ['Restrained', 'Speed 0; attacks against it have advantage; disadvantage on DEX saves and its attacks.'],
    ['Stunned', 'Incapacitated, can barely speak, fails STR/DEX saves; attacks against it have advantage.'],
    ['Unconscious', 'Drops prone, fails STR/DEX saves; melee hits within 5 ft are crits.'],
    ['Deafened', 'Can’t hear; fails any check that needs hearing.'],
    ['Petrified', 'Turned to stone: incapacitated, unaware, resists all damage; attacks against it have advantage.'],
    ['Exhaustion', 'Cumulative levels: penalties grow until death at the last level.']
  ],
  '3.5e': [
    ['Blinded', '−2 AC, loses DEX to AC, half speed, −4 on most STR/DEX skills; 50% miss chance on its attacks.'],
    ['Dazed', 'Can take no actions, but has no AC penalty.'],
    ['Entangled', '−2 attack, −4 DEX, half speed; casting needs a Concentration check.'],
    ['Fatigued', '−2 STR and DEX; can’t run or charge. Exhausted is worse (−6, half speed).'],
    ['Flat-footed', 'Hasn’t acted yet in combat: loses DEX bonus to AC, no attacks of opportunity.'],
    ['Grappling', 'Can’t move freely; limited actions; loses DEX to AC against others.'],
    ['Helpless', 'Melee attacks get +4; can be coup de grâced; treated as DEX 0.'],
    ['Nauseated', 'Can only take a single move action each turn.'],
    ['Prone', '−4 melee attack; +4 AC against ranged, −4 AC against melee.'],
    ['Shaken', '−2 on attacks, saves, skill and ability checks. Frightened/panicked are worse.'],
    ['Sickened', '−2 on attacks, weapon damage, saves, skill and ability checks.'],
    ['Stunned', 'Drops what it holds, no actions, −2 AC, loses DEX to AC.']
  ]
}

/** The reminder for a condition by name ("poisoned", "Exhaustion 2"…), if there is one. */
export function conditionNote(name: string, edition: Edition = '5e'): string | undefined {
  const q = name.trim().toLowerCase().replace(/\s*\d+$/, '')
  return CONDITION_NOTES[edition].find(([n]) => n.toLowerCase() === q)?.[1]
}

export interface CheckTarget {
  kind: 'ability' | 'skill' | 'save'
  ability: AbilityKey
  /** Display name, e.g. "Perception" or "Wisdom save". */
  name: string
  skill?: string
  /** 3.5 saves: Fortitude, Reflex or Will. */
  save35?: Save35
}

const SAVE_WORDS: Record<string, Save35> = { fort: 'fort', fortitude: 'fort', ref: 'ref', reflex: 'ref', will: 'will' }

/**
 * Resolves "dex", "dexterity", "perception", "sleight of hand", "reflex",
 * "knowledge arcana"… to what's being rolled, for the sheet's edition.
 */
export function resolveTarget(raw: string, save = false, edition: Edition = '5e'): CheckTarget | null {
  let q = raw.trim().toLowerCase().replace(/[_-]/g, ' ').replace(/\s+/g, ' ')
  // "dex save", "reflex saving throw" → a save.
  const suffix = /\s+(save|saving throw)$/.exec(q)
  if (suffix) {
    save = true
    q = q.slice(0, suffix.index)
  }
  const saveWord = SAVE_WORDS[q]
  if (saveWord) {
    const s = SAVES_35.find((x) => x.key === saveWord)!
    // 5e has no Fort/Ref/Will; treat them as CON/DEX/WIS saves.
    return edition === '3.5e'
      ? { kind: 'save', ability: s.ability, name: `${s.name} save`, save35: s.key }
      : { kind: 'save', ability: s.ability, name: `${ABILITIES.find((a) => a.key === s.ability)!.name} save` }
  }
  const ability = ABILITIES.find((a) => a.key === q || a.name.toLowerCase() === q || q === a.name.toLowerCase().slice(0, 3))
  if (ability) {
    if (!save) return { kind: 'ability', ability: ability.key, name: ability.name }
    if (edition !== '3.5e') return { kind: 'save', ability: ability.key, name: `${ability.name} save` }
    // 3.5: a CON/DEX/WIS save is a Fortitude/Reflex/Will save; there are no others.
    const s = SAVES_35.find((x) => x.ability === ability.key)
    return s ? { kind: 'save', ability: s.ability, name: `${s.name} save`, save35: s.key } : null
  }
  if (save) return null
  if (edition === '3.5e') {
    const k = q.replace(/^knowledge\s+(?!\()(.+)$/, 'knowledge ($1)')
    const key = SKILL_ALIASES_35[k] ?? k
    const skill = SKILLS_35.find((s) => s.key === key || s.name.toLowerCase() === key)
    return skill ? { kind: 'skill', ability: skill.ability, name: skill.name, skill: skill.key } : null
  }
  const skill = SKILLS.find((s) => s.key === q || s.name.toLowerCase() === q)
  return skill ? { kind: 'skill', ability: skill.ability, name: skill.name, skill: skill.key } : null
}

/** Total modifier for a check or save, and whether proficiency applied. */
export function checkBonus(sheet: DndSheet, target: CheckTarget): { bonus: number; proficient: boolean } {
  const base = modifier(sheet[target.ability])
  if (editionOf(sheet) === '3.5e') {
    if (target.kind === 'save') {
      const key = target.save35 ?? SAVES_35.find((s) => s.ability === target.ability)?.key
      const b = key ? (sheet.base_saves?.[key] ?? 0) : 0
      return { bonus: base + b, proficient: b > 0 }
    }
    if (target.kind === 'skill') {
      const ranks = sheet.skill_ranks?.[target.skill!] ?? 0
      return { bonus: base + ranks, proficient: ranks > 0 }
    }
    return { bonus: base, proficient: false }
  }
  const proficient =
    target.kind === 'save' ? sheet.saves.includes(target.ability) : target.kind === 'skill' ? sheet.skills.includes(target.skill!) : false
  return { bonus: base + (proficient ? sheet.proficiency_bonus : 0), proficient }
}

/** Rolls a check/save for a sheet (or a bare d20 without one). */
export function rollCheck(
  sheet: DndSheet | null,
  target: CheckTarget,
  dc: number | undefined,
  mode: RollMode = 'normal',
  rng: Rng = cryptoRng
): RollResult {
  const { bonus } = sheet ? checkBonus(sheet, target) : { bonus: 0 }
  const expr = `1d20${bonus ? signed(bonus) : ''}${mode === 'adv' ? ' adv' : mode === 'dis' ? ' dis' : ''} ${target.name}`
  const r = roll(expr, rng)
  if (dc !== undefined) {
    r.dc = dc
    // 5e: compare the total. 3.5: a natural 20 always saves and a natural 1 always fails.
    r.success = r.total >= dc
    if (sheet && editionOf(sheet) === '3.5e' && target.kind === 'save') {
      if (r.crit) r.success = true
      else if (r.fumble) r.success = false
    }
  }
  return r
}

/** Parses "/check dex 15 adv" style arguments. */
export function parseCheckArgs(args: string): { target: string; dc?: number; mode: RollMode } {
  let mode: RollMode = 'normal'
  let dc: number | undefined
  const words: string[] = []
  for (const w of args.trim().split(/\s+/).filter(Boolean)) {
    if (/^(adv|advantage)$/i.test(w)) mode = 'adv'
    else if (/^(dis|disadvantage)$/i.test(w)) mode = 'dis'
    else if (/^(dc)?\d+$/i.test(w)) dc = Number(w.replace(/^dc/i, ''))
    else if (/^dc$/i.test(w)) continue
    else words.push(w)
  }
  return { target: words.join(' '), dc, mode }
}
