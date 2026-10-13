/**
 * Changes to a character sheet: auto-state from the model (with undo), rests,
 * damage and healing, death saves, limited-use features, levelling up.
 */
import { proficiencyForLevel } from './notes'
import { modifier } from './prompt'
import { roll, type Rng, cryptoRng } from './dice'
import { editionOf } from './editions'
import type { DndSheet, Resource, RollResult, StateChange } from './types'

const NUMERIC = ['hp', 'temp_hp', 'gold', 'xp'] as const

/** Coerces a raw `<state>` object into a StateChange, dropping anything unknown. */
export function normalizeStateChange(raw: Record<string, unknown>): StateChange {
  const out: StateChange = {}
  for (const k of NUMERIC) {
    const v = typeof raw[k] === 'string' ? Number(raw[k]) : raw[k]
    if (typeof v === 'number' && Number.isFinite(v) && v !== 0) out[k] = Math.trunc(v)
  }
  for (const k of ['add_item', 'remove_item', 'add_condition', 'remove_condition', 'use_resource', 'restore_resource'] as const) {
    if (typeof raw[k] === 'string' && (raw[k] as string).trim()) out[k] = (raw[k] as string).trim()
  }
  const conc = raw.concentration
  if (typeof conc === 'string') out.concentration = /^(none|null|end|ended|false)$/i.test(conc.trim()) ? '' : conc.trim()
  else if (conc === null || conc === false) out.concentration = ''
  const insp = raw.inspiration
  if (typeof insp === 'boolean') out.inspiration = insp
  else if (insp === 'true' || insp === 'false') out.inspiration = insp === 'true'
  return out
}

/**
 * Damage is absorbed by temporary HP first. Dropping to 0 HP ends
 * concentration; in 5e, damage taken at 0 HP is a failed death save.
 */
export function damage(sheet: DndSheet, amount: number): DndSheet {
  const fromTemp = Math.min(sheet.temp_hp, amount)
  const next: DndSheet = { ...sheet, temp_hp: sheet.temp_hp - fromTemp, hp: Math.max(0, sheet.hp - (amount - fromTemp)) }
  if (amount <= 0) return next
  if (next.hp === 0 && next.concentration) next.concentration = undefined
  if (sheet.hp === 0 && amount > fromTemp && editionOf(sheet) === '5e') {
    const ds = sheet.death_saves ?? { successes: 0, failures: 0 }
    next.death_saves = { ...ds, failures: Math.min(3, ds.failures + 1) }
  }
  return next
}

/** Healing above 0 HP clears death saves. */
export function heal(sheet: DndSheet, amount: number): DndSheet {
  const hp = Math.min(sheet.max_hp, sheet.hp + amount)
  return { ...sheet, hp, ...(hp > 0 && sheet.death_saves ? { death_saves: undefined } : {}) }
}

// ─── Death saves (5e) ────────────────────────────────────────────────────────

export type DeathState = 'dying' | 'stable' | 'dead'

/** 5e at 0 HP: dying until three successes (stable) or three failures (dead). */
export function deathState(sheet: DndSheet): DeathState | null {
  if (sheet.hp > 0 || editionOf(sheet) !== '5e') return null
  const ds = sheet.death_saves ?? { successes: 0, failures: 0 }
  return ds.failures >= 3 ? 'dead' : ds.successes >= 3 ? 'stable' : 'dying'
}

export type DeathSaveOutcome = 'success' | 'failure' | 'stable' | 'dead' | 'revived'

/**
 * Rolls a death saving throw: 10 or more succeeds, a natural 1 counts as two
 * failures, and a natural 20 brings the character back with 1 HP.
 */
export function deathSave(sheet: DndSheet, rng: Rng = cryptoRng): { sheet: DndSheet; roll: RollResult; outcome: DeathSaveOutcome } {
  const r = roll('1d20 Death save', rng)
  r.dc = 10
  r.success = r.total >= 10
  if (r.crit) return { sheet: { ...sheet, hp: 1, death_saves: undefined }, roll: r, outcome: 'revived' }
  const ds = { ...(sheet.death_saves ?? { successes: 0, failures: 0 }) }
  if (r.success) ds.successes = Math.min(3, ds.successes + 1)
  else ds.failures = Math.min(3, ds.failures + (r.fumble ? 2 : 1))
  const outcome: DeathSaveOutcome = ds.failures >= 3 ? 'dead' : ds.successes >= 3 ? 'stable' : r.success ? 'success' : 'failure'
  return { sheet: { ...sheet, death_saves: ds }, roll: r, outcome }
}

