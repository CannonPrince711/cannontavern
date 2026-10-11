import { describe, expect, it } from 'vitest'
import {
  SettingsPatchSchema,
  SettingsSchema,
  TextBackendInputSchema,
  defaultSettings
} from '@shared/settings'
import { PROMPT_BLOCK_IDS } from '@shared/types'

describe('settings schema', () => {
  it('fills every section from an empty object', () => {
    const s = defaultSettings()
    expect(s.vault.rootFolder).toBe('DND Tavern')
    expect(s.appearance.theme).toBe('dark')
    expect(s.appearance.uiScale).toBe(1)
    expect(s.behavior.autoUpdateCheck).toBe(false)
    expect(s.prompt.blocks.map((b) => b.id)).toEqual([...PROMPT_BLOCK_IDS])
    expect(s.textBackends).toEqual([])
  })

  it('keeps unknown-but-valid user values and fills missing nested defaults', () => {
    const s = SettingsSchema.parse({ appearance: { theme: 'parchment' }, vault: { path: 'C:\\Vault' } })
    expect(s.appearance.theme).toBe('parchment')
    expect(s.appearance.chatFontSize).toBe(17)
    expect(s.vault.path).toBe('C:\\Vault')
    expect(s.vault.rootFolder).toBe('DND Tavern')
  })

  it('rejects out-of-range values', () => {
    expect(SettingsSchema.safeParse({ appearance: { uiScale: 2 } }).success).toBe(false)
    expect(SettingsSchema.safeParse({ appearance: { accent: 'gold' } }).success).toBe(false)
  })

  it('fills backend defaults, including secrets', () => {
    const b = TextBackendInputSchema.parse({ id: 'a', name: 'OpenRouter', type: 'openai' })
    expect(b.apiKey).toEqual({ kind: 'none' })
    expect(b.generation.stream).toBe(true)
    expect(b.generation.topK).toBeNull()
    expect(b.network.allowSelfSigned).toBe(false)
    expect(b.custom.streamParser).toBe('none')
  })
})

describe('settings patch schema', () => {
  it('does not add defaults for keys the patch leaves out', () => {
    const patch = SettingsPatchSchema.parse({ appearance: { theme: 'contrast' } })
    expect(patch).toEqual({ appearance: { theme: 'contrast' } })
  })

  it('rejects keys that are not patchable', () => {
    expect(SettingsPatchSchema.safeParse({ textBackends: [] }).success).toBe(false)
    expect(SettingsPatchSchema.safeParse({ appearance: { bogus: 1 } }).success).toBe(false)
  })

  it('validates patched values', () => {
    expect(SettingsPatchSchema.safeParse({ appearance: { theme: 'neon' } }).success).toBe(false)
    expect(SettingsPatchSchema.safeParse({ appearance: { uiScale: 1.2 } }).success).toBe(true)
  })
})
