import { describe, expect, it } from 'vitest'
import { mask, redact, registerSecret } from '../src/main/redact'

describe('redact', () => {
  it('masks registered secrets wherever they appear', () => {
    registerSecret('super-secret-token-123')
    const out = redact('401 from https://x.test?key=super-secret-token-123 (super-secret-token-123)')
    expect(out).not.toContain('super-secret-token-123')
    expect(out).toContain(mask('super-secret-token-123'))
  })

  it('masks bearer tokens and sk- keys it was never told about', () => {
    const out = redact('Authorization: Bearer abcdefghijklmnop sk-proj-abcdefghijklmnop')
    expect(out).toBe('Authorization: Bearer •••• sk-••••')
  })

  it('ignores very short values so it does not mangle ordinary text', () => {
    registerSecret('ab')
    expect(redact('about')).toBe('about')
  })
})
