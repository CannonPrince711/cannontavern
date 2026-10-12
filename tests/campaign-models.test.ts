import { describe, expect, it } from 'vitest'
import { TextBackendSchema } from '../src/shared/settings'
import { withModel } from '../src/main/backends/chain'
import { readCampaignModelMap } from '../src/main/library'

const backend = (id: string, model: string) =>
  TextBackendSchema.parse({ id, name: id, type: 'openai', baseUrl: 'http://127.0.0.1:8080/v1', model })

/** A vault whose only file is the campaign note. */
const vaultWith = (content: string | null) =>
  ({ readIfExists: async () => (content === null ? null : { content }) }) as unknown as Parameters<typeof readCampaignModelMap>[0]

describe('campaign models', () => {
  it('swaps the model into the first backend and keeps the fallbacks as they are', () => {
    const chain = [backend('llama', 'global-31b'), backend('kobold', 'kobold-model')]
    const out = withModel(chain, 'campaign-14b')
    expect(out.map((b) => b.model)).toEqual(['campaign-14b', 'kobold-model'])
    expect(out[0]!.id).toBe('llama')
    expect(chain[0]!.model).toBe('global-31b')
  })

  it('leaves the chain alone when the campaign names no model', () => {
    const chain = [backend('llama', 'global-31b')]
    expect(withModel(chain, undefined)).toBe(chain)
    expect(withModel(chain, '')).toBe(chain)
    expect(withModel([], 'anything')).toEqual([])
  })

  it('reads image and text model overrides from Campaign.md', async () => {
    const note = [
      '---',
      'type: campaign',
      'image_models:',
      '  portrait: FLUX1/flux1-dev-fp8.safetensors',
      'text_models:',
      '  chat: Gemsicle-31B-Q4_K_M.gguf',
      '  summary: ',
      '---',
      'Body.',
      ''
    ].join('\n')
    const vault = vaultWith(note)
    expect(await readCampaignModelMap(vault, 'Campaigns/X' as never, 'image_models')).toEqual({ portrait: 'FLUX1/flux1-dev-fp8.safetensors' })
    expect(await readCampaignModelMap(vault, 'Campaigns/X' as never, 'text_models')).toEqual({ chat: 'Gemsicle-31B-Q4_K_M.gguf' })
  })

  it('returns nothing when the campaign has no note or no overrides', async () => {
    expect(await readCampaignModelMap(vaultWith(null), 'Campaigns/X' as never, 'text_models')).toEqual({})
    expect(await readCampaignModelMap(vaultWith('---\ntype: campaign\n---\n'), 'Campaigns/X' as never, 'image_models')).toEqual({})
  })
})
