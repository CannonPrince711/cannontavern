import type { ImageBackend } from '@shared/settings'
import type { NetConfig } from '../../http'

export interface ResolvedImageBackend extends ImageBackend {
  key: string
  net: NetConfig
}

export interface ImageRequest {
  prompt: string
  negative: string
  width: number
  height: number
  steps: number
  cfg: number
  sampler: string
  /** -1 = random. */
  seed: number
  workflowId?: string
  /** ComfyUI built-in workflow: the checkpoint to load. */
  checkpoint?: string
  /** Source image for img2img (e.g. the character's avatar). */
  source?: { data: Buffer; filename: string }
}

export interface ImageResult {
  data: Buffer
  ext: 'png' | 'jpg' | 'webp'
  seed?: number
}

export interface ImageOptions {
  signal?: AbortSignal
  onProgress?: (value: number, label?: string) => void
}

export interface ImageAdapter {
  generate(b: ResolvedImageBackend, req: ImageRequest, opts: ImageOptions): Promise<ImageResult>
}

export function sniffExt(data: Buffer): ImageResult['ext'] {
  if (data[0] === 0xff && data[1] === 0xd8) return 'jpg'
  if (data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp'
  return 'png'
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 32)
}
