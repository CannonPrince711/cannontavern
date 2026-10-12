import { describe, expect, it } from 'vitest'
import { TextBackendSchema } from '../src/shared/settings'
import { withModel } from '../src/main/backends/chain'
import { parseNote } from '../src/main/vault/frontmatter'
import { worldFromFrontmatter } from '../src/shared/world'

const backend = (id: string, model: string) =>
  TextBackendSchema.parse({ id, name: id, type: 'openai', baseUrl: 'http://127.0.0.1:8080/v1', model })

/** A campaign's overrides, read from its Campaign.md text. */
const worldOfNote = (lines: string[]) => worldFromFrontmatter(parseNote(lines.join('\n')).data)

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

  it('reads image_models and text_models from Campaign.md into the world overrides', () => {
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
    ]
    expect(worldOfNote(note)).toEqual({ text_model: 'Gemsicle-31B-Q4_K_M.gguf', images: { portrait: { model: 'FLUX1/flux1-dev-fp8.safetensors' } } })
  })

  it('lets the world block win over the older keys', () => {
    const note = ['---', 'image_models:', '  portrait: old', 'text_models:', '  summary: old-sum', 'world:', '  images:', '    portrait:', '      model: new', '  summary_model: new-sum', '---', '']
    expect(worldOfNote(note)).toEqual({ summary_model: 'new-sum', images: { portrait: { model: 'new' } } })
  })

  it('returns nothing when the campaign has no overrides', () => {
    expect(worldOfNote(['---', 'type: campaign', '---', ''])).toBeUndefined()
    expect(worldOfNote(['No frontmatter.'])).toBeUndefined()
  })
})
