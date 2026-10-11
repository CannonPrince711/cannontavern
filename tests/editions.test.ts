import { describe, expect, it } from 'vitest'
import { checkBonus, levelForXp, resolveTarget, rollCheck, xpForLevel } from '../src/shared/checks'
import { rulesLine, SOURCEBOOKS, xpForLevel35 } from '../src/shared/editions'
import { defaultSheet, normalizeSheet } from '../src/shared/notes'
import { buildPrompt, normalizeBlockOrder, renderSheet } from '../src/shared/prompt'
import { longRest, shortRest } from '../src/shared/sheet'
import type { DndSheet } from '../src/shared/types'

const rogue35 = (): DndSheet => ({
  ...defaultSheet('3.5e'),
  race: 'Halfling',
  class: 'Rogue',
  level: 3,
  dex: 16,
  wis: 12,
  con: 10,
  int: 14,
  bab: 2,
  base_saves: { fort: 1, ref: 3, will: 1 },
  skill_ranks: { spot: 4, 'move silently': 6, 'knowledge (arcana)': 2 },
  feats: ['Weapon Finesse'],
  hp: 10,
  max_hp: 18
})

describe('3.5 checks', () => {
  it('resolves 3.5 skills, aliases and saves', () => {
    expect(resolveTarget('spot', false, '3.5e')).toMatchObject({ kind: 'skill', skill: 'spot', ability: 'wis' })
    expect(resolveTarget('Move Silently', false, '3.5e')?.skill).toBe('move silently')
    expect(resolveTarget('knowledge arcana', false, '3.5e')?.skill).toBe('knowledge (arcana)')
    expect(resolveTarget('perception', false, '3.5e')?.skill).toBe('spot')
    expect(resolveTarget('reflex', false, '3.5e')).toMatchObject({ kind: 'save', save35: 'ref', name: 'Reflex save' })
    expect(resolveTarget('dex save', false, '3.5e')).toMatchObject({ kind: 'save', save35: 'ref' })
    expect(resolveTarget('con', true, '3.5e')).toMatchObject({ save35: 'fort' })
    expect(resolveTarget('str', true, '3.5e')).toBeNull() // no Strength saves in 3.5
    expect(resolveTarget('spot', false, '5e')).toBeNull()
    // In 5e, Fort/Ref/Will map to ability saves.
    expect(resolveTarget('reflex', false, '5e')).toMatchObject({ kind: 'save', ability: 'dex', name: 'Dexterity save' })
  })

  it('adds ranks and base saves to ability modifiers', () => {
    const s = rogue35()
    expect(checkBonus(s, resolveTarget('move silently', false, '3.5e')!).bonus).toBe(9) // 6 ranks + DEX 3
    expect(checkBonus(s, resolveTarget('spot', false, '3.5e')!).bonus).toBe(5) // 4 + WIS 1
    expect(checkBonus(s, resolveTarget('hide', false, '3.5e')!)).toEqual({ bonus: 3, proficient: false })
    expect(checkBonus(s, resolveTarget('reflex', false, '3.5e')!).bonus).toBe(6) // 3 + DEX 3
    expect(checkBonus(s, resolveTarget('fortitude', false, '3.5e')!).bonus).toBe(1)
  })

  it('makes a natural 20 save and a natural 1 fail in 3.5', () => {
    const s = rogue35()
    const reflex = resolveTarget('reflex', false, '3.5e')!
    expect(rollCheck(s, reflex, 99, 'normal', () => 0.999).success).toBe(true)
    expect(rollCheck(s, reflex, 2, 'normal', () => 0).success).toBe(false)
    // Skill checks have no automatic success.
    expect(rollCheck(s, resolveTarget('spot', false, '3.5e')!, 99, 'normal', () => 0.999).success).toBe(false)
  })

  it('uses the 3.5 experience table', () => {
    expect(xpForLevel35(2)).toBe(1000)
    expect(xpForLevel35(3)).toBe(3000)
    expect(xpForLevel(5, '3.5e')).toBe(10000)
    expect(levelForXp(2999, '3.5e')).toBe(2)
    expect(levelForXp(3000, '3.5e')).toBe(3)
    expect(levelForXp(3000, '5e')).toBe(4)
  })
})

describe('3.5 sheets', () => {
  it('normalises 3.5 fields only for 3.5 sheets', () => {
    const s = normalizeSheet({ edition: '3.5e', bab: 4, base_saves: { fort: 2 }, skill_ranks: { Spot: 3, Hide: 0 }, feats: ['Dodge'] })
    expect(s.edition).toBe('3.5e')
    expect(s.bab).toBe(4)
    expect(s.base_saves).toEqual({ fort: 2, ref: 0, will: 0 })
    expect(s.skill_ranks).toEqual({ spot: 3 })
    expect(s.feats).toEqual(['Dodge'])
    const five = normalizeSheet({ bab: 4, skill_ranks: { spot: 3 } })
    expect(five.edition).toBeUndefined()
    expect(five.bab).toBeUndefined()
  })

  it('renders a 3.5 sheet for the prompt', () => {
    const text = renderSheet('Pip', rogue35())
    expect(text).toContain('Character sheet (D&D 3.5)')
    expect(text).toContain('Base attack +2')
    expect(text).toContain('Saves: Fortitude +1, Reflex +6, Will +2')
    expect(text).toContain('Move Silently +9 (6 ranks)')
    expect(text).toContain('Knowledge (arcana) +4 (2 ranks)')
    expect(text).toContain('Feats: Weapon Finesse')
    expect(text).not.toContain('Proficiency')
  })

  it('rests the 3.5 way', () => {
    const s = { ...rogue35(), conditions: ['exhausted', 'shaken'] }
    const rested = longRest(s)
    expect(rested.hp).toBe(13) // +1 per level
    expect(rested.conditions).toEqual(['fatigued', 'shaken'])
    expect(shortRest(s, 1).healed).toBe(0)
  })
})

describe('rules in the prompt', () => {
  it('names the edition, the books and the check format', () => {
    const line = rulesLine('3.5e', ['Complete Warrior', 'Spell Compendium'])
    expect(line).toContain('3.5 edition (not 5th edition)')
    expect(line).toContain('Complete Warrior, Spell Compendium')
    expect(line).toContain('[CHECK spot DC 15]')
    expect(rulesLine('5e', [])).toBe('Rules: Dungeons & Dragons 5th edition. Allowed sources: the core rulebooks.')
    expect(SOURCEBOOKS['3.5e'].filter((b) => b.core)).toHaveLength(3)
  })

  it('puts the rules line in the campaign block', () => {
    const p = buildPrompt({
      userName: 'Pip', character: null, campaign: null, party: null, preset: null, lore: [], sheet: rogue35(), combat: null, summary: null,
      messages: [], order: normalizeBlockOrder([]), budget: 8000, maxReplyTokens: 500, tokenizer: 'chars4', autoState: false,
      rules: rulesLine('3.5e', ['Complete Arcane'])
    })
    const block = p.blocks.find((b) => b.id === 'campaign')!
    expect(block.content.startsWith('Rules: Dungeons & Dragons 3.5 edition')).toBe(true)
    expect(p.system).toContain('Character sheet (D&D 3.5)')
  })
})
