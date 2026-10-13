import { describe, expect, it } from 'vitest'
import { conditionNote } from '@shared/checks'
import type { Rng } from '@shared/dice'
import { defaultSheet, normalizeSheet } from '@shared/notes'
import { renderSheet } from '@shared/prompt'
import {
  applyStateChanges,
  classResources,
  concentrationDc,
  damage,
  deathSave,
  deathState,
  describeChange,
  heal,
  longRest,
  normalizeStateChange,
  shortRest,
  spendResource,
  undoStateChanges
} from '@shared/sheet'
import type { DndSheet } from '@shared/types'

/** An RNG that makes a d20 show the given faces, in order. */
const d20 = (...values: number[]): Rng => {
  let i = 0
  return () => (values[i++]! - 0.5) / 20
}

const base: DndSheet = {
  ...defaultSheet(),
  class: 'Fighter',
  level: 5,
  hp: 30,
  max_hp: 30,
  resources: [
    { name: 'Second Wind', max: 1, used: 1, reset: 'short' },
    { name: 'Indomitable', max: 1, used: 1, reset: 'long' }
  ]
}

describe('death saves', () => {
  const down = { ...base, hp: 0 }

  it('counts successes, failures and the natural 1 and 20 rules', () => {
    expect(deathState(down)).toBe('dying')
    const a = deathSave(down, d20(12))
    expect(a.outcome).toBe('success')
    expect(a.sheet.death_saves).toEqual({ successes: 1, failures: 0 })
    const b = deathSave(a.sheet, d20(1))
    expect(b.outcome).toBe('failure')
    expect(b.sheet.death_saves).toEqual({ successes: 1, failures: 2 })
    const c = deathSave(b.sheet, d20(4))
    expect(c.outcome).toBe('dead')
    expect(deathState(c.sheet)).toBe('dead')
    const revived = deathSave(down, d20(20))
    expect(revived.outcome).toBe('revived')
    expect(revived.sheet).toMatchObject({ hp: 1, death_saves: undefined })
  })

  it('becomes stable on the third success', () => {
    const s = { ...down, death_saves: { successes: 2, failures: 1 } }
    const r = deathSave(s, d20(15))
    expect(r.outcome).toBe('stable')
    expect(deathState(r.sheet)).toBe('stable')
  })

  it('turns damage at 0 HP into a failure, and healing clears the saves', () => {
    const hit = damage({ ...down, death_saves: { successes: 1, failures: 0 } }, 3)
    expect(hit.death_saves).toEqual({ successes: 1, failures: 1 })
    expect(heal(hit, 4)).toMatchObject({ hp: 4, death_saves: undefined })
  })

  it('is a 5e rule only', () => {
    expect(deathState({ ...down, edition: '3.5e' })).toBeNull()
    expect(damage({ ...down, edition: '3.5e' }, 5).death_saves).toBeUndefined()
  })
})

describe('concentration', () => {
  it('uses DC 10 or half the damage', () => {
    expect(concentrationDc(7)).toBe(10)
    expect(concentrationDc(23)).toBe(11)
  })

  it('ends when the character drops to 0 HP, and undo brings it back', () => {
    const s = { ...base, hp: 5, concentration: 'Bless' }
    expect(damage(s, 3).concentration).toBe('Bless')
    const { sheet, applied } = applyStateChanges(s, [{ hp: -9 }])
    expect(sheet.concentration).toBeUndefined()
    expect(describeChange(applied[0]!)).toBe('HP −5, concentration ended')
    expect(undoStateChanges(sheet, applied)).toMatchObject({ hp: 5, concentration: 'Bless' })
  })

  it('is set and ended by the model', () => {
    expect(normalizeStateChange({ concentration: 'Hold Person' })).toEqual({ concentration: 'Hold Person' })
    expect(normalizeStateChange({ concentration: 'none' })).toEqual({ concentration: '' })
    expect(normalizeStateChange({ concentration: null })).toEqual({ concentration: '' })
    const s = { ...base, concentration: 'Bless' }
    const { sheet, applied } = applyStateChanges(s, [{ concentration: 'Hold Person' }])
    expect(sheet.concentration).toBe('Hold Person')
    expect(undoStateChanges(sheet, applied).concentration).toBe('Bless')
  })
})

