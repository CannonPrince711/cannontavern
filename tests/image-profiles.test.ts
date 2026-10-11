import { describe, expect, it } from 'vitest'
import { ImageBackendSchema, ImageProfileSchema, SettingsSchema } from '../src/shared/settings'
import { applyImageProfile, backendFor, workflowFor } from '../src/main/backends/image/profile'
import { imageSize, sizeLike } from '../src/main/backends/image/size'

const backend = (id: string, type: 'a1111' | 'comfyui' | 'openai', extra: Record<string, unknown> = {}) =>
  ImageBackendSchema.parse({ id, name: id, type, baseUrl: 'http://127.0.0.1:7860', defaults: { width: 832, height: 1216, steps: 28, negativePrompt: 'lowres' }, ...extra })

const forge = backend('forge', 'a1111', { a1111: { model: 'dreamshaper_8' } })
const comfy = backend('comfy', 'comfyui', {
  comfy: {
    workflows: [
      { id: 'wf-scene', name: 'Scene', purpose: 'scene', file: 'a.json', checkpoint: 'sdxl_base' },
      { id: 'wf-map', name: 'Map', purpose: 'map', file: 'b.json' }
    ],
    defaultWorkflowId: 'wf-scene'
  }
})
const settings = (profiles: Record<string, unknown> = {}) =>
  SettingsSchema.parse({ imageBackends: [forge, comfy], defaultImageBackendId: 'forge', imageProfiles: profiles })

describe('image generation options', () => {
  it('picks the backend: an explicit one, then the purpose’s, then the default', () => {
    const s = settings({ map: { backendId: 'comfy' } })
    expect(backendFor(s, 'map')?.id).toBe('comfy')
    expect(backendFor(s, 'portrait')?.id).toBe('forge')
    expect(backendFor(s, 'map', 'forge')?.id).toBe('forge')
    // A deleted backend falls back to the default.
    expect(backendFor(settings({ map: { backendId: 'gone' } }), 'map')?.id).toBe('forge')
  })

  it('picks the ComfyUI workflow: the purpose’s choice, then one tagged for it, then the default', () => {
    const none = ImageProfileSchema.parse({})
    expect(workflowFor(comfy, 'map', none)).toBe('wf-map')
    expect(workflowFor(comfy, 'portrait', none)).toBe('wf-scene')
    expect(workflowFor(comfy, 'map', ImageProfileSchema.parse({ workflowId: 'wf-scene' }))).toBe('wf-scene')
    expect(workflowFor(forge, 'map', none)).toBeUndefined()
  })

  it('leaves the backend alone when nothing is set, with sizes shaped for the purpose', () => {
    const none = ImageProfileSchema.parse({})
    const scene = applyImageProfile(forge, 'scene', none, undefined)
    expect(scene.backend).toBe(forge)
    expect(scene.over).toEqual({ width: 1216, height: 832 })
    expect(applyImageProfile(forge, 'portrait', none, undefined).over).toEqual({ width: 832, height: 1216 })
    expect(applyImageProfile(forge, 'map', none, undefined).over).toEqual({ width: 1216, height: 912 })
    expect(applyImageProfile(forge, 'other', none, undefined).over).toEqual({})
  })

  it('swaps in the model for each backend type without touching the saved backend', () => {
    const p = ImageProfileSchema.parse({ model: 'cartographer_v2' })
    expect(applyImageProfile(forge, 'map', p, undefined).backend.a1111.model).toBe('cartographer_v2')
    expect(forge.a1111.model).toBe('dreamshaper_8')
    const c = applyImageProfile(comfy, 'map', p, 'wf-map').backend
    expect(c.comfy.workflows.find((w) => w.id === 'wf-map')!.checkpoint).toBe('cartographer_v2')
    expect(c.comfy.workflows.find((w) => w.id === 'wf-scene')!.checkpoint).toBe('sdxl_base')
    expect(applyImageProfile(backend('oai', 'openai'), 'portrait', ImageProfileSchema.parse({ model: 'dall-e-3' }), undefined).backend.openai.model).toBe('dall-e-3')
  })

  it('applies size, steps, style and negative prompt', () => {
    const p = ImageProfileSchema.parse({ width: 1024, height: 768, steps: 40, style: 'parchment map', negative: 'text, labels' })
    const r = applyImageProfile(forge, 'map', p, undefined)
    expect(r.over).toEqual({ width: 1024, height: 768, steps: 40, negative: 'lowres, text, labels' })
    expect(r.style).toBe('parchment map')
  })
})

describe('battlemaps and sketches', () => {
  it('sizes battlemaps as landscape by default', () => {
    expect(applyImageProfile(forge, 'battlemap', ImageProfileSchema.parse({}), undefined).over).toEqual({ width: 1216, height: 832 })
  })

  it('reads image sizes from PNG, JPEG, GIF and WebP headers', () => {
    const png = Buffer.alloc(24)
    png.writeUInt32BE(0x89504e47, 0)
    png.writeUInt32BE(1600, 16)
    png.writeUInt32BE(900, 20)
    expect(imageSize(png)).toEqual({ width: 1600, height: 900 })
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(imageSize(jpeg)).toEqual({ width: 800, height: 600 })
    const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.from([0x40, 0x01, 0xf0, 0x00]), Buffer.alloc(14)])
    expect(imageSize(gif)).toEqual({ width: 320, height: 240 })
    const webp = Buffer.alloc(30)
    webp.write('RIFF', 0, 'latin1')
    webp.write('WEBPVP8X', 8, 'latin1')
    webp.writeUIntLE(1023, 24, 3)
    webp.writeUIntLE(767, 27, 3)
    expect(imageSize(webp)).toEqual({ width: 1024, height: 768 })
    expect(imageSize(Buffer.from('not an image at all, really'))).toBeNull()
  })

  it('keeps a sketch’s proportions at the backend’s size', () => {
    expect(sizeLike({ width: 1600, height: 900 }, 1216)).toEqual({ width: 1216, height: 688 })
    expect(sizeLike({ width: 600, height: 800 }, 1216)).toEqual({ width: 912, height: 1216 })
  })
})