/** The DC of the CON save to keep concentrating after taking damage. */
export function concentrationDc(damageTaken: number): number {
  return Math.max(10, Math.floor(damageTaken / 2))
}

// ─── Limited-use features ────────────────────────────────────────────────────

/** Finds a feature by name (exact, then by prefix: "ki" finds "Ki points"). */
export function findResource(sheet: DndSheet, name: string): Resource | undefined {
  const q = name.trim().toLowerCase()
  const list = sheet.resources ?? []
  return list.find((r) => r.name.toLowerCase() === q) ?? list.find((r) => r.name.toLowerCase().startsWith(q))
}

/** Spends (n > 0) or gives back (n < 0) uses of a feature, within 0..max. */
export function spendResource(sheet: DndSheet, name: string, n = 1): { sheet: DndSheet; resource: Resource; changed: number } | null {
  const target = findResource(sheet, name)
  if (!target) return null
  const resource = { ...target, used: Math.max(0, Math.min(target.max, target.used + n)) }
  return { sheet: { ...sheet, resources: (sheet.resources ?? []).map((r) => (r === target ? resource : r)) }, resource, changed: resource.used - target.used }
}

function recharge(resources: Resource[] | undefined, rest: 'short' | 'long'): Resource[] | undefined {
  return resources?.map((r) => (rest === 'long' || r.reset === 'short' ? { ...r, used: 0 } : r))
}

/**
 * Typical limited-use features for a 5e class and level (from the SRD), to
 * fill in a sheet. Multiclass strings ("Fighter 3 / Wizard 2") match each class.
 */
