/**
 * Changes to a character sheet: auto-state from the model (with undo), rests,
 * damage and healing, levelling up.
 */
import { proficiencyForLevel } from './notes'
import { modifier } from './prompt'
import { roll, type Rng, cryptoRng } from './dice'
import type { DndSheet, StateChange } from './types'

const NUMERIC = ['hp', 'temp_hp', 'gold', 'xp'] as const

/** Coerces a raw `<state>` object into a StateChange, dropping anything unknown. */
export function normalizeStateChange(raw: Record<string, unknown>): StateChange {
  const out: StateChange = {}
  for (const k of NUMERIC) {
    const v = typeof raw[k] === 'string' ? Number(raw[k]) : raw[k]
    if (typeof v === 'number' && Number.isFinite(v) && v !== 0) out[k] = Math.trunc(v)
  }
  for (const k of ['add_item', 'remove_item', 'add_condition', 'remove_condition'] as const) {
    if (typeof raw[k] === 'string' && (raw[k] as string).trim()) out[k] = (raw[k] as string).trim()
  }
  return out
}

/** Damage is absorbed by temporary HP first. */
export function damage(sheet: DndSheet, amount: number): DndSheet {
  const fromTemp = Math.min(sheet.temp_hp, amount)
  return { ...sheet, temp_hp: sheet.temp_hp - fromTemp, hp: Math.max(0, sheet.hp - (amount - fromTemp)) }
}

export function heal(sheet: DndSheet, amount: number): DndSheet {
  return { ...sheet, hp: Math.min(sheet.max_hp, sheet.hp + amount) }
}

/**
 * Applies changes and returns the new sheet plus what actually changed
 * (clamped HP, items that existed…), which is what Undo reverses.
 */
export function applyStateChanges(sheet: DndSheet, changes: StateChange[]): { sheet: DndSheet; applied: StateChange[] } {
  let s = structuredClone(sheet)
  const applied: StateChange[] = []
  for (const c of changes) {
    const done: StateChange = {}
    if (c.hp) {
      const before = { hp: s.hp, temp: s.temp_hp }
      s = c.hp < 0 ? damage(s, -c.hp) : heal(s, c.hp)
      if (s.hp !== before.hp) done.hp = s.hp - before.hp
      if (s.temp_hp !== before.temp) done.temp_hp = s.temp_hp - before.temp
    }
    if (c.temp_hp) {
      const before = s.temp_hp
      s.temp_hp = Math.max(0, s.temp_hp + c.temp_hp)
      if (s.temp_hp !== before) done.temp_hp = (done.temp_hp ?? 0) + (s.temp_hp - before)
    }
    if (c.gold) {
      const before = s.gold
      s.gold = Math.max(0, s.gold + c.gold)
      if (s.gold !== before) done.gold = s.gold - before
    }
    if (c.xp) {
      const before = s.xp
      s.xp = Math.max(0, s.xp + c.xp)
      if (s.xp !== before) done.xp = s.xp - before
    }
    if (c.add_item) {
      const item = s.inventory.find((i) => i.name.toLowerCase() === c.add_item!.toLowerCase())
      if (item) item.qty += 1
      else s.inventory.push({ name: c.add_item, qty: 1 })
      done.add_item = c.add_item
    }
    if (c.remove_item) {
      const i = s.inventory.findIndex((it) => it.name.toLowerCase() === c.remove_item!.toLowerCase())
      if (i !== -1) {
        const item = s.inventory[i]!
        if (item.qty > 1) item.qty -= 1
        else s.inventory.splice(i, 1)
        done.remove_item = item.name
      }
    }
    if (c.add_condition && !s.conditions.some((x) => x.toLowerCase() === c.add_condition!.toLowerCase())) {
      s.conditions.push(c.add_condition.toLowerCase())
      done.add_condition = c.add_condition.toLowerCase()
    }
    if (c.remove_condition) {
      const i = s.conditions.findIndex((x) => x.toLowerCase() === c.remove_condition!.toLowerCase())
      if (i !== -1) {
        done.remove_condition = s.conditions[i]
        s.conditions.splice(i, 1)
      }
    }
    if (Object.keys(done).length) applied.push(done)
  }
  return { sheet: s, applied }
}

/** The changes that undo `applied`. */
export function reverseChanges(applied: StateChange[]): StateChange[] {
  return [...applied].reverse().map((c) => {
    const r: StateChange = {}
    // Reverse HP exactly: restore temp HP and HP separately.
    if (c.temp_hp) r.temp_hp = -c.temp_hp
    if (c.hp) r.hp = -c.hp
    if (c.gold) r.gold = -c.gold
    if (c.xp) r.xp = -c.xp
    if (c.add_item) r.remove_item = c.add_item
    if (c.remove_item) r.add_item = c.remove_item
    if (c.add_condition) r.remove_condition = c.add_condition
    if (c.remove_condition) r.add_condition = c.remove_condition
    return r
  })
}

