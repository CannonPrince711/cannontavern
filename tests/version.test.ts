import { describe, expect, it } from 'vitest'
import { isNewer } from '../src/shared/version'

describe('isNewer', () => {
  it('compares numerically, not as strings', () => {
    expect(isNewer('v1.2.10', '1.2.9')).toBe(true)
    expect(isNewer('1.2.9', '1.2.10')).toBe(false)
  })
  it('treats equal and missing parts as the same version', () => {
    expect(isNewer('v0.1.0', '0.1.0')).toBe(false)
    expect(isNewer('0.1', '0.1.0')).toBe(false)
    expect(isNewer('0.2', '0.1.9')).toBe(true)
  })
  it('ignores pre-release and build suffixes', () => {
    expect(isNewer('0.2.0-beta.1', '0.1.0')).toBe(true)
    expect(isNewer('0.1.0+build5', '0.1.0')).toBe(false)
  })
})
