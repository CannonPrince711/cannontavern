import { describe, expect, it } from 'vitest'
import { keepMissingKeys, TextBackendInputSchema } from '../src/shared/settings'

describe('opening a settings file saved without keys', () => {
  it('keeps this PC’s key and secret headers instead of clearing them', () => {
    const b = keepMissingKeys({ id: 'llama', apiKey: { kind: 'none' }, network: { headers: [{ name: 'X-Token', value: { kind: 'none' } }, { name: 'X-Plain', value: { kind: 'plain', value: 'a' } }] } }) as {
      apiKey: unknown
      network: { headers: { value: unknown }[] }
    }
    expect(b.apiKey).toEqual({ kind: 'keep' })
    expect(b.network.headers.map((h) => h.value)).toEqual([{ kind: 'keep' }, { kind: 'plain', value: 'a' }])
  })

  it('leaves keys the file does carry alone, and passes odd input through', () => {
    expect(keepMissingKeys({ apiKey: { kind: 'env', name: 'KEY' } })).toEqual({ apiKey: { kind: 'env', name: 'KEY' } })
    expect(keepMissingKeys(null)).toBeNull()
  })

  it('reads "keep" as a valid key in a saved backend', () => {
    const r = TextBackendInputSchema.safeParse({ id: 'a', name: 'A', type: 'openai', baseUrl: 'http://127.0.0.1:8080/v1', model: 'm', apiKey: { kind: 'keep' } })
    expect(r.success).toBe(true)
  })
})
