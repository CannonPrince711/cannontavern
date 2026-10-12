import { describe, expect, it } from 'vitest'
import { chargenPrompt, fixSheet, parseClasses, repairCharacterJson } from '@shared/chargen'
import { extractJson } from '@shared/builder'
import { defaultSheet } from '@shared/notes'

const sheet35 = (over: object) => ({ ...defaultSheet('3.5e'), ...over })
const sheet5e = (over: object) => ({ ...defaultSheet('5e'), ...over })

describe('character generator rules maths', () => {
  it('recalculates a level-1 3.5e Warblade', () => {
    const { sheet, changes } = fixSheet(sheet35({ class: 'Warblade 1', level: 1, con: 12, hp: 10, max_hp: 10, bab: 1, base_saves: { fort: 2, ref: 2, will: 0 } }))
    expect(sheet.max_hp).toBe(13)
    expect(sheet.bab).toBe(1)
    expect(sheet.base_saves).toEqual({ fort: 2, ref: 0, will: 0 })
    expect(changes.join(' ')).toMatch(/hit points 10 → 13/)
  })

  it('adds up 3.5e multiclass levels', () => {
    const { sheet } = fixSheet(sheet35({ class: 'Fighter 2 / Rogue 1', level: 1, con: 14 }))
    expect(sheet.level).toBe(3)
    expect(sheet.bab).toBe(2)
    expect(sheet.base_saves).toEqual({ fort: 3, ref: 2, will: 0 })
    // 10+2, then 6+2 (fighter 2), then 4+2 (rogue 1)
    expect(sheet.max_hp).toBe(26)
  })

  it('maps other systems’ skills to 3.5e and caps ranks at level + 3', () => {
    const { sheet } = fixSheet(sheet35({ class: 'Rogue 1', level: 1, skill_ranks: { Perception: 4, Stealth: 9, 'move silently': 4 } }))
    expect(sheet.skill_ranks).toEqual({ spot: 4, hide: 4, 'move silently': 4 })
  })

  it('keeps the model’s numbers for classes it doesn’t know', () => {
    const { sheet, changes } = fixSheet(sheet35({ class: 'Factotum 1', level: 1, hp: 9, max_hp: 9, bab: 0 }))
    expect(sheet.max_hp).toBe(9)
    expect(changes.filter((c) => /hit points|base attack/.test(c))).toEqual([])
  })

  it('recalculates 5e hit points, proficiency and saves', () => {
    const { sheet } = fixSheet(sheet5e({ class: 'Wizard 5', level: 5, con: 14, max_hp: 20, proficiency_bonus: 2 }))
    expect(sheet.max_hp).toBe(8 + 4 * 6)
    expect(sheet.proficiency_bonus).toBe(3)
    expect(sheet.saves).toEqual(['int', 'wis'])
    expect(sheet.hit_dice).toEqual({ die: 6, max: 5, used: 0 })
  })

  it('reads class strings', () => {
    expect(parseClasses('Paladin', 3)).toEqual([{ name: 'paladin', level: 3 }])
    expect(parseClasses('Favored Soul 2/Cleric 1', 1)).toEqual([{ name: 'favored soul', level: 2 }, { name: 'cleric', level: 1 }])
  })
})

describe('character generator JSON repairs', () => {
  it('fixes units, signed numbers and unbracketed example lines', () => {
    const reply = `{"name": "Pip", "mes_example": "'One.'", "'Two.'", "tags": ["x"], "dnd": {"speed": 30 ft., "bab": "+1", "gold": 15 gp}}`
    const j = extractJson(repairCharacterJson(reply)) as { mes_example: string; dnd: { speed: number; bab: number; gold: number } }
    expect(j.mes_example).toBe("'One.'\n'Two.'")
    expect(j.dnd).toEqual({ speed: 30, bab: 1, gold: 15 })
  })

  it('asks for an adult and the campaign’s edition', () => {
    const p = chargenPrompt({ concept: 'a gnome mechanic', level: 3, edition: '3.5e', minAge: 21, avoidNames: ['Kazuki'], campaign: { name: 'The Brass Meridian', setting: 'Steam', tone: 'Swashbuckling', houseRules: '', sources: ['Tome of Battle'] } })
    expect(p).toContain('adult (21 or older')
    expect(p).toContain('D&D 3.5 edition')
    expect(p).toContain('Do not reuse these names: Kazuki')
    expect(p).toContain('"base_saves"')
  })
})

describe('character generator skill names', () => {
  it('reads underscored and misspelled skills', () => {
    const { sheet } = fixSheet(sheet35({ class: 'Rogue 3', level: 3, con: 12, skill_ranks: { move_silently: 6, sense_motives: 4, repair: 9 } }))
    expect(sheet.skill_ranks).toEqual({ 'move silently': 6, 'sense motive': 4, 'craft (mechanism)': 6 })
    expect(sheet.max_hp).toBe(7 + 2 * 5)
    expect(sheet.bab).toBe(2)
    expect(sheet.base_saves).toEqual({ fort: 1, ref: 3, will: 1 })
  })
})

describe('character generator feat check', () => {
  it('flags more feats than the build allows', () => {
    const { changes } = fixSheet(sheet35({ race: 'Dwarf (Mountain)', class: 'Fighter', level: 2, con: 14, feats: ['Weapon Focus', 'Exotic Weapon Proficiency (firearms)', 'Diehard', 'Iron Will'] }))
    expect(changes).toContain('check feats: 4 listed, 3 expected for this build')
    expect(fixSheet(sheet35({ race: 'Human', class: 'Fighter 1', level: 1, feats: ['A', 'B', 'C'] })).changes.join(' ')).not.toMatch(/check feats/)
    expect(fixSheet(sheet35({ race: 'Wood Elf', class: 'Ranger 1', level: 1, feats: ['Exotic Weapon Proficiency', 'Track (ranger class feature)'] })).changes.join(' ')).not.toMatch(/check feats/)
  })
})
