import { describe, expect, it } from 'vitest'
import { checkBonus, levelForXp, parseCheckArgs, resolveTarget, rollCheck } from '@shared/checks'
import { addCombatants, applyHp, emptyCombat, findCombatant, nextTurn, parseAddArgs, prevTurn, removeCombatant, rollInitiative } from '@shared/combat'
import { DiceError, formatRoll, parseRoll, roll, type Rng } from '@shared/dice'
import { defaultSheet } from '@shared/notes'
import { applyStateChanges, describeChange, levelUp, longRest, normalizeStateChange, shortRest, undoStateChanges } from '@shared/sheet'

/** An RNG that makes dice show the given faces, in order (for a die of `sides`). */
function faces(sides: number[], values: number[]): Rng {
  let i = 0
  return () => {
    const v = values[i]!
    const s = sides[i % sides.length]!
    i++
    return (v - 1 + 0.5) / s
  }
}
const d = (sides: number, ...values: number[]): Rng => faces([sides], values)

describe('parseRoll', () => {
  it('normalises expressions', () => {
    expect(parseRoll('d20').expression).toBe('1d20')
    expect(parseRoll('2d6 + 1d4 - 1').expression).toBe('2d6+1d4-1')
    expect(parseRoll('4d6kh3').expression).toBe('4d6kh3')
    expect(parseRoll('4D6K3').expression).toBe('4d6kh3')
    expect(parseRoll('d%').expression).toBe('1d100')
  })

  it('reads advantage, disadvantage and labels', () => {
    expect(parseRoll('1d20+5 adv Stealth')).toMatchObject({ mode: 'adv', label: 'Stealth', expression: '1d20+5' })
    expect(parseRoll('1d20 disadvantage')).toMatchObject({ mode: 'dis', label: '' })
    expect(parseRoll('adv')).toMatchObject({ mode: 'adv', expression: '1d20' })
    expect(parseRoll('Perception check')).toMatchObject({ expression: '1d20', label: 'Perception check' })
  })

  it('rejects nonsense with a helpful error', () => {
    expect(() => parseRoll('')).toThrow(DiceError)
    expect(() => parseRoll('2x6')).toThrow(DiceError)
    expect(() => parseRoll('0d6')).toThrow(/between 1 and 100/)
    expect(() => parseRoll('101d6')).toThrow(/between 1 and 100/)
    expect(() => parseRoll('1d1')).toThrow(/sides/)
    expect(() => parseRoll('2d6kh3')).toThrow(/keep or drop/)
    expect(() => parseRoll('2d6 adv')).toThrow(/single d20/)
  })
})

describe('roll', () => {
  it('adds dice and modifiers', () => {
    const r = roll('2d6+3', d(6, 4, 5))
    expect(r.dice).toEqual([
      { sides: 6, value: 4, kept: true },
      { sides: 6, value: 5, kept: true }
    ])
    expect(r).toMatchObject({ total: 12, modifier: 3, crit: false, fumble: false })
  })

  it('keeps the highest three of 4d6', () => {
    const r = roll('4d6kh3', d(6, 2, 6, 1, 5))
    expect(r.dice.map((x) => x.kept)).toEqual([true, true, false, true])
    expect(r.total).toBe(13)
  })

  it('drops the lowest and keeps the lowest', () => {
    expect(roll('4d6dl1', d(6, 3, 3, 1, 6)).total).toBe(12)
    expect(roll('3d6kl1', d(6, 4, 2, 5)).total).toBe(2)
  })

  it('rolls advantage and disadvantage on a d20', () => {
    const adv = roll('1d20+2 adv', d(20, 7, 15))
    expect(adv.dice.map((x) => [x.value, x.kept])).toEqual([[7, false], [15, true]])
    expect(adv.total).toBe(17)
    const dis = roll('1d20+2 dis', d(20, 7, 15))
    expect(dis.total).toBe(9)
  })

  it('flags natural 20s and 1s on the kept d20 only', () => {
    expect(roll('1d20+5', d(20, 20)).crit).toBe(true)
    expect(roll('1d20+5', d(20, 1)).fumble).toBe(true)
    expect(roll('1d20 adv', d(20, 1, 20))).toMatchObject({ crit: true, fumble: false })
    expect(roll('1d20 dis', d(20, 1, 20))).toMatchObject({ crit: false, fumble: true })
    expect(roll('2d20', d(20, 20, 20)).crit).toBe(false) // not a single d20 roll
  })

  it('handles subtraction of dice', () => {
    expect(roll('10-1d4', d(4, 3)).total).toBe(7)
  })

  it('formats the roll for the session note', () => {
    const r = roll('1d20+5 Perception', d(20, 14))
    r.dc = 15
    r.success = true
    expect(formatRoll(r)).toBe('**1d20+5** → ⟨14⟩ + 5 = **19** · DC 15 ✓ success')
    expect(formatRoll(roll('4d6kh3', d(6, 2, 6, 1, 5)))).toBe('**4d6kh3** → ⟨2⟩ ⟨6⟩ ~~1~~ ⟨5⟩ = **13**')
  })

  it('uses the crypto RNG by default and stays in range', () => {
    for (let i = 0; i < 300; i++) {
      const r = roll('1d6')
      expect(r.total).toBeGreaterThanOrEqual(1)
      expect(r.total).toBeLessThanOrEqual(6)
    }
  })
})

