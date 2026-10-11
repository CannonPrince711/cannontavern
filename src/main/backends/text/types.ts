import type { TextBackend } from '@shared/settings'
import type { ChatTurn } from '@shared/types'
import { AppError } from '../../errors'
import type { NetConfig } from '../../http'

export interface TextPrompt {
  system: string
  messages: ChatTurn[]
  /** Extra stop sequences on top of the backend's own. */
  stop?: string[]
  maxTokens?: number
  /** Speaker labels for text-completion backends (KoboldCpp, {{prompt}}). */
  userLabel?: string
  assistantLabel?: string
}

/** A backend with its secrets decrypted. Lives only in the main process. */
export interface ResolvedTextBackend extends TextBackend {
  key: string
  net: NetConfig
}

export interface GenerateOptions {
  signal?: AbortSignal
  onToken?: (delta: string) => void
  /** Overrides the backend's streaming setting (Test connection streams when enabled). */
  stream?: boolean
}

export interface GenerateResult {
  text: string
  model?: string
  stopReason?: string
  /** Milliseconds until the first streamed token. */
  firstTokenMs?: number
  /** Set when the model declined (e.g. Anthropic stop_reason "refusal"). */
  refusal?: { category?: string | null; explanation?: string | null }
}

/** The exact request an adapter would send, for the prompt inspector. */
export interface PreparedRequest {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

export interface TextAdapter {
  prepare(backend: ResolvedTextBackend, prompt: TextPrompt, stream: boolean): PreparedRequest
  generate(backend: ResolvedTextBackend, prompt: TextPrompt, opts: GenerateOptions): Promise<GenerateResult>
  listModels(backend: ResolvedTextBackend, signal?: AbortSignal): Promise<string[]>
}

export function trimBase(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

export function requireBase(b: ResolvedTextBackend): string {
  const base = trimBase(b.baseUrl)
  if (!base) throw new AppError('NO_BASE_URL', `“${b.name}” has no base URL.`)
  try {
    new URL(base)
  } catch {
    throw new AppError('BAD_BASE_URL', `“${base}” is not a valid URL.`)
  }
  return base
}

/** Parses the backend's "extra body JSON" setting. */
export function extraBody(b: TextBackend): Record<string, unknown> {
  const raw = b.generation.extraBody.trim()
  if (!raw) return {}
  try {
    const value = JSON.parse(raw) as unknown
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  } catch {
    /* fall through */
  }
  throw new AppError('BAD_EXTRA_BODY', `The extra body JSON of “${b.name}” is not a JSON object.`)
}

export function deepMerge(base: Record<string, unknown>, extra: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(extra)) {
    const cur = out[k]
    out[k] =
      v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)
        ? deepMerge(cur as Record<string, unknown>, v as Record<string, unknown>)
        : v
  }
  return out
}

export function stopSequences(b: TextBackend, p: TextPrompt): string[] {
  return [...new Set([...b.generation.stop, ...(p.stop ?? [])].filter(Boolean))]
}

/** Chat turns → one text prompt, for text-completion APIs. */
export function flattenPrompt(p: TextPrompt): string {
  const user = p.userLabel ?? 'Player'
  const assistant = p.assistantLabel ?? 'DM'
  const lines: string[] = []
  if (p.system.trim()) lines.push(p.system.trim(), '')
  for (const m of p.messages) {
    if (m.role === 'system') lines.push(`[${m.content.trim()}]`)
    else lines.push(`${m.role === 'user' ? user : assistant}: ${m.content.trim()}`)
  }
  const last = p.messages[p.messages.length - 1]
  // Leave the assistant label open so the model writes the reply…
  if (last?.role !== 'assistant') lines.push(`${assistant}:`)
  return lines.join('\n')
}

export function nonNull<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined)) as Partial<T>
}
