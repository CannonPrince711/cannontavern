/**
 * ComfyUI: API-format workflows, node mapping, websocket progress (falling
 * back to polling /history), result download via /view, img2img via
 * /upload/image.
 */
import { randomUUID } from 'node:crypto'
import { Blob } from 'node:buffer'
import { FormData, WebSocket } from 'undici'
import type { ComfyNodeSummary } from '@shared/ipc'
import type { ComfyMapping, ComfyWorkflow, NodeInput } from '@shared/settings'
import { AppError } from '../../errors'
import { getDispatcher, readJson, request } from '../../http'
import { randomSeed, sniffExt, type ImageAdapter, type ImageRequest, type ResolvedImageBackend } from './types'

export type ApiWorkflow = Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } }>

/** Validates an API-format workflow (and explains the common UI-format mistake). */
export function parseWorkflow(json: unknown): ApiWorkflow {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new AppError('COMFY_WORKFLOW', 'The workflow file is not a JSON object.')
  const obj = json as Record<string, unknown>
  if (Array.isArray(obj.nodes) && Array.isArray(obj.links)) {
    throw new AppError(
      'COMFY_UI_FORMAT',
      'This is a ComfyUI “UI” workflow. In ComfyUI, enable Dev mode in the settings and use “Save (API Format)”, then import that file.'
    )
  }
  const nodes = Object.entries(obj)
  if (!nodes.length || !nodes.every(([, n]) => n && typeof n === 'object' && typeof (n as { class_type?: unknown }).class_type === 'string')) {
    throw new AppError('COMFY_WORKFLOW', 'This does not look like a ComfyUI API-format workflow (each node needs a class_type).')
  }
  return obj as ApiWorkflow
}

/** Nodes with their literal (non-link) inputs, for the mapping UI. */
export function summarizeWorkflow(wf: ApiWorkflow): ComfyNodeSummary[] {
  return Object.entries(wf)
    .map(([id, n]) => ({
      id,
      classType: n.class_type,
      title: n._meta?.title,
      inputs: Object.entries(n.inputs ?? {})
        .filter(([, v]) => !Array.isArray(v))
        .map(([name, value]) => ({ name, value }))
    }))
    .sort((a, b) => Number(a.id) - Number(b.id) || a.id.localeCompare(b.id))
}

const link = (v: unknown): string | null => (Array.isArray(v) && typeof v[0] === 'string' ? v[0] : Array.isArray(v) && typeof v[0] === 'number' ? String(v[0]) : null)

/**
 * Guesses the mapping from common node types: the sampler's positive and
 * negative conditioning, its seed/steps/cfg, the latent size, the checkpoint,
 * a LoRA and a LoadImage node.
 */
export function guessMapping(wf: ApiWorkflow): ComfyMapping {
  const m: ComfyMapping = {
    positive: null, negative: null, seed: null, width: null, height: null, steps: null, cfg: null,
    checkpoint: null, lora: null, loraStrength: null, sourceImage: null
  }
  const entries = Object.entries(wf)
  const find = (pred: (t: string) => boolean): [string, ApiWorkflow[string]] | undefined => entries.find(([, n]) => pred(n.class_type))
  const has = (id: string, input: string): NodeInput | null => (wf[id] && input in wf[id]!.inputs && !Array.isArray(wf[id]!.inputs[input]) ? { nodeId: id, input } : null)

  const sampler = find((t) => /KSampler/i.test(t))
  if (sampler) {
    const [sid, s] = sampler
    m.seed = has(sid, 'seed') ?? has(sid, 'noise_seed')
    m.steps = has(sid, 'steps')
    m.cfg = has(sid, 'cfg')
    const textInput = (id: string | null): NodeInput | null => {
      if (!id || !wf[id]) return null
      for (const key of ['text', 'text_g', 'prompt', 'string']) if (has(id, key)) return { nodeId: id, input: key }
      return null
    }
    m.positive = textInput(link(s.inputs.positive))
    m.negative = textInput(link(s.inputs.negative))
  }
  if (!m.positive) {
    const texts = entries.filter(([, n]) => /CLIPTextEncode/i.test(n.class_type))
    if (texts[0]) m.positive = has(texts[0][0], 'text')
    if (texts[1]) m.negative = has(texts[1][0], 'text')
  }
  if (!m.seed) {
    const noise = find((t) => /RandomNoise/i.test(t))
    if (noise) m.seed = has(noise[0], 'noise_seed')
  }
  const latent = find((t) => /EmptyLatentImage|EmptySD3LatentImage|EmptyLatent/i.test(t))
  if (latent) {
    m.width = has(latent[0], 'width')
    m.height = has(latent[0], 'height')
  }
  const ckpt = find((t) => /CheckpointLoader|UNETLoader/i.test(t))
  if (ckpt) m.checkpoint = has(ckpt[0], 'ckpt_name') ?? has(ckpt[0], 'unet_name')
  const lora = find((t) => /LoraLoader/i.test(t))
  if (lora) {
    m.lora = has(lora[0], 'lora_name')
    m.loraStrength = has(lora[0], 'strength_model')
  }
  const load = find((t) => t === 'LoadImage')
  if (load) m.sourceImage = has(load[0], 'image')
  return m
}