describe('checks and saves', () => {
  const sheet = { ...defaultSheet(), dex: 16, wis: 13, proficiency_bonus: 2, skills: ['stealth'], saves: ['dex' as const] }

  it('resolves abilities and skills by key or name', () => {
    expect(resolveTarget('dex')).toMatchObject({ kind: 'ability', ability: 'dex', name: 'Dexterity' })
    expect(resolveTarget('Dexterity')).toMatchObject({ ability: 'dex' })
    expect(resolveTarget('sleight-of-hand')).toMatchObject({ kind: 'skill', ability: 'dex', name: 'Sleight of Hand' })
    expect(resolveTarget('wis', true)).toMatchObject({ kind: 'save', name: 'Wisdom save' })
    expect(resolveTarget('stealth', true)).toBeNull()
    expect(resolveTarget('cooking')).toBeNull()
  })

  it('adds proficiency only when proficient', () => {
    expect(checkBonus(sheet, resolveTarget('stealth')!)).toEqual({ bonus: 5, proficient: true })
    expect(checkBonus(sheet, resolveTarget('acrobatics')!)).toEqual({ bonus: 3, proficient: false })
    expect(checkBonus(sheet, resolveTarget('dex', true)!)).toEqual({ bonus: 5, proficient: true })
    expect(checkBonus(sheet, resolveTarget('wis', true)!)).toEqual({ bonus: 1, proficient: false })
    expect(checkBonus(sheet, resolveTarget('dex')!)).toEqual({ bonus: 3, proficient: false })
  })

  it('rolls against a DC', () => {
    const r = rollCheck(sheet, resolveTarget('stealth')!, 15, 'normal', d(20, 10))
    expect(r).toMatchObject({ total: 15, dc: 15, success: true, label: 'Stealth' })
    const fail = rollCheck(sheet, resolveTarget('wis', true)!, 13, 'adv', d(20, 4, 9))
    expect(fail).toMatchObject({ total: 10, success: false, mode: 'adv' })
  })

  it('parses /check arguments', () => {
    expect(parseCheckArgs('dex 15')).toEqual({ target: 'dex', dc: 15, mode: 'normal' })
    expect(parseCheckArgs('sleight of hand DC 12 adv')).toEqual({ target: 'sleight of hand', dc: 12, mode: 'adv' })
    expect(parseCheckArgs('perception')).toEqual({ target: 'perception', dc: undefined, mode: 'normal' })
  })

  it('maps XP to levels', () => {
    expect(levelForXp(0)).toBe(1)
    expect(levelForXp(299)).toBe(1)
    expect(levelForXp(300)).toBe(2)
    expect(levelForXp(400000)).toBe(20)
  })
})

