import { describe, expect, it } from 'vitest'
import { shouldCompress } from '../src/shared/prompt'

describe('auto-compress trigger', () => {
  it('fires once the prompt reaches the threshold', () => {
    expect(shouldCompress({ totalTokens: 12_000, droppedMessages: 0 }, 16_384, 80)).toBe(false)
    expect(shouldCompress({ totalTokens: 13_200, droppedMessages: 0 }, 16_384, 80)).toBe(true)
  })

  it('fires when older messages are already being cut, even under the threshold', () => {
    expect(shouldCompress({ totalTokens: 4_000, droppedMessages: 3 }, 16_384, 80)).toBe(true)
  })

  it('never fires when turned off or without a budget', () => {
    expect(shouldCompress({ totalTokens: 99_999, droppedMessages: 9 }, 16_384, 0)).toBe(false)
    expect(shouldCompress({ totalTokens: 99_999, droppedMessages: 9 }, 0, 80)).toBe(false)
  })
})
