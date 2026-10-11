/**
 * Ability checks, skill checks and saving throws against a D&D 5e sheet.
 */
import { modifier, signed } from './prompt'
import { roll, type Rng, cryptoRng } from './dice'
import type { AbilityKey, DndSheet, RollMode, RollResult } from './types'

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

export function levelForXp(xp: number): number {
  let level = 1
  for (let l = 2; l <= 20; l++) if (xp >= XP_FOR_LEVEL[l]!) level = l
  return level
}

export interface CheckTarget {
  kind: 'ability' | 'skill' | 'save'
  ability: AbilityKey
  /** Display name, e.g. "Perception" or "Wisdom save". */
  name: string
  skill?: string
}

/** Resolves "dex", "dexterity", "perception", "sleight of hand"… to what's being rolled. */
export function resolveTarget(raw: string, save = false): CheckTarget | null {
  const q = raw.trim().toLowerCase().replace(/[_-]/g, ' ').replace(/\s+/g, ' ')
  const ability = ABILITIES.find((a) => a.key === q || a.name.toLowerCase() === q || q === a.name.toLowerCase().slice(0, 3))
  if (ability) {
    return save
      ? { kind: 'save', ability: ability.key, name: `${ability.name} save` }
      : { kind: 'ability', ability: ability.key, name: ability.name }
  }
  if (save) return null
  const skill = SKILLS.find((s) => s.key === q || s.name.toLowerCase() === q)
  return skill ? { kind: 'skill', ability: skill.ability, name: skill.name, skill: skill.key } : null
}

/** Total modifier for a check or save, and whether proficiency applied. */
export function checkBonus(sheet: DndSheet, target: CheckTarget): { bonus: number; proficient: boolean } {
  const base = modifier(sheet[target.ability])
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
    // A natural 20 or 1 doesn't auto-succeed ability checks in 5e RAW, so compare the total.
    r.success = r.total >= dc
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