describe('combat', () => {
  it('parses /add with counts and dice HP', () => {
    expect(parseAddArgs('Goblin hp 7 ac 15 init +2')).toEqual([{ name: 'Goblin', count: 1, hp: 7, ac: 15, initMod: 2 }])
    const wolves = parseAddArgs('3 Wolves hp 2d8+2 ac 13', d(8, 5, 3, 8, 1, 4, 4))
    expect(wolves.map((w) => [w.name, w.hp, w.ac])).toEqual([
      ['Wolf 1', 10, 13],
      ['Wolf 2', 11, 13],
      ['Wolf 3', 10, 13]
    ])
    expect(parseAddArgs('2x Bandit Captain hp 65 ac 15 init -1').map((b) => b.name)).toEqual(['Bandit Captain 1', 'Bandit Captain 2'])
    expect(() => parseAddArgs('')).toThrow(/Usage/)
  })

  it('rolls initiative, sorts, and steps through turns and rounds', () => {
    let c = addCombatants(emptyCombat(), [
      { name: 'Goblin', count: 1, hp: 7, ac: 15, initMod: 2 },
      { name: 'Ogre', count: 1, hp: 59, ac: 11, initMod: -1 }
    ])
    c = addCombatants(c, [{ name: 'Aria', count: 1, hp: 24, ac: 15, initMod: 3 }], { is_player: true })
    c = rollInitiative(c, d(20, 10, 15, 5)) // Goblin 12, Ogre 14, Aria 8
    expect(c.active).toBe(true)
    expect(c.combatants.map((x) => [x.name, x.initiative])).toEqual([
      ['Ogre', 14],
      ['Goblin', 12],
      ['Aria', 8]
    ])
    c = nextTurn(c)
    expect([c.turn, c.round]).toEqual([1, 1])
    c = nextTurn(nextTurn(c))
    expect([c.turn, c.round]).toEqual([0, 2])
    c = prevTurn(c)
    expect([c.turn, c.round]).toEqual([2, 1])
  })

  it('skips defeated monsters but never the player', () => {
    let c = addCombatants(emptyCombat(), [
      { name: 'A', count: 1, hp: 5, ac: 10, initMod: 0 },
      { name: 'B', count: 1, hp: 5, ac: 10, initMod: 0 }
    ])
    c = { ...rollInitiative(c, d(20, 15, 10)) }
    c = applyHp(c, findCombatant(c, 'b')!.id, 99)
    expect(findCombatant(c, 'B')!.hp).toBe(0)
    c = nextTurn(c)
    expect(c.turn).toBe(0)
    expect(c.round).toBe(2)
  })

  it('heals without exceeding max and removes combatants safely', () => {
    let c = addCombatants(emptyCombat(), [{ name: 'Orc', count: 1, hp: 15, ac: 13, initMod: 1 }, { name: 'Elf', count: 1, hp: 9, ac: 14, initMod: 3 }])
    const orc = findCombatant(c, 'orc')!
    c = applyHp(applyHp(c, orc.id, 10), orc.id, -50)
    expect(findCombatant(c, 'orc')!.hp).toBe(15)
    c = { ...c, turn: 1 }
    c = removeCombatant(c, orc.id)
    expect(c.combatants.map((x) => x.name)).toEqual(['Elf'])
    expect(c.turn).toBe(0)
  })
})

describe('sheet changes', () => {
  const base = { ...defaultSheet(), hp: 20, max_hp: 24, temp_hp: 3, gold: 10, inventory: [{ name: 'Rope', qty: 1 }], conditions: [] as string[] }

  it('normalises raw <state> objects', () => {
    expect(normalizeStateChange({ hp: '-4', add_item: ' rope ', junk: 1, gold: 0 })).toEqual({ hp: -4, add_item: 'rope' })
  })

  it('applies damage through temp HP, items and conditions', () => {
    const { sheet, applied } = applyStateChanges(base, [{ hp: -5 }, { add_item: 'Torch', gold: -15 }, { add_condition: 'Poisoned' }, { remove_item: 'rope' }])
    expect(sheet).toMatchObject({ hp: 18, temp_hp: 0, gold: 0, conditions: ['poisoned'] })
    expect(sheet.inventory).toEqual([{ name: 'Torch', qty: 1 }])
    expect(applied).toEqual([{ hp: -2, temp_hp: -3 }, { gold: -10, add_item: 'Torch' }, { add_condition: 'poisoned' }, { remove_item: 'Rope' }])
    expect(describeChange(applied[0]!)).toBe('HP −2, temp HP −3')
  })

  it('undoes exactly what was applied', () => {
    const { sheet, applied } = applyStateChanges(base, [{ hp: -5 }, { add_item: 'Torch', gold: -15 }, { add_condition: 'poisoned' }, { remove_item: 'Rope' }])
    expect(undoStateChanges(sheet, applied)).toEqual(base)
  })

  it('clamps healing at max HP and records only the real change', () => {
    const { sheet, applied } = applyStateChanges(base, [{ hp: 100 }])
    expect(sheet.hp).toBe(24)
    expect(applied).toEqual([{ hp: 4 }])
  })

  it('handles rests and levelling up', () => {
    const hurt = { ...base, class: 'Fighter', level: 3, con: 14, hp: 5, spell_slots: { '1': { max: 2, used: 2 } }, conditions: ['exhaustion'] }
    const short = shortRest(hurt, 2, d(10, 6, 9))
    expect(short.rolls).toEqual([8, 11])
    expect(short.sheet.hp).toBe(24)
    expect(short.sheet.hit_dice).toEqual({ die: 10, max: 3, used: 2 })
    const long = longRest(short.sheet)
    expect(long).toMatchObject({ hp: 24, temp_hp: 0, conditions: [], spell_slots: { '1': { max: 2, used: 0 } } })
    expect(long.hit_dice!.used).toBe(1)
    const up = levelUp({ ...long, level: 4 })
    expect(up.hpGain).toBe(8)
    expect(up.sheet).toMatchObject({ level: 5, proficiency_bonus: 3, max_hp: 32 })
  })
})
