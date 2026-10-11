import { describe, expect, it } from 'vitest'
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '@shared/ipc'

describe('IPC channel lists', () => {
  it('has no duplicates', () => {
    expect(new Set(INVOKE_CHANNELS).size).toBe(INVOKE_CHANNELS.length)
    expect(new Set(EVENT_CHANNELS).size).toBe(EVENT_CHANNELS.length)
  })

  it('uses namespace:action names', () => {
    for (const c of [...INVOKE_CHANNELS, ...EVENT_CHANNELS]) {
      expect(c === 'toast' || /^[a-z][A-Za-z]*:[a-z][A-Za-z]*$/.test(c), c).toBe(true)
    }
  })
})
