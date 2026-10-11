import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { ComfyWorkflow, ImageBackend, ImageBackendInput, ImageBackendType } from '@shared/settings'
import type { TestResult } from '@shared/types'
import { toErrorInfo } from '../../errors'
import { paths } from '../../paths'
import { reveal } from '../../secrets'
import { vaultService } from '../../vault/service'
import { netFromInput, netFromStored, revealInput } from '../resolve'
import { comfyAdapter, parseWorkflow, type ApiWorkflow } from './comfy'
import { a1111Adapter, customImageAdapter, openAiImageAdapter } from './others'
import type { ImageAdapter, ImageRequest, ResolvedImageBackend } from './types'

/** Reads a stored ComfyUI workflow from %APPDATA%\DND Tavern\workflows\ or the vault. */
export async function loadWorkflowFile(file: string, location: 'appdata' | 'vault'): Promise<ApiWorkflow> {
  const raw =
    location === 'vault'
      ? (await vaultService.require().read(file)).content
      : await fs.readFile(join(paths.workflowsDir, file.replace(/[\\/]/g, '')), 'utf8')
  return parseWorkflow(JSON.parse(raw))
}

const ADAPTERS: Record<ImageBackendType, ImageAdapter> = {
  comfyui: comfyAdapter({ loadWorkflow: (wf: ComfyWorkflow) => loadWorkflowFile(wf.file, wf.location) }),
  a1111: a1111Adapter,
  openai: openAiImageAdapter,
  custom: customImageAdapter
}

export function imageAdapter(type: ImageBackendType): ImageAdapter {
  return ADAPTERS[type]
}

export function resolveImageBackend(b: ImageBackend): ResolvedImageBackend {
  return { ...b, key: reveal(b.apiKey), net: netFromStored(b.network) }
}

export function resolveImageInput(input: ImageBackendInput, stored: ImageBackend | undefined): ResolvedImageBackend {
  const backend = { ...input, apiKey: { kind: 'none' as const }, network: { ...input.network, headers: [] } } satisfies ImageBackend
  return { ...backend, key: revealInput(input.apiKey, stored?.apiKey), net: netFromInput(input.network, stored?.network) }
}

/** The style prefix/suffix and defaults applied to every request. */
export function buildImageRequest(b: ImageBackend, prompt: string, over: Partial<ImageRequest> = {}): ImageRequest {
  const d = b.defaults
  const styled = [d.stylePrefix.trim(), prompt.trim(), d.styleSuffix.trim()].filter(Boolean).join(', ')
  return {
    prompt: styled,
    negative: d.negativePrompt,
    width: d.width,
    height: d.height,
    steps: d.steps,
    cfg: d.cfg,
    sampler: d.sampler,
    seed: -1,
    ...over
  }
}

/** Generates a small, quick image and returns it as a data URL. */
export async function testImageBackend(b: ResolvedImageBackend, workflowId?: string): Promise<TestResult> {
  const started = Date.now()
  try {
    const req = buildImageRequest(b, 'a small brass lantern on a wooden table, warm candlelight', {
      width: 512,
      height: 512,
      steps: Math.min(b.defaults.steps, 12),
      workflowId
    })
    const r = await imageAdapter(b.type).generate(b, req, {})
    const mime = r.ext === 'jpg' ? 'image/jpeg' : `image/${r.ext}`
    return { ok: true, ms: Date.now() - started, sample: `${Math.round(r.data.length / 1024)} KB ${r.ext.toUpperCase()}`, imageDataUrl: `data:${mime};base64,${r.data.toString('base64')}` }
  } catch (err) {
    return { ok: false, ms: Date.now() - started, error: toErrorInfo(err) }
  }
}