/** Writes the request's values into a copy of the workflow using the mapping. */
export function applyMapping(wf: ApiWorkflow, map: ComfyMapping, values: Partial<Record<keyof ComfyMapping, unknown>>): ApiWorkflow {
  const out = structuredClone(wf)
  for (const [key, target] of Object.entries(map) as [keyof ComfyMapping, NodeInput | null][]) {
    const value = values[key]
    if (!target || value === undefined || value === null || value === '') continue
    const node = out[target.nodeId]
    if (!node) throw new AppError('COMFY_MAPPING', `The mapping for “${key}” points at node ${target.nodeId}, which isn’t in the workflow.`)
    node.inputs[target.input] = value
  }
  return out
}

function base(b: ResolvedImageBackend): string {
  const u = b.baseUrl.trim().replace(/\/+$/, '')
  if (!u) throw new AppError('NO_BASE_URL', `“${b.name}” has no base URL.`)
  return u
}

interface HistoryEntry {
  outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }>
  status?: { status_str?: string; completed?: boolean; messages?: [string, { exception_message?: string; node_type?: string }][] }
}

export interface ComfyDeps {
  /** Loads a stored workflow by id (from appdata or the vault). */
  loadWorkflow: (wf: ComfyWorkflow) => Promise<ApiWorkflow>
}

export function comfyAdapter(deps: ComfyDeps): ImageAdapter {
  return {
    async generate(b, req, opts) {
      const workflows = b.comfy.workflows
      const wf = workflows.find((w) => w.id === req.workflowId) ?? workflows.find((w) => w.id === b.comfy.defaultWorkflowId) ?? workflows[0]
      if (!wf) throw new AppError('COMFY_NO_WORKFLOW', `“${b.name}” has no workflow. Import an API-format workflow in Settings → Image backends.`)
      if (!wf.mapping.positive) throw new AppError('COMFY_MAPPING', `Workflow “${wf.name}” has no node mapped to the positive prompt.`)
      const api = await deps.loadWorkflow(wf)
      const root = base(b)
      const authHeaders: Record<string, string> = b.key ? { Authorization: `Bearer ${b.key}` } : {}

      let sourceName: string | undefined
      if (req.source && wf.mapping.sourceImage) {
        const form = new FormData()
        form.append('image', new Blob([req.source.data]) as unknown as globalThis.Blob, req.source.filename)
        form.append('overwrite', 'true')
        const { res, deadline } = await request(b.net, { url: `${root}/upload/image`, headers: authHeaders, body: form, signal: opts.signal })
        const up = (await readJson(res, deadline)) as { name?: string; subfolder?: string }
        sourceName = up.subfolder ? `${up.subfolder}/${up.name}` : up.name
      }

      const seed = wf.seedMode === 'fixed' ? wf.fixedSeed : req.seed >= 0 ? req.seed : randomSeed()
      const prompt = applyMapping(api, wf.mapping, {
        positive: req.prompt,
        negative: req.negative,
        seed,
        width: req.width,
        height: req.height,
        steps: req.steps,
        cfg: req.cfg,
        checkpoint: wf.checkpoint || undefined,
        lora: wf.lora || undefined,
        loraStrength: wf.lora ? wf.loraStrength : undefined,
        sourceImage: sourceName
      })

      const clientId = randomUUID()
      // Open the socket first so no progress message is missed.
      const progress = watchProgress(b, root, clientId, opts.onProgress)
      try {
        const { res, deadline } = await request(b.net, {
          url: `${root}/prompt`,
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ prompt, client_id: clientId }),
          signal: opts.signal
        })
        const queued = (await readJson(res, deadline)) as { prompt_id?: string; error?: unknown; node_errors?: unknown }
        if (!queued.prompt_id) throw new AppError('COMFY_REJECTED', 'ComfyUI rejected the workflow.', JSON.stringify(queued).slice(0, 4000))
        const promptId = queued.prompt_id

        const onAbort = (): void => {
          void request(b.net, { url: `${root}/interrupt`, method: 'POST', headers: authHeaders, body: '' }).catch(() => {})
        }
        opts.signal?.addEventListener('abort', onAbort, { once: true })
        try {
          const entry = await waitForResult(b, root, promptId, authHeaders, progress, opts.signal)
          const status = entry.status
          if (status?.status_str === 'error') {
            const err = status.messages?.find(([kind]) => kind === 'execution_error')?.[1]
            throw new AppError('COMFY_FAILED', `ComfyUI failed${err?.node_type ? ` in ${err.node_type}` : ''}: ${err?.exception_message ?? 'unknown error'}`)
          }
          const image = Object.values(entry.outputs ?? {}).flatMap((o) => o.images ?? []).find((i) => i.type === 'output') ??
            Object.values(entry.outputs ?? {}).flatMap((o) => o.images ?? [])[0]
          if (!image) throw new AppError('COMFY_NO_IMAGE', 'The workflow finished without producing an image (is there a SaveImage node?).')
          const q = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder, type: image.type })
          const view = await request(b.net, { url: `${root}/view?${q}`, headers: authHeaders, signal: opts.signal })
          const data = Buffer.from(await view.res.arrayBuffer())
          view.deadline.clear()
          return { data, ext: sniffExt(data), seed }
        } finally {
          opts.signal?.removeEventListener('abort', onAbort)
        }
      } finally {
        progress.close()
      }
    }
  }
}