describe('inspiration', () => {
  it('is gained and spent through state changes, with undo', () => {
    expect(normalizeStateChange({ inspiration: 'true' })).toEqual({ inspiration: true })
    const { sheet, applied } = applyStateChanges(base, [{ inspiration: true }, { inspiration: true }])
    expect(sheet.inspiration).toBe(true)
    expect(applied).toEqual([{ inspiration: true }])
    expect(undoStateChanges(sheet, applied).inspiration).toBeUndefined()
  })
})

describe('limited-use features', () => {
  it('spends by name or prefix and never goes past the maximum', () => {
    const s = { ...base, resources: [{ name: 'Ki points', max: 5, used: 0, reset: 'short' as const }] }
    const r = spendResource(s, 'ki', 2)!
    expect(r.resource.used).toBe(2)
    expect(spendResource(r.sheet, 'Ki points', 9)!.changed).toBe(3)
    expect(spendResource(s, 'rage')).toBeNull()
  })

  it('is spent by the model and undone', () => {
    const s = { ...base, resources: [{ name: 'Rage', max: 3, used: 0, reset: 'long' as const }] }
    const { sheet, applied } = applyStateChanges(s, [normalizeStateChange({ use_resource: 'rage' })])
    expect(sheet.resources![0]!.used).toBe(1)
    expect(describeChange(applied[0]!)).toBe('used Rage')
    expect(undoStateChanges(sheet, applied).resources![0]!.used).toBe(0)
  })

  it('recharges on the right rest', () => {
    const short = shortRest(base, 0)
    expect(short.rolls).toEqual([])
    expect(short.sheet.resources!.map((r) => r.used)).toEqual([0, 1])
    expect(longRest(base).resources!.map((r) => r.used)).toEqual([0, 0])
    expect(longRest({ ...base, edition: '3.5e' }).resources!.map((r) => r.used)).toEqual([0, 0])
  })

  it('suggests SRD features for a class and level', () => {
    expect(classResources({ ...base, resources: [] }).map((r) => `${r.name} ${r.max} ${r.reset}`)).toEqual(['Second Wind 1 short', 'Action Surge 1 short'])
    expect(classResources({ ...defaultSheet(), class: 'Monk', level: 6 })).toEqual([{ name: 'Ki points', max: 6, used: 0, reset: 'short' }])
    expect(classResources({ ...defaultSheet(), class: 'Bard', level: 5, cha: 16 })).toEqual([{ name: 'Bardic Inspiration', max: 3, used: 0, reset: 'short' }])
    expect(classResources({ ...defaultSheet('3.5e'), class: 'Barbarian' })).toEqual([])
  })
})

describe('reading and rendering the new fields', () => {
  it('normalizes hand-edited frontmatter', () => {
    const s = normalizeSheet({
      death_saves: { successes: '2', failures: 5 },
      inspiration: 'true',
      concentration: ' Bless ',
      resources: [{ name: 'Rage', max: 3, used: 9 }, { name: '' }, { name: 'Ki', max: '4', reset: 'Short' }],
      coins: { pp: 2, sp: '15', cp: 0, junk: 3 }
    })
    expect(s.death_saves).toEqual({ successes: 2, failures: 3 })
    expect(s.inspiration).toBe(true)
    expect(s.concentration).toBe('Bless')
    expect(s.resources).toEqual([
      { name: 'Rage', max: 3, used: 3, reset: 'long' },
      { name: 'Ki', max: 4, used: 0, reset: 'short' }
    ])
    expect(s.coins).toEqual({ pp: 2, sp: 15 })
    expect(normalizeSheet({})).not.toHaveProperty('resources')
  })

  it('tells the DM about them', () => {
    const text = renderSheet('Aria', {
      ...base,
      hp: 0,
      gold: 12,
      coins: { sp: 4 },
      death_saves: { successes: 1, failures: 2 },
      concentration: 'Bless',
      inspiration: true
    })
    expect(text).toContain('Coins: 12 gp, 4 sp')
    expect(text).toContain('death saves 1 succeeded, 2 failed')
    expect(text).toContain('Concentrating on: Bless')
    expect(text).toContain('Has inspiration.')
    expect(text).toContain('Limited features left: Second Wind 0/1 (per short rest), Indomitable 0/1 (per long rest)')
    expect(renderSheet('Aria', { ...defaultSheet(), gold: 7 })).toContain('· Gold 7')
  })

  it('has condition reminders', () => {
    expect(conditionNote('Poisoned')).toMatch(/Disadvantage/)
    expect(conditionNote('exhaustion 2')).toMatch(/levels/)
    expect(conditionNote('shaken', '3.5e')).toMatch(/−2/)
    expect(conditionNote('nonsense')).toBeUndefined()
  })
})
