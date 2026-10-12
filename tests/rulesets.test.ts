import { describe, expect, it } from 'vitest'
import { defaultSheet } from '../src/shared/notes'
import { chargenPrompt, fixSheet } from '../src/shared/chargen'
import { BUILTIN_RULESETS, builtinRuleset, rulesetForEdition, rulesetFromNote, rulesetPrompt, rulesetRef, rulesetToNote } from '../src/shared/rulesets'

describe('rulesets', () => {
  it('has the built-in games, each on a sheet engine', () => {
    expect(BUILTIN_RULESETS.map((r) => r.id)).toEqual(['dnd5e', 'dnd35', 'pf1e', 'pf2e', 'heroes', 'scifi'])
    expect(builtinRuleset('pf1e')?.engine).toBe('3.5e')
    expect(builtinRuleset('heroes')?.terms.class).toBe('Archetype')
    expect(rulesetForEdition('3.5e').id).toBe('dnd35')
    expect(rulesetForEdition(undefined).id).toBe('dnd5e')
  })

  it('sends D&D rulesets with their sourcebooks and others with their own rules', () => {
    expect(rulesetPrompt(builtinRuleset('dnd35')!, ['Player’s Handbook'])).toMatch(/3\.5 edition.*Player’s Handbook/)
    expect(rulesetPrompt(builtinRuleset('pf2e')!, [])).toMatch(/Pathfinder 2nd edition/)
  })

  it('resolves campaign values to ids or note paths', () => {
    expect(rulesetRef('pf2e', 'DND Tavern')).toBe('pf2e')
    expect(rulesetRef('[[DND Tavern/Rulesets/Neon Streets|Neon Streets]]', 'DND Tavern')).toBe('DND Tavern/Rulesets/Neon Streets.md')
    expect(rulesetRef('Neon Streets', 'DND Tavern')).toBe('DND Tavern/Rulesets/Neon Streets.md')
    expect(rulesetRef('', 'DND Tavern')).toBeUndefined()
  })

  it('round-trips a custom ruleset through its note', () => {
    const { data, body } = rulesetToNote({
      name: 'Neon Streets',
      short: 'Neon',
      engine: '5e',
      math: false,
      sourcebooks: false,
      rules: 'Rules: Neon Streets. Roll d20 + skill vs DC. Street Cred buys favours.',
      classes: ['Netrunner', 'Fixer'],
      ancestries: ['Human', 'Chromed'],
      terms: { race: 'Background', class: 'Role', level: 'Rep', spells: 'Programs' },
      blurb: 'Chrome and rain.'
    })
    expect(body).toContain('Street Cred buys favours.')
    expect(body).not.toContain('Rules: Neon Streets.')
    const r = rulesetFromNote('DND Tavern/Rulesets/Neon Streets.md', data, body)
    expect(r).toMatchObject({ id: 'DND Tavern/Rulesets/Neon Streets.md', name: 'Neon Streets', custom: true, math: false, classes: ['Netrunner', 'Fixer'] })
    expect(r.rules).toMatch(/^Rules: Neon Streets\. Roll d20 \+ skill vs DC\. Street Cred buys favours\. Always ask for checks exactly as \[CHECK/)
    expect(r.terms.spells).toBe('Programs')
    // Saving again doesn't pile up the app's check line.
    const again = rulesetToNote(r)
    expect(again.body).toBe(body)
  })
})

describe('sheet maths per ruleset', () => {
  const sheet35 = (o: object) => ({ ...defaultSheet('3.5e'), ...o })

  it('leaves sheets alone for games that count differently', () => {
    const s = { ...defaultSheet('5e'), class: 'Brick 10', level: 10, max_hp: 3, hp: 3, proficiency_bonus: 7 }
    const { sheet, changes } = fixSheet(s, { math: false })
    expect(sheet.max_hp).toBe(3)
    expect(sheet.proficiency_bonus).toBe(7)
    expect(changes).toEqual([])
  })

  it('counts Pathfinder 1e feats and skills its own way', () => {
    // Level 3: feats at 1st and 3rd.
    const ok = fixSheet(sheet35({ race: 'Elf', class: 'Rogue 3', level: 3, feats: ['Weapon Finesse', 'Dodge'] }), { variant: 'pf1e' })
    expect(ok.changes.join(' ')).not.toMatch(/check feats/)
    const { sheet } = fixSheet(sheet35({ class: 'Rogue 1', level: 1, skill_ranks: { Perception: 4, Stealth: 1 } }), { variant: 'pf1e' })
    expect(sheet.skill_ranks).toEqual({ perception: 1, stealth: 1 })
  })

  it('writes the generator prompt in the game’s own terms', () => {
    const r = builtinRuleset('heroes')!
    const prompt = chargenPrompt({ concept: 'a speedster courier', level: 10, edition: '5e', minAge: 21, avoidNames: [], ruleset: r })
    expect(prompt).toMatch(/power level/i)
    expect(prompt).toContain('"class" is the Archetype')
    expect(prompt).not.toMatch(/D&D 5th edition: 5e classes/)
  })
})

describe('sheets without automatic maths', () => {
  it('fills in hit points the model left at zero', () => {
    const { sheet, changes } = fixSheet({ ...defaultSheet('5e'), class: 'Speedster', level: 10, con: 14, hp: 0, max_hp: 0 }, { math: false })
    expect(sheet.max_hp).toBe(8 + 2 + 9 * 7)
    expect(sheet.hp).toBe(sheet.max_hp)
    expect(changes[0]).toMatch(/hit points 0 →/)
  })
})
