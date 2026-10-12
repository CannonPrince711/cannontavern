import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocketServer } from 'ws'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ImageBackendSchema, ComfyWorkflowSchema } from '@shared/settings'
import { applyMapping, builtinWorkflow, comfyAdapter, comfySampler, guessMapping, parseWorkflow, previewOutputs, summarizeWorkflow, type ApiWorkflow } from '../src/main/backends/image/comfy'
import { solidPng } from '../src/main/import/png'
import type { ResolvedImageBackend } from '../src/main/backends/image/types'

/** A typical SDXL-style API workflow. */
const WORKFLOW: ApiWorkflow = {
  '3': {
    class_type: 'KSampler',
    inputs: { seed: 1, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['10', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] }
  },
  '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'base.safetensors' } },
  '5': { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: 'positive here', clip: ['10', 1] }, _meta: { title: 'Positive' } },
  '7': { class_type: 'CLIPTextEncode', inputs: { text: 'negative here', clip: ['10', 1] } },
  '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
  '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'tavern', images: ['8', 0] } },
  '10': { class_type: 'LoraLoader', inputs: { lora_name: 'none.safetensors', strength_model: 1, strength_clip: 1, model: ['4', 0], clip: ['4', 1] } },
  '11': { class_type: 'LoadImage', inputs: { image: 'example.png' } }
}

