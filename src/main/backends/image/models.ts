/**
 * Model lists for the image model switcher: ComfyUI checkpoints (read from the
 * server for whichever loader node the workflow's checkpoint mapping points
 * at), Automatic1111 checkpoints, and OpenAI image models.
 */
import type { ImageBackend } from '@shared/settings'
import type { ImageModelList } from '@shared/types'
import { AppError } from '../../errors'
import { readJson, request } from '../../http'
import { loadWorkflowFile, resolveImageBackend } from './index'
import type { ResolvedImageBackend } from './types'

const OPENAI_IMAGE_MODELS = ['gpt-image-1', 'gpt-image-1-mini', 'dall-e-3', 'dall-e-2']

function root(b: ResolvedImageBackend): string {
  const u = b.baseUrl.trim().replace(/\/+$/, '')
  if (!u) throw new AppError('NO_BASE_URL', `“${b.name}” has no base URL.`)
  return u
}

async function getJson(b: ResolvedImageBackend, url: string): Promise<unknown> {
  const { res, deadline } = await request({ ...b.net, retries: 0, timeoutMs: Math.min(b.net.timeoutMs, 20_000) }, {
    url,
    headers: b.key ? { Authorization: `Bearer ${b.key}` } : {}
  })
  return readJson(res, deadline)
}

/** The choices a ComfyUI loader input offers, from /object_info/<class>. */
function optionsFor(info: unknown, cls: string, input: string): string[] {
  const node = (info as Record<string, { input?: { required?: Record<string, unknown>; optional?: Record<string, unknown> } }>)[cls]
  const spec = node?.input?.required?.[input] ?? node?.input?.optional?.[input]
  const first = Array.isArray(spec) ? spec[0] : undefined
  return Array.isArray(first) ? first.filter((x): x is string => typeof x === 'string') : []
}

export async function listImageModels(stored: ImageBackend): Promise<ImageModelList> {
  const b = resolveImageBackend(stored)
  switch (stored.type) {
    case 'comfyui': {
      const workflows = stored.comfy.workflows.map((w) => ({ id: w.id, name: w.name, purpose: w.purpose, canSetModel: !!w.mapping.checkpoint }))
      const wf = stored.comfy.workflows.find((w) => w.id === stored.comfy.defaultWorkflowId) ?? stored.comfy.workflows[0]
      const base = { workflows, currentWorkflowId: wf?.id ?? null, models: [] as string[], current: wf?.checkpoint ?? '' }
      if (!wf) {
        // The built-in workflow: any checkpoint the server has.
        const info = await getJson(b, `${root(b)}/object_info/CheckpointLoaderSimple`)
        const models = optionsFor(info, 'CheckpointLoaderSimple', 'ckpt_name')
        return { ...base, models, current: stored.comfy.checkpoint || models[0] || '', ...(models.length ? {} : { note: 'ComfyUI has no checkpoints in models/checkpoints.' }) }
      }
      if (!wf.mapping.checkpoint) return { ...base, note: 'This workflow has no checkpoint node mapped, so it always uses its own model.' }
      const json = await loadWorkflowFile(wf.file, wf.location)
      const node = json[wf.mapping.checkpoint.nodeId]
      if (!node) return { ...base, note: 'The mapped checkpoint node is missing from the workflow.' }
      const info = await getJson(b, `${root(b)}/object_info/${encodeURIComponent(node.class_type)}`)
      const models = optionsFor(info, node.class_type, wf.mapping.checkpoint.input)
      // An empty override means "whatever the workflow file says".
      const fileDefault = typeof node.inputs[wf.mapping.checkpoint.input] === 'string' ? (node.inputs[wf.mapping.checkpoint.input] as string) : ''
      return { ...base, models, current: wf.checkpoint || fileDefault }
    }
    case 'a1111': {
      const list = (await getJson(b, `${root(b)}/sdapi/v1/sd-models`)) as { title?: string }[]
      const models = (Array.isArray(list) ? list : []).map((m) => m.title).filter((t): t is string => !!t)
      let current = stored.a1111.model
      if (!current) {
        const opts = (await getJson(b, `${root(b)}/sdapi/v1/options`).catch(() => null)) as { sd_model_checkpoint?: string } | null
        current = opts?.sd_model_checkpoint ?? ''
      }
      return { models, current, workflows: [], currentWorkflowId: null }
    }
    case 'openai': {
      let models = OPENAI_IMAGE_MODELS
      try {
        const res = (await getJson(b, `${root(b)}/models`)) as { data?: { id?: string }[] }
        const ids = (res.data ?? []).map((m) => m.id ?? '').filter((id) => /image|dall-e/i.test(id))
        if (ids.length) models = [...new Set(ids)].sort()
      } catch {
        // Servers that don't list models: offer the usual ones.
      }
      return { models, current: stored.openai.model, workflows: [], currentWorkflowId: null }
    }
    case 'custom':
      return { models: [], current: '', workflows: [], currentWorkflowId: null, note: 'Custom backends choose their model in the body template.' }
  }
}

/** Applies a switcher choice to a stored image backend. */
export function withImageModel(b: ImageBackend, choice: { model?: string; workflowId?: string }): ImageBackend {
  const next = structuredClone(b)
  if (choice.workflowId && next.comfy.workflows.some((w) => w.id === choice.workflowId)) next.comfy.defaultWorkflowId = choice.workflowId
  if (choice.model !== undefined) {
    if (next.type === 'comfyui') {
      const wf = next.comfy.workflows.find((w) => w.id === next.comfy.defaultWorkflowId) ?? next.comfy.workflows[0]
      if (wf) wf.checkpoint = choice.model
      else next.comfy.checkpoint = choice.model
    } else if (next.type === 'a1111') next.a1111.model = choice.model
    else if (next.type === 'openai') next.openai.model = choice.model
  }
  return next
}