interface ProgressWatch {
  /** Resolves when the socket reports this prompt finished (or rejects on its error). */
  done: (promptId: string) => Promise<void>
  connected: boolean
  close: () => void
}

function watchProgress(b: ResolvedImageBackend, root: string, clientId: string, onProgress?: (v: number, label?: string) => void): ProgressWatch {
  const url = `${root.replace(/^http/, 'ws')}/ws?clientId=${encodeURIComponent(clientId)}`
  const waiters = new Map<string, { resolve: () => void; reject: (e: Error) => void }>()
  const finished = new Set<string>()
  const watch: ProgressWatch = {
    connected: false,
    done: (id) =>
      finished.has(id)
        ? Promise.resolve()
        : new Promise<void>((resolve, reject) => {
            waiters.set(id, { resolve, reject })
          }),
    close: () => {
      try {
        ws?.close()
      } catch {
        /* already closed */
      }
    }
  }
  let ws: WebSocket | undefined
  try {
    ws = new WebSocket(url, { dispatcher: getDispatcher(b.net), headers: { ...b.net.headers, ...(b.key ? { Authorization: `Bearer ${b.key}` } : {}) } })
  } catch {
    return watch
  }
  ws.addEventListener('open', () => {
    watch.connected = true
  })
  ws.addEventListener('message', (ev) => {
    if (typeof ev.data !== 'string') return // binary preview frames
    let msg: { type?: string; data?: Record<string, unknown> }
    try {
      msg = JSON.parse(ev.data)
    } catch {
      return
    }
    const d = msg.data ?? {}
    const pid = typeof d.prompt_id === 'string' ? d.prompt_id : undefined
    if (msg.type === 'progress' && typeof d.value === 'number' && typeof d.max === 'number' && d.max > 0) {
      onProgress?.(d.value / d.max, `Step ${d.value}/${d.max}`)
    } else if (msg.type === 'executing' && d.node === null && pid) {
      finished.add(pid)
      waiters.get(pid)?.resolve()
    } else if (msg.type === 'execution_error' && pid) {
      finished.add(pid)
      waiters.get(pid)?.resolve() // details come from /history
    } else if (msg.type === 'status') {
      const q = (d.status as { exec_info?: { queue_remaining?: number } } | undefined)?.exec_info?.queue_remaining
      if (typeof q === 'number' && q > 1) onProgress?.(0, `Queued (${q - 1} ahead)`)
    }
  })
  ws.addEventListener('error', () => {
    watch.connected = false
  })
  return watch
}

/** Waits for the websocket's "done" (if connected) while polling /history as a fallback. */
async function waitForResult(
  b: ResolvedImageBackend,
  root: string,
  promptId: string,
  headers: Record<string, string>,
  progress: ProgressWatch,
  signal?: AbortSignal
): Promise<HistoryEntry> {
  const started = Date.now()
  const limit = Math.max(b.net.timeoutMs, 10 * 60_000)
  let wsDone = false
  void progress.done(promptId).then(() => {
    wsDone = true
  })
  for (;;) {
    if (signal?.aborted) throw new AppError('ABORTED', 'Stopped.')
    if (Date.now() - started > limit) throw new AppError('TIMEOUT', 'ComfyUI did not finish in time.')
    // Poll quickly once the socket says it's done, slowly otherwise.
    await new Promise((r) => setTimeout(r, wsDone ? 50 : progress.connected ? 1500 : 1000))
    const { res, deadline } = await request(b.net, { url: `${root}/history/${encodeURIComponent(promptId)}`, headers, signal })
    const history = (await readJson(res, deadline)) as Record<string, HistoryEntry>
    const entry = history[promptId]
    if (entry && (entry.status?.completed || entry.status?.status_str === 'error' || Object.keys(entry.outputs ?? {}).length)) return entry
  }
}
