/**
 * Combat tracker logic: adding combatants, initiative, turn order, damage.
 * State is stored in the session note's frontmatter (`combat:`).
 */
import { roll, type Rng, cryptoRng } from './dice'
import type { Combatant, CombatState } from './types'

export function emptyCombat(): CombatState {
  return { active: false, round: 1, turn: 0, combatants: [] }
}

function newId(): string {
  const b = new Uint8Array(4)
  globalThis.crypto.getRandomValues(b)
  return `c${[...b].map((x) => x.toString(16).padStart(2, '0')).join('')}`
}

export interface AddArgs {
  name: string
  count: number
  hp: number
  ac: number
  initMod: number
}

/**
 * Parses "/add" arguments:
 *   Goblin hp 7 ac 15 init +2
 *   3 Goblins hp 2d6 ac 13 init 2     (hp may be dice; count prefix makes Goblin 1..3)
 *   3x Wolf hp 11 ac 13
 */
export function parseAddArgs(args: string, rng: Rng = cryptoRng): AddArgs[] {
  const text = args.trim()
  if (!text) throw new Error('Usage: /add Goblin hp 7 ac 15 init +2')
  const m = /^(?:(\d+)\s*x?\s+)?(.+?)(?=\s+(?:hp|ac|init)\b|$)(.*)$/i.exec(text)
  if (!m) throw new Error('Usage: /add Goblin hp 7 ac 15 init +2')
  const count = Math.min(20, Math.max(1, Number(m[1] ?? 1)))
  let name = m[2]!.trim()
  const rest = m[3] ?? ''
  if (count > 1) name = singular(name)
  const field = (key: string): string | undefined => new RegExp(`\\b${key}\\s+([+-]?[\\dd+\\-]+)`, 'i').exec(rest)?.[1]
  const hpRaw = field('hp')
  const acRaw = field('ac')
  const initRaw = field('init')
  const hpFor = (): number => {
    if (!hpRaw) return 10
    return /d/i.test(hpRaw) ? Math.max(1, roll(hpRaw, rng).total) : Math.max(1, Number(hpRaw))
  }
  return Array.from({ length: count }, (_, i) => ({
    name: count > 1 ? `${name} ${i + 1}` : name,
    count: 1,
    hp: hpFor(),
    ac: acRaw ? Number(acRaw) : 10,
    initMod: initRaw ? Number(initRaw) : 0
  }))
}

/** "Wolves" → "Wolf", "Harpies" → "Harpy", "Goblins" → "Goblin" (last word only). */
export function singular(name: string): string {
  return name.replace(/(\w+)$/, (w) => {
    if (/ves$/i.test(w)) return w.replace(/ves$/i, (m) => (m[0] === 'V' ? 'F' : 'f'))
    if (/ies$/i.test(w)) return w.replace(/ies$/i, 'y')
    if (/(s|x|z|ch|sh)es$/i.test(w)) return w.slice(0, -2)
    if (/[^s]s$/i.test(w)) return w.slice(0, -1)
    return w
  })
}

export function addCombatants(state: CombatState, adds: AddArgs[], extra: Partial<Combatant> = {}): CombatState {
  const combatants = [
    ...state.combatants,
    ...adds.map(
      (a): Combatant => ({
        id: newId(),
        name: a.name,
        hp: a.hp,
        max_hp: a.hp,
        ac: a.ac,
        init_mod: a.initMod,
        initiative: null,
        conditions: [],
        is_player: false,
        ...extra
      })
    )
  ]
  return { ...state, combatants }
}

/** Highest initiative first; ties go to the higher modifier, then the player. */
export function sortByInitiative(list: Combatant[]): Combatant[] {
  return [...list].sort(
    (a, b) =>
      (b.initiative ?? -Infinity) - (a.initiative ?? -Infinity) || b.init_mod - a.init_mod || Number(b.is_player) - Number(a.is_player) || a.name.localeCompare(b.name)
  )
}

/** Rolls initiative for everyone without one (or everyone with `all`) and starts combat. */
export function rollInitiative(state: CombatState, rng: Rng = cryptoRng, all = false): CombatState {
  const combatants = state.combatants.map((c) =>
    all || c.initiative === null ? { ...c, initiative: roll(`1d20${c.init_mod >= 0 ? '+' : ''}${c.init_mod}`, rng).total } : c
  )
  return { ...state, active: true, round: state.active ? state.round : 1, turn: state.active ? state.turn : 0, combatants: sortByInitiative(combatants) }
}

export function nextTurn(state: CombatState): CombatState {
  if (!state.combatants.length) return state
  const alive = (i: number): boolean => state.combatants[i]!.hp > 0 || state.combatants[i]!.is_player
  let turn = state.turn
  let round = state.round
  for (let step = 0; step < state.combatants.length; step++) {
    turn++
    if (turn >= state.combatants.length) {
      turn = 0
      round++
    }
    if (alive(turn)) break
  }
  return { ...state, turn, round }
}

export function prevTurn(state: CombatState): CombatState {
  if (!state.combatants.length) return state
  let turn = state.turn - 1
  let round = state.round
  if (turn < 0) {
    if (round <= 1) return { ...state, turn: 0 }
    turn = state.combatants.length - 1
    round--
  }
  return { ...state, turn, round }
}

/** Positive amount = damage, negative = healing. HP stays within 0..max. */
export function applyHp(state: CombatState, id: string, amount: number): CombatState {
  return {
    ...state,
    combatants: state.combatants.map((c) => (c.id === id ? { ...c, hp: Math.max(0, Math.min(c.max_hp, c.hp - amount)) } : c))
  }
}

export function removeCombatant(state: CombatState, id: string): CombatState {
  const i = state.combatants.findIndex((c) => c.id === id)
  if (i === -1) return state
  const combatants = state.combatants.filter((c) => c.id !== id)
  let turn = state.turn
  if (i < turn || (i === turn && turn >= combatants.length)) turn = Math.max(0, turn - 1)
  return { ...state, combatants, turn: Math.min(turn, Math.max(0, combatants.length - 1)) }
}

export function findCombatant(state: CombatState, name: string): Combatant | undefined {
  const q = name.trim().toLowerCase()
  return state.combatants.find((c) => c.name.toLowerCase() === q) ?? state.combatants.find((c) => c.name.toLowerCase().startsWith(q))
}
