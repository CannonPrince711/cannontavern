import { describe, expect, it } from 'vitest'
import { parseIdeas, STATIC_TIPS, tipsFor } from '../src/shared/tips'

describe('parseIdeas', () => {
  it('reads a JSON array, even with text around it', () => {
    expect(parseIdeas('Here you go:\n["Pick the lock (DEX +5)", "Ask Ysolde about the bell", "Climb the tower"]')).toEqual([
      'Pick the lock (DEX +5)',
      'Ask Ysolde about the bell',
      'Climb the tower'
    ])
  })

  it('keeps [CHECK …] tags inside JSON ideas', () => {
    expect(parseIdeas('["Call for a check: [CHECK perception DC 13]", "a", "b"]')[0]).toBe('Call for a check: [CHECK perception DC 13]')
  })

  it('falls back to bulleted or numbered lines', () => {
    expect(parseIdeas('Ideas:\n1. Search the desk\n2) Bribe the guard\n- Hide in the cart\n• Extra one')).toEqual(['Search the desk', 'Bribe the guard', 'Hide in the cart'])
  })

  it('does not mistake a lone [CHECK] tag for JSON', () => {
    expect(parseIdeas('- Have the guard notice them [CHECK stealth DC 14]\n- An old friend appears\n- The bridge creaks')).toHaveLength(3)
  })
})

describe('static tips', () => {
  it('shows DM tips to the DM and player tips to players, app tips to everyone', () => {
    const dm = tipsFor('user-dm')
    const player = tipsFor('ai-dm')
    const dmOnly = STATIC_TIPS.filter((t) => t.audience === 'dm').map((t) => t.text)
    const playerOnly = STATIC_TIPS.filter((t) => t.audience === 'player').map((t) => t.text)
    expect(dmOnly.every((t) => dm.includes(t))).toBe(true)
    expect(playerOnly.some((t) => dm.includes(t))).toBe(false)
    expect(playerOnly.every((t) => player.includes(t))).toBe(true)
    expect(dmOnly.some((t) => player.includes(t))).toBe(false)
    expect(tipsFor('ai-only').length).toBe(STATIC_TIPS.length)
  })
})
