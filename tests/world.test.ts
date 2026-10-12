import { describe, expect, it } from 'vitest'
import { ImageBackendSchema, SettingsSchema, TextBackendSchema } from '../src/shared/settings'
import { DEFAULT_DM_PROMPT } from '../src/shared/prompt'
import { applyWorld, compactWorld, parseWorld, validateSuggestion, withWorldInstructions, worldGroups } from '../src/shared/world'

const text = (id: string, model: string) => TextBackendSchema.parse({ id, name: id, type: 'openai', baseUrl: 'http://127.0.0.1:8080/v1', model, generation: { temperature: 0.9 } })
const image = (id: string) => ImageBackendSchema.parse({ id, name: id, type: 'comfyui', baseUrl: 'http://127.0.0.1:8188' })

const settings = () =>
  SettingsSchema.parse({
    textBackends: [text('gemma', 'gemsicle'), text('claude', 'opus')],
    defaultTextBackendId: 'gemma',
    imageBackends: [image('pod'), image('local')],
    defaultImageBackendId: 'pod',
    imageProfiles: { portrait: { model: 'sdxl_base', style: 'portrait' } },
    imageTriggers: { autoPortraits: false, everyNDmTurns: 4 },
    general: { defaultPreset: 'Presets/Grim.md' },
    prompt: { playerPrompt: 'global player' }
  })

describe('world overrides', () => {
  it('reads the world block leniently, dropping only the bad values', () => {
    const w = parseWorld({
      text_model: 'opus',
      temperature: 'hot',
      auto_portraits: true,
      images: { portrait: { model: 'wai', width: 1024, steps: 'many' }, nonsense: { model: 'x' } }
    })
    expect(w).toEqual({ text_model: 'opus', auto_portraits: true, images: { portrait: { model: 'wai', width: 1024 } } })
    expect(parseWorld('not an object')).toEqual({})
    expect(parseWorld(null)).toEqual({})
  })

  it('compacts away empty image entries and undefined fields', () => {
    expect(compactWorld({ images: { portrait: {}, scene: { model: undefined } } })).toBeUndefined()
    expect(compactWorld({ text_model: undefined, auto_portraits: false })).toEqual({ auto_portraits: false })
  })

  it('leaves the global settings untouched when a world overrides nothing', () => {
    const s = settings()
    expect(applyWorld(s, undefined)).toBe(s)
    expect(applyWorld(s, {})).toBe(s)
  })

  it('applies text, prompt, image and trigger overrides without changing the global settings', () => {
    const s = settings()
    const w = applyWorld(s, {
      text_backend: 'claude',
      text_model: 'sonnet',
      temperature: 0.4,
      preset: '',
      player_prompt: 'world player',
      images: { portrait: { model: 'wai', width: 1024, height: 1024, style: 'anime' }, map: { backend: 'local' } },
      auto_portraits: true,
      scene_every: 0
    })
    expect(w.roles.chat).toBe('claude')
    expect(w.textBackends.find((b) => b.id === 'claude')).toMatchObject({ model: 'sonnet', generation: { temperature: 0.4 } })
    expect(w.textBackends.find((b) => b.id === 'gemma')?.model).toBe('gemsicle')
    expect(w.general.defaultPreset).toBeNull()
    expect(w.prompt.playerPrompt).toBe('world player')
    expect(w.imageProfiles.portrait).toMatchObject({ model: 'wai', width: 1024, height: 1024, style: 'anime' })
    expect(w.imageProfiles.map.backendId).toBe('local')
    expect(w.imageTriggers).toMatchObject({ autoPortraits: true, everyNDmTurns: 0 })
    // The global settings are a separate object.
    expect(s.roles.chat).toBeNull()
    expect(s.imageProfiles.portrait.model).toBe('sdxl_base')
  })

  it('changes the model of whichever backend plays the DM when no backend is chosen', () => {
    const w = applyWorld(settings(), { text_model: 'gemma-27b', temperature: 1.1 })
    expect(w.textBackends.find((b) => b.id === 'gemma')).toMatchObject({ model: 'gemma-27b', generation: { temperature: 1.1 } })
  })

  it('ignores backends that no longer exist', () => {
    const w = applyWorld(settings(), { text_backend: 'deleted', images: { scene: { backend: 'deleted', model: 'x' } } })
    expect(w.roles.chat).toBeNull()
    expect(w.imageProfiles.scene).toMatchObject({ backendId: null, model: 'x' })
  })

  it('names the overridden groups', () => {
    expect(worldGroups({ temperature: 1, images: { portrait: { model: 'a' } }, scene_every: 2 })).toEqual(['text', 'images', 'triggers'])
    expect(worldGroups(undefined)).toEqual([])
  })

  it('adds world instructions to the preset, or to the built-in DM prompt', () => {
    expect(withWorldInstructions(null, '  ')).toBeNull()
    const own = withWorldInstructions({ name: 'Grim', system_prompt: 'Be grim.', dm_mode: true }, 'No dragons.')
    expect(own?.system_prompt).toBe('Be grim.\n\nInstructions for this world:\nNo dragons.')
    expect(withWorldInstructions(null, 'No dragons.')?.system_prompt.startsWith(DEFAULT_DM_PROMPT)).toBe(true)
  })
})

describe('picking generators for a world', () => {
  const images = [
    { id: 'pod', name: 'ComfyUI', type: 'comfyui', models: ['Illustrious/wai.safetensors', 'SDXL/juggernaut.safetensors', 'FLUX1/flux1-dev-fp8.safetensors'], workflows: [{ id: 'wf-map', name: 'Flux battle map', purpose: 'battlemap' }] }
  ]
  const texts = [{ id: 'gemma', name: 'Gemsicle', models: ['gemsicle', 'other'], current: 'gemsicle' }]

  it('keeps only installed backends, models and workflows', () => {
    const w = validateSuggestion(
      {
        text: { backend: 'Gemsicle', model: 'GEMSICLE' },
        images: {
          portrait: { backend: 'pod', model: 'illustrious/wai.safetensors', style: 'masterpiece, best quality' },
          scene: { backend: 'missing', model: 'x' },
          map: { backend: 'pod', model: 'not installed' },
          battlemap: { backend: 'pod', model: 'FLUX1/flux1-dev-fp8.safetensors', workflow: 'Flux battle map' }
        }
      },
      images,
      texts
    )
    // The current model is kept rather than "changed" to itself.
    expect(w.text_backend).toBe('gemma')
    expect(w.text_model).toBeUndefined()
    expect(w.images?.portrait).toEqual({ backend: 'pod', model: 'Illustrious/wai.safetensors', style: 'masterpiece, best quality' })
    expect(w.images?.scene).toBeUndefined()
    expect(w.images?.map).toEqual({ backend: 'pod' })
    expect(w.images?.battlemap).toEqual({ backend: 'pod', model: 'FLUX1/flux1-dev-fp8.safetensors', workflow: 'wf-map' })
  })

  it('refuses a FLUX model on the built-in graph', () => {
    const w = validateSuggestion({ images: { scene: { backend: 'pod', model: 'FLUX1/flux1-dev-fp8.safetensors' } } }, images, texts)
    expect(w.images?.scene).toEqual({ backend: 'pod' })
  })

  it('survives a reply that is not an object', () => {
    expect(validateSuggestion(null, images, texts)).toEqual({})
    expect(validateSuggestion('nope', images, texts)).toEqual({})
  })
})