describe('ComfyUI workflows', () => {
  it('accepts API format and explains UI format', () => {
    expect(parseWorkflow(WORKFLOW)).toBe(WORKFLOW)
    expect(() => parseWorkflow({ nodes: [], links: [] })).toThrow(/Save \(API Format\)/)
    expect(() => parseWorkflow({ a: { inputs: {} } })).toThrow(/class_type/)
    expect(() => parseWorkflow([])).toThrow()
  })

  it('lists nodes with only their literal inputs', () => {
    const s = summarizeWorkflow(WORKFLOW)
    expect(s.map((n) => n.id)).toEqual(['3', '4', '5', '6', '7', '8', '9', '10', '11'])
    expect(s.find((n) => n.id === '3')!.inputs.map((i) => i.name)).toEqual(['seed', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise'])
    expect(s.find((n) => n.id === '6')!.title).toBe('Positive')
  })

  it('guesses the mapping by following the sampler’s links', () => {
    expect(guessMapping(WORKFLOW)).toEqual({
      positive: { nodeId: '6', input: 'text' },
      negative: { nodeId: '7', input: 'text' },
      seed: { nodeId: '3', input: 'seed' },
      width: { nodeId: '5', input: 'width' },
      height: { nodeId: '5', input: 'height' },
      steps: { nodeId: '3', input: 'steps' },
      cfg: { nodeId: '3', input: 'cfg' },
      checkpoint: { nodeId: '4', input: 'ckpt_name' },
      lora: { nodeId: '10', input: 'lora_name' },
      loraStrength: { nodeId: '10', input: 'strength_model' },
      sourceImage: { nodeId: '11', input: 'image' }
    })
  })

  it('applies values through the mapping without touching the original', () => {
    const out = applyMapping(WORKFLOW, guessMapping(WORKFLOW), { positive: 'a lantern', seed: 42, width: 832, height: 1216, checkpoint: '', lora: undefined })
    expect(out['6']!.inputs.text).toBe('a lantern')
    expect(out['3']!.inputs.seed).toBe(42)
    expect(out['5']!.inputs).toMatchObject({ width: 832, height: 1216 })
    expect(out['4']!.inputs.ckpt_name).toBe('base.safetensors') // empty values are skipped
    expect(WORKFLOW['6']!.inputs.text).toBe('positive here')
  })

  it('reports mappings that point at missing nodes', () => {
    expect(() => applyMapping(WORKFLOW, { ...guessMapping(WORKFLOW), positive: { nodeId: '99', input: 'text' } }, { positive: 'x' })).toThrow(/node 99/)
  })
})

describe('ComfyUI generation against a mock server', () => {
  let server: Server
  let wss: WebSocketServer
  let base: string
  const queued: { prompt: ApiWorkflow; client_id: string }[] = []
  let uploads = 0
  const png = solidPng(8, 8, [200, 100, 50])

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        const url = new URL(req.url!, 'http://x')
        if (url.pathname === '/prompt') {
          const body = JSON.parse(Buffer.concat(chunks).toString())
          queued.push(body)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ prompt_id: 'p1', number: 1 }))
          // Report progress over the socket, then completion.
          setTimeout(() => {
            for (const ws of wss.clients) {
              ws.send(JSON.stringify({ type: 'progress', data: { value: 5, max: 10, prompt_id: 'p1' } }))
              ws.send(JSON.stringify({ type: 'executing', data: { node: null, prompt_id: 'p1' } }))
            }
          }, 30)
        } else if (url.pathname === '/history/p1') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ p1: { status: { status_str: 'success', completed: true }, outputs: { '9': { images: [{ filename: 'tavern_0001.png', subfolder: '', type: 'output' }] } } } }))
        } else if (url.pathname === '/view') {
          expect(url.searchParams.get('filename')).toBe('tavern_0001.png')
          res.writeHead(200, { 'Content-Type': 'image/png' })
          res.end(png)
        } else if (url.pathname === '/object_info/CheckpointLoaderSimple') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ CheckpointLoaderSimple: { input: { required: { ckpt_name: [['sdxl_base.safetensors', 'fantasyMap.safetensors']] } } } }))
        } else if (url.pathname === '/upload/image') {
          uploads++
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ name: 'avatar.png', subfolder: '', type: 'input' }))
        } else {
          res.writeHead(404)
          res.end()
        }
      })
    })
    wss = new WebSocketServer({ server, path: '/ws' })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    wss.close()
    await new Promise<void>((r) => server.close(() => r()))
  })

  it('queues the mapped workflow, follows progress and downloads the image', async () => {
    const wf = ComfyWorkflowSchema.parse({ id: 'w1', name: 'Portrait', file: 'w.json', mapping: guessMapping(WORKFLOW), checkpoint: 'dream.safetensors' })
    const b = ImageBackendSchema.parse({ id: 'c', name: 'Comfy', type: 'comfyui', baseUrl: base, comfy: { workflows: [wf], defaultWorkflowId: 'w1' } })
    const resolved: ResolvedImageBackend = { ...b, key: '', net: { headers: {}, proxy: '', allowSelfSigned: false, timeoutMs: 10_000, retries: 0 } }
    const progress: number[] = []
    const adapter = comfyAdapter({ loadWorkflow: async () => WORKFLOW })
    const result = await adapter.generate(
      resolved,
      { prompt: 'a lantern', negative: 'blurry', width: 832, height: 1216, steps: 25, cfg: 6, sampler: 'euler', seed: 7, source: { data: png, filename: 'avatar.png' } },
      { onProgress: (v) => progress.push(v) }
    )
    expect(result.data.equals(png)).toBe(true)
    expect(result.ext).toBe('png')
    expect(result.seed).toBe(7)
    expect(progress).toContain(0.5)
    expect(uploads).toBe(1)
    const sent = queued[0]!
    expect(sent.client_id).toMatch(/[0-9a-f-]{36}/)
    expect(sent.prompt['6']!.inputs.text).toBe('a lantern')
    expect(sent.prompt['7']!.inputs.text).toBe('blurry')
    expect(sent.prompt['3']!.inputs).toMatchObject({ seed: 7, steps: 25, cfg: 6 })
    expect(sent.prompt['5']!.inputs).toMatchObject({ width: 832, height: 1216 })
    expect(sent.prompt['4']!.inputs.ckpt_name).toBe('dream.safetensors')
    expect(sent.prompt['11']!.inputs.image).toBe('avatar.png')
  })

  const net = { headers: {}, proxy: '', allowSelfSigned: false, timeoutMs: 5000, retries: 0 }

  it('uses a built-in text-to-image workflow when none is imported', async () => {
    const b = ImageBackendSchema.parse({ id: 'c', name: 'Comfy', type: 'comfyui', baseUrl: base })
    const adapter = comfyAdapter({ loadWorkflow: async () => WORKFLOW })
    const r = await adapter.generate({ ...b, key: '', net }, { prompt: 'a misty harbour', negative: 'text', width: 1344, height: 768, steps: 30, cfg: 5, sampler: 'DPM++ 2M Karras', seed: 3 }, {})
    expect(r.data.equals(png)).toBe(true)
    const sent = queued.at(-1)!.prompt
    expect(sent['4']!.inputs.ckpt_name).toBe('sdxl_base.safetensors') // the server's first checkpoint
    expect(sent['6']!.inputs.text).toBe('a misty harbour')
    expect(sent['7']!.inputs.text).toBe('text')
    expect(sent['5']!.inputs).toMatchObject({ width: 1344, height: 768 })
    expect(sent['3']!.inputs).toMatchObject({ seed: 3, steps: 30, cfg: 5, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: 1 })
    expect(sent['9']!.class_type).toBe('SaveImage')
  })

  it('paints over a source image with the built-in img2img workflow and the chosen checkpoint', async () => {
    const b = ImageBackendSchema.parse({ id: 'c', name: 'Comfy', type: 'comfyui', baseUrl: base, comfy: { checkpoint: 'fantasyMap.safetensors' } })
    const adapter = comfyAdapter({ loadWorkflow: async () => WORKFLOW })
    await adapter.generate({ ...b, key: '', net }, { prompt: 'a map', negative: '', width: 1216, height: 688, steps: 20, cfg: 6, sampler: 'euler', seed: 1, source: { data: png, filename: 'sketch.png' } }, {})
    const sent = queued.at(-1)!.prompt
    expect(sent['4']!.inputs.ckpt_name).toBe('fantasyMap.safetensors')
    expect(sent['10']!.inputs.image).toBe('avatar.png') // the uploaded file's name, from the fake server
    expect(sent['12']!.inputs).toMatchObject({ width: 1216, height: 688 })
    expect(sent['3']!.inputs).toMatchObject({ denoise: 0.55, latent_image: ['11', 0] })
    expect(sent['5']).toBeUndefined()
  })

  it('maps Automatic1111 sampler names', () => {
    expect(comfySampler('Euler a')).toEqual({ name: 'euler_ancestral', scheduler: 'normal' })
    expect(comfySampler('DPM++ SDE Karras')).toEqual({ name: 'dpmpp_sde', scheduler: 'karras' })
    expect(comfySampler('')).toEqual({ name: 'euler', scheduler: 'normal' })
    expect(builtinWorkflow(false).mapping.sourceImage).toBeNull()
  })

})

