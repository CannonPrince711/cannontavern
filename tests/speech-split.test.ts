import { describe, expect, it } from 'vitest'
import { splitForSpeech } from '../src/shared/speech'

describe('splitForSpeech', () => {
  it('keeps short text whole', () => {
    expect(splitForSpeech('The door creaks open.')).toEqual(['The door creaks open.'])
  })

  it('breaks long narration at sentences, starting with a short piece', () => {
    const s = 'The wind howls across the frozen pass as your party crests the ridge. '
    const text = s.repeat(20)
    const pieces = splitForSpeech(text)
    expect(pieces[0]!.length).toBeLessThanOrEqual(160)
    for (const p of pieces) {
      expect(p.length).toBeLessThanOrEqual(360)
      expect(p.endsWith('ridge.')).toBe(true)
    }
    expect(pieces.join(' ')).toBe(text.trim())
  })

  it('splits a run-on sentence at commas or spaces', () => {
    const text = Array.from({ length: 60 }, (_, i) => `clause number ${i}`).join(', ')
    const pieces = splitForSpeech(text)
    expect(pieces.length).toBeGreaterThan(1)
    for (const p of pieces) expect(p.length).toBeLessThanOrEqual(360)
    expect(pieces.join(' ').replace(/\s+/g, ' ')).toBe(text)
  })

  it('keeps closing quotes with their sentence', () => {
    expect(splitForSpeech('“Run!” she cries. The ice cracks.', { first: 10, max: 20 })).toEqual(['“Run!”', 'she cries.', 'The ice cracks.'])
  })
})
