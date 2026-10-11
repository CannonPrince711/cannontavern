import type { TextPreset } from '@shared/presets'
import { CUSTOM_TEMPLATE_EXAMPLE } from '@shared/presets'
import {
  ImageBackendInputSchema,
  TextBackendInputSchema,
  type ImageBackendInput,
  type ImageBackendType,
  type ImageBackendView,
  type SecretInput,
  type SecretView,
  type TextBackendInput,
  type TextBackendView
} from '@shared/settings'

/** A stored secret as the form starts with it: "keep" means unchanged. */
export function secretToInput(view: SecretView): SecretInput {
  switch (view.kind) {
    case 'stored':
      return { kind: 'keep' }
    case 'plain':
      return { kind: 'plain', value: view.value }
    case 'env':
      return { kind: 'env', name: view.name }
    default:
      return { kind: 'none' }
  }
}

export function textViewToInput(view: TextBackendView): TextBackendInput {
  return {
    ...structuredClone(view),
    apiKey: secretToInput(view.apiKey),
    network: {
      ...structuredClone(view.network),
      headers: view.network.headers.map((h) => ({ name: h.name, value: secretToInput(h.value) }))
    }
  }
}

export function newTextBackend(preset: TextPreset, existingNames: string[]): TextBackendInput {
  let name = preset.label
  for (let i = 2; existingNames.includes(name); i++) name = `${preset.label} ${i}`
  return TextBackendInputSchema.parse({
    id: crypto.randomUUID(),
    name,
    type: preset.type,
    baseUrl: preset.baseUrl,
    model: preset.model,
    custom: preset.type === 'custom' ? { bodyTemplate: CUSTOM_TEMPLATE_EXAMPLE, streamParser: 'sse' } : {}
  })
}

/** Stop sequences are edited one per line, with \n and \t written as escapes. */
export function stopToText(stop: string[]): string {
  return stop.map((s) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\t/g, '\\t')).join('\n')
}

export function textToStop(text: string): string[] {
  return text
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => l.replace(/\\(\\|n|t)/g, (_, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : '\\')))
}

export function isValidJsonObject(text: string): boolean {
  if (!text.trim()) return true
  try {
    const v = JSON.parse(text) as unknown
    return !!v && typeof v === 'object' && !Array.isArray(v)
  } catch {
    return false
  }
}

// ─── Image backends ─────────────────────────────────────────────────────────

export function imageViewToInput(view: ImageBackendView): ImageBackendInput {
  return {
    ...structuredClone(view),
    apiKey: secretToInput(view.apiKey),
    network: {
      ...structuredClone(view.network),
      headers: view.network.headers.map((h) => ({ name: h.name, value: secretToInput(h.value) }))
    }
  }
}

export const IMAGE_PRESETS: { type: ImageBackendType; label: string; baseUrl: string; hint: string }[] = [
  { type: 'comfyui', label: 'ComfyUI', baseUrl: 'http://127.0.0.1:8188', hint: 'Your workflows, any model. Works remotely too.' },
  { type: 'a1111', label: 'Automatic1111 / Forge', baseUrl: 'http://127.0.0.1:7860', hint: 'Start it with --api.' },
  { type: 'openai', label: 'OpenAI images', baseUrl: 'https://api.openai.com/v1', hint: 'gpt-image-1 or compatible servers.' },
  { type: 'custom', label: 'Custom (any API)', baseUrl: '', hint: 'Body template + JSONPath to the image.' }
]

export const IMAGE_TYPE_LABELS: Record<ImageBackendType, string> = {
  comfyui: 'ComfyUI',
  a1111: 'Automatic1111 / Forge',
  openai: 'OpenAI-compatible',
  custom: 'Custom'
}

export function newImageBackend(type: ImageBackendType, existingNames: string[]): ImageBackendInput {
  const preset = IMAGE_PRESETS.find((p) => p.type === type)!
  let name = preset.label
  for (let i = 2; existingNames.includes(name); i++) name = `${preset.label} ${i}`
  return ImageBackendInputSchema.parse({
    id: crypto.randomUUID(),
    name,
    type,
    baseUrl: preset.baseUrl,
    custom: type === 'custom' ? { bodyTemplate: '{\n  "prompt": "{{prompt}}",\n  "negative_prompt": "{{negative}}",\n  "width": {{width}},\n  "height": {{height}},\n  "steps": {{steps}},\n  "seed": {{seed}}\n}', imagePath: '$.images[0]' } : {}
  })
}