describe('example workflows in docs/comfyui', () => {
  it('map fully when imported, including the sketch version’s resize', async () => {
    const { readFileSync } = await import('node:fs')
    const map = parseWorkflow(JSON.parse(readFileSync('docs/comfyui/sdxl-lora-map.json', 'utf8')))
    expect(guessMapping(map)).toMatchObject({ positive: { nodeId: '6' }, negative: { nodeId: '7' }, width: { nodeId: '5' }, checkpoint: { nodeId: '4' }, lora: { nodeId: '10', input: 'lora_name' }, loraStrength: { nodeId: '10' } })
    const sketch = guessMapping(parseWorkflow(JSON.parse(readFileSync('docs/comfyui/sdxl-lora-map-sketch.json', 'utf8'))))
    expect(sketch).toMatchObject({ sourceImage: { nodeId: '11', input: 'image' }, width: { nodeId: '12', input: 'width' }, height: { nodeId: '12', input: 'height' } })
  })
})

describe('keeping images off the server', () => {
  it('turns SaveImage nodes into PreviewImage and leaves the rest alone', () => {
    const { api } = builtinWorkflow(false)
    const out = previewOutputs(api)
    const saves = Object.values(api).filter((n) => n.class_type === 'SaveImage')
    expect(saves.length).toBeGreaterThan(0)
    for (const [id, node] of Object.entries(api)) {
      if (node.class_type === 'SaveImage') expect(out[id]).toEqual({ ...node, class_type: 'PreviewImage', inputs: { images: node.inputs.images } })
      else expect(out[id]).toBe(node)
    }
    // The original graph is untouched.
    expect(Object.values(api).some((n) => n.class_type === 'SaveImage')).toBe(true)
  })
})