/** Undo must restore exact values (healing back up through temp HP rules would differ). */
export function undoStateChanges(sheet: DndSheet, applied: StateChange[]): DndSheet {
  let s = structuredClone(sheet)
  for (const c of reverseChanges(applied)) {
    if (c.hp) s.hp = Math.max(0, Math.min(s.max_hp, s.hp + c.hp))
    if (c.temp_hp) s.temp_hp = Math.max(0, s.temp_hp + c.temp_hp)
    const { hp: _hp, temp_hp: _t, ...rest } = c
    if (Object.keys(rest).length) s = applyStateChanges(s, [rest]).sheet
  }
  return s
}

export function describeChange(c: StateChange): string {
  const parts: string[] = []
  const n = (v: number): string => (v > 0 ? `+${v}` : `−${Math.abs(v)}`)
  if (c.hp) parts.push(`HP ${n(c.hp)}`)
  if (c.temp_hp) parts.push(`temp HP ${n(c.temp_hp)}`)
  if (c.gold) parts.push(`${n(c.gold)} gp`)
  if (c.xp) parts.push(`${n(c.xp)} XP`)
  if (c.add_item) parts.push(`gained ${c.add_item}`)
  if (c.remove_item) parts.push(`lost ${c.remove_item}`)
  if (c.add_condition) parts.push(`now ${c.add_condition}`)
  if (c.remove_condition) parts.push(`no longer ${c.remove_condition}`)
  return parts.join(', ')
}

// ─── Rests and levels ───────────────────────────────────────────────────────

export function hitDie(sheet: DndSheet): number {
  if (sheet.hit_dice?.die) return sheet.hit_dice.die
  const c = sheet.class.toLowerCase()
  if (/barbarian/.test(c)) return 12
  if (/fighter|paladin|ranger/.test(c)) return 10
  if (/sorcerer|wizard/.test(c)) return 6
  return 8
}

/** Spends hit dice (each: 1dX + CON) and returns the new sheet and the HP regained. */
export function shortRest(sheet: DndSheet, spend: number, rng: Rng = cryptoRng): { sheet: DndSheet; healed: number; rolls: number[] } {
  const die = hitDie(sheet)
  const hd = sheet.hit_dice ?? { die, max: sheet.level, used: 0 }
  const available = Math.max(0, hd.max - hd.used)
  const n = Math.min(spend, available)
  const con = modifier(sheet.con)
  const rolls = Array.from({ length: n }, () => Math.max(1, roll(`1d${die}`, rng).total + con))
  const healed = Math.min(sheet.max_hp - sheet.hp, rolls.reduce((a, b) => a + b, 0))
  return { sheet: { ...sheet, hp: sheet.hp + healed, hit_dice: { ...hd, die, used: hd.used + n } }, healed, rolls }
}

/** Full HP, spell slots back, half the hit dice back, one level of exhaustion removed. */
export function longRest(sheet: DndSheet): DndSheet {
  const die = hitDie(sheet)
  const hd = sheet.hit_dice ?? { die, max: sheet.level, used: 0 }
  const regain = Math.max(1, Math.floor(hd.max / 2))
  const slots = Object.fromEntries(Object.entries(sheet.spell_slots).map(([k, v]) => [k, { ...v, used: 0 }]))
  return {
    ...sheet,
    hp: sheet.max_hp,
    temp_hp: 0,
    spell_slots: slots,
    hit_dice: { ...hd, die, used: Math.max(0, hd.used - regain) },
    conditions: sheet.conditions.filter((c) => c !== 'exhaustion')
  }
}

/** Raises the level by one; HP goes up by the average hit die (or a roll) + CON. */
export function levelUp(sheet: DndSheet, method: 'average' | 'roll' = 'average', rng: Rng = cryptoRng): { sheet: DndSheet; hpGain: number } {
  const die = hitDie(sheet)
  const con = modifier(sheet.con)
  const base = method === 'average' ? Math.floor(die / 2) + 1 : roll(`1d${die}`, rng).total
  const hpGain = Math.max(1, base + con)
  const level = Math.min(20, sheet.level + 1)
  const hd = sheet.hit_dice ?? { die, max: sheet.level, used: 0 }
  return {
    sheet: {
      ...sheet,
      level,
      max_hp: sheet.max_hp + hpGain,
      hp: sheet.hp + hpGain,
      proficiency_bonus: proficiencyForLevel(level),
      hit_dice: { ...hd, die, max: level }
    },
    hpGain
  }
}