export function classResources(sheet: DndSheet): Resource[] {
  if (editionOf(sheet) !== '5e') return []
  const c = sheet.class.toLowerCase()
  const lvl = sheet.level
  const cha = modifier(sheet.cha)
  const out: Resource[] = []
  const add = (name: string, max: number, reset: 'short' | 'long'): void => {
    if (max > 0) out.push({ name, max, used: 0, reset })
  }
  if (/barbarian/.test(c)) add('Rage', lvl >= 17 ? 6 : lvl >= 12 ? 5 : lvl >= 6 ? 4 : lvl >= 3 ? 3 : 2, 'long')
  if (/bard/.test(c)) add('Bardic Inspiration', Math.max(1, cha), lvl >= 5 ? 'short' : 'long')
  if (/cleric/.test(c) && lvl >= 2) add('Channel Divinity', lvl >= 18 ? 3 : lvl >= 6 ? 2 : 1, 'short')
  if (/druid/.test(c) && lvl >= 2) add('Wild Shape', 2, 'short')
  if (/fighter/.test(c)) {
    add('Second Wind', 1, 'short')
    if (lvl >= 2) add('Action Surge', lvl >= 17 ? 2 : 1, 'short')
    if (lvl >= 9) add('Indomitable', lvl >= 17 ? 3 : lvl >= 13 ? 2 : 1, 'long')
  }
  if (/monk/.test(c) && lvl >= 2) add('Ki points', lvl, 'short')
  if (/paladin/.test(c)) {
    add('Divine Sense', Math.max(1, 1 + cha), 'long')
    add('Lay on Hands', 5 * lvl, 'long')
    if (lvl >= 3) add('Channel Divinity', 1, 'short')
  }
  if (/sorcerer/.test(c) && lvl >= 2) add('Sorcery points', lvl, 'long')
  if (/wizard/.test(c)) add('Arcane Recovery', 1, 'long')
  return out
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
      const before = { hp: s.hp, temp: s.temp_hp, conc: s.concentration }
      s = c.hp < 0 ? damage(s, -c.hp) : heal(s, c.hp)
      if (s.hp !== before.hp) done.hp = s.hp - before.hp
      if (s.temp_hp !== before.temp) done.temp_hp = s.temp_hp - before.temp
      if (before.conc && !s.concentration) {
        done.concentration = ''
        done.concentration_was = before.conc
      }
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
    for (const [key, n] of [['use_resource', 1], ['restore_resource', -1]] as const) {
      const name = c[key]
      const r = name ? spendResource(s, name, n) : null
      if (r?.changed) {
        s = r.sheet
        done[key] = r.resource.name
      }
    }
    if (c.concentration !== undefined) {
      const was = s.concentration ?? ''
      const now = c.concentration.trim()
      if (now !== was) {
        s.concentration = now || undefined
        done.concentration = now
        done.concentration_was ??= was
      }
    }
    if (c.inspiration !== undefined && !!s.inspiration !== c.inspiration) {
      s.inspiration = c.inspiration || undefined
      done.inspiration = c.inspiration
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
    if (c.use_resource) r.restore_resource = c.use_resource
    if (c.restore_resource) r.use_resource = c.restore_resource
    if (c.concentration !== undefined) r.concentration = c.concentration_was ?? ''
    if (c.inspiration !== undefined) r.inspiration = !c.inspiration
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
  if (c.use_resource) parts.push(`used ${c.use_resource}`)
  if (c.restore_resource) parts.push(`regained ${c.restore_resource}`)
  if (c.concentration !== undefined) parts.push(c.concentration ? `concentrating on ${c.concentration}` : 'concentration ended')
  if (c.inspiration !== undefined) parts.push(c.inspiration ? 'gained inspiration' : 'spent inspiration')
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

/**
 * Spends hit dice (each: 1dX + CON) and returns the new sheet and the HP
 * regained; short-rest features recharge. 3.5 has no short rests.
 */
export function shortRest(sheet: DndSheet, spend: number, rng: Rng = cryptoRng): { sheet: DndSheet; healed: number; rolls: number[] } {
  if (sheet.edition === '3.5e') return { sheet, healed: 0, rolls: [] }
  const die = hitDie(sheet)
  const hd = sheet.hit_dice ?? { die, max: sheet.level, used: 0 }
  const available = Math.max(0, hd.max - hd.used)
  const n = Math.min(spend, available)
  const con = modifier(sheet.con)
  const rolls = Array.from({ length: n }, () => Math.max(1, roll(`1d${die}`, rng).total + con))
  const healed = Math.min(sheet.max_hp - sheet.hp, rolls.reduce((a, b) => a + b, 0))
  const rested = { ...sheet, hit_dice: { ...hd, die, used: hd.used + n }, ...(sheet.resources ? { resources: recharge(sheet.resources, 'short') } : {}) }
  return { sheet: heal(rested, healed), healed, rolls }
}

/**
 * 5e: full HP, spell slots back, half the hit dice back, one level of exhaustion removed.
 * 3.5: a night's rest heals 1 HP per level, restores spells, and ends fatigue.
 * Limited-use features recharge in both.
 */
export function longRest(sheet: DndSheet): DndSheet {
  if (sheet.edition === '3.5e') {
    const slots = Object.fromEntries(Object.entries(sheet.spell_slots).map(([k, v]) => [k, { ...v, used: 0 }]))
    return {
      ...sheet,
      hp: Math.min(sheet.max_hp, sheet.hp + Math.max(1, sheet.level)),
      temp_hp: 0,
      spell_slots: slots,
      ...(sheet.resources ? { resources: recharge(sheet.resources, 'long') } : {}),
      conditions: sheet.conditions.filter((c) => c !== 'fatigued').map((c) => (c === 'exhausted' ? 'fatigued' : c))
    }
  }
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
    ...(sheet.resources ? { resources: recharge(sheet.resources, 'long') } : {}),
    ...(sheet.death_saves ? { death_saves: undefined } : {}),
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
      // 3.5 has no proficiency bonus; BAB, saves and skill ranks are updated by hand.
      proficiency_bonus: sheet.edition === '3.5e' ? sheet.proficiency_bonus : proficiencyForLevel(level),
      hit_dice: { ...hd, die, max: level }
    },
    hpGain
  }
}
