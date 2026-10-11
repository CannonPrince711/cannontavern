/**
 * Per-purpose generation options (Settings → Image backends → Generation
 * options): which backend, model, workflow, size, steps and extra style a
 * scene, portrait, map or plain /image prompt uses. Anything left empty falls
 * back to the backend's own settings.
 */
import type { ImageBackend, ImagePurpose, ImageProfile, Settings } from '@shared/settings'
import type { ImageRequest } from './types'

/** The backend for a purpose: an explicit pick, then the purpose's, then the default. */
export function backendFor(s: Pick<Settings, 'imageBackends' | 'defaultImageBackendId' | 'imageProfiles'>, purpose: ImagePurpose, explicitId?: string): ImageBackend | undefined {
  const byId = (id: string | null | undefined): ImageBackend | undefined => (id ? s.imageBackends.find((b) => b.id === id) : undefined)
  return byId(explicitId) ?? byId(s.imageProfiles[purpose].backendId) ?? byId(s.defaultImageBackendId) ?? s.imageBackends[0]
}

/** The workflow a ComfyUI request uses: an explicit pick, the purpose's, one tagged for the purpose, then the default. */
export function workflowFor(backend: ImageBackend, purpose: ImagePurpose, profile: ImageProfile, wanted?: string): string | undefined {
  if (backend.type !== 'comfyui') return undefined
  const wfs = backend.comfy.workflows
  const byId = (id: string | null | undefined) => (id ? wfs.find((w) => w.id === id) : undefined)
  return (byId(wanted) ?? byId(profile.workflowId) ?? wfs.find((w) => w.purpose === purpose) ?? byId(backend.comfy.defaultWorkflowId) ?? wfs[0])?.id
}

/** Default size for a purpose from the backend's defaults: scenes landscape, portraits portrait, maps 4:3. */
function autoSize(b: ImageBackend, purpose: ImagePurpose): { width: number; height: number } | Record<string, never> {
  const long = Math.max(b.defaults.width, b.defaults.height)
  const short = Math.min(b.defaults.width, b.defaults.height)
  if (purpose === 'scene') return { width: long, height: short }
  if (purpose === 'portrait') return { width: short, height: long }
  if (purpose === 'map') return { width: long, height: Math.round((long * 0.75) / 8) * 8 }
  return {}
}

/**
 * Applies a purpose's options: returns the backend to send with (a copy with
 * the model swapped in, when one is set) and the request overrides.
 */
export function applyImageProfile(
  backend: ImageBackend,
  purpose: ImagePurpose,
  profile: ImageProfile,
  workflowId: string | undefined
): { backend: ImageBackend; over: Partial<ImageRequest>; style: string } {
  let b = backend
  const model = profile.model.trim()
  if (model) {
    b = structuredClone(backend)
    if (b.type === 'a1111') b.a1111.model = model
    else if (b.type === 'openai') b.openai.model = model
    else if (b.type === 'comfyui') {
      const wf = b.comfy.workflows.find((w) => w.id === workflowId)
      if (wf) wf.checkpoint = model
    }
  }
  const over: Partial<ImageRequest> = {
    ...(profile.width > 0 && profile.height > 0 ? { width: profile.width, height: profile.height } : autoSize(backend, purpose)),
    ...(profile.steps > 0 ? { steps: profile.steps } : {}),
    ...(profile.negative.trim() ? { negative: [backend.defaults.negativePrompt.trim(), profile.negative.trim()].filter(Boolean).join(', ') } : {}),
    ...(workflowId ? { workflowId } : {})
  }
  return { backend: b, over, style: profile.style.trim() }
}
