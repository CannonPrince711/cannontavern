import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { ADULT_RULE_DEFAULTS, adultRuleFrom, adultRuleLine, CampaignConceptSchema, emptyDraft, needsAdultRule, piecePrompt } from '../src/shared/builder'

const require = createRequire(import.meta.url)
const mature = require('../extensions/mature-mode/main.js') as { _guidance: (ctx: { settings: Record<string, unknown> }) => string }
const manifest = JSON.parse(readFileSync(new URL('../extensions/mature-mode/extension.json', import.meta.url), 'utf8')) as { settings: { key: string; default: unknown }[] }

describe('adults-only rule (Mature Mode settings)', () => {
  it('never goes below 18, and falls back to the defaults', () => {
    expect(adultRuleFrom({ minAge: 16 }).minAge).toBe(18)
    expect(adultRuleFrom({ minAge: '25' }).minAge).toBe(25)
    expect(adultRuleFrom({ minAge: 'old' }).minAge).toBe(21)
    expect(adultRuleFrom(undefined)).toEqual(ADULT_RULE_DEFAULTS)
  })

  it('uses the chosen age, rule and trigger tones in the builder prompt', () => {
    const rule = adultRuleFrom({ minAge: 25, adultRule: 'Keep it at the university.', adultTones: 'steamy, harem' })
    expect(needsAdultRule(['Steamy noir'], rule)).toBe(true)
    expect(needsAdultRule(['Spicy (18+)'], rule)).toBe(false)
    const p = piecePrompt(CampaignConceptSchema.parse({ tones: ['Harem'] }), emptyDraft(), 'npcs', rule)
    expect(p).toContain('Every character is an adult (25 or older). Keep it at the university.')
    expect(adultRuleLine(adultRuleFrom({ adultRule: '' }))).toBe('Every character is an adult (21 or older).')
  })

  it('ships the same defaults in the extension manifest', () => {
    const defaults = Object.fromEntries(manifest.settings.map((s) => [s.key, s.default]))
    for (const [k, v] of Object.entries(ADULT_RULE_DEFAULTS)) expect(defaults[k]).toEqual(v)
  })

  it('tells the chat model the age and rule, never below 18', () => {
    const g = mature._guidance({ settings: { minAge: 10, adultRule: 'No school settings.', intensity: 'explicit' } })
    expect(g).toContain('adult (18 or older)')
    expect(g).toContain('No school settings.')
    expect(mature._guidance({ settings: { minAge: 30 } })).toContain('adult (30 or older)')
  })
})
