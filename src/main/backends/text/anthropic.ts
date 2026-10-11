import Anthropic from '@anthropic-ai/sdk'
import { fetch as undiciFetch } from 'undici'
import type { ChatTurn } from '@shared/types'
import { AppError } from '../../errors'
import { getDispatcher, httpError, networkError } from '../../http'
import {
  extraBody,
  stopSequences,
  trimBase,
  type GenerateResult,
  type PreparedRequest,
  type ResolvedTextBackend,
  type TextAdapter,
  type TextPrompt
} from './types'

const DEFAULT_BASE = 'https://api.anthropic.com'
const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

/** Claude 4.7+ / 5.x reject temperature, top_p and top_k (HTTP 400). */
function rejectsSampling(model: string): boolean {
  return /claude-(fable|mythos|opus-5|opus-4-[78]|sonnet-5|haiku-5)/.test(model)
}

/** Claude 4.6+ reject assistant prefill (a trailing assistant message). */
function rejectsPrefill(model: string): boolean {
  return rejectsSampling(model) || /claude-(opus|sonnet)-4-6/.test(model)
}

/** Models that accept the server-side refusal fallback (`fallbacks: "default"`). */
function supportsFallback(model: string): boolean {
  return /^claude-(fable-5-1|opus-5-5|opus-5|sonnet-5-5)$/.test(model)
}

function baseUrl(b: ResolvedTextBackend): string {
  return (trimBase(b.baseUrl) || DEFAULT_BASE).replace(/\/v1$/, '')
}

function isAnthropicHost(url: string): boolean {
  try {
    return new URL(url).hostname === 'api.anthropic.com'
  } catch {
    return false
  }
}

function useFallback(b: ResolvedTextBackend): boolean {
  return b.anthropic.refusalFallback && isAnthropicHost(baseUrl(b)) && supportsFallback(b.model)
}

function client(b: ResolvedTextBackend): Anthropic {
  return new Anthropic({
    // Always explicit: never let the SDK read ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL from the environment.
    apiKey: b.key || null,
    authToken: null,
    baseURL: baseUrl(b),
    defaultHeaders: b.net.headers,
    // undici's own fetch so the proxy / self-signed dispatcher applies.
    fetch: undiciFetch as unknown as typeof fetch,
    fetchOptions: { dispatcher: getDispatcher(b.net) } as Record<string, unknown>,
    timeout: b.net.timeoutMs,
    maxRetries: b.net.retries
  })
}

/**
 * Chat turns → Anthropic messages: system turns become bracketed user notes,
 * consecutive same-role turns are merged, and the conversation starts with a
 * user turn. A trailing assistant turn is turned into a "continue" request on
 * models that no longer accept prefill.
 */
export function toAnthropicMessages(turns: ChatTurn[], model: string): Anthropic.MessageParam[] {
  const out: { role: 'user' | 'assistant'; content: string }[] = []
  for (const t of turns) {
    const role = t.role === 'assistant' ? 'assistant' : 'user'
    const content = t.role === 'system' ? `[${t.content.trim()}]` : t.content
    const last = out[out.length - 1]
    if (last && last.role === role) last.content += `\n\n${content}`
    else out.push({ role, content })
  }
  if (out[0]?.role === 'assistant') out.unshift({ role: 'user', content: '[The scene begins.]' })
  if (out.length === 0) out.push({ role: 'user', content: '[Begin.]' })
  if (out[out.length - 1]?.role === 'assistant' && rejectsPrefill(model)) {
    out.push({ role: 'user', content: '[Continue your previous reply exactly where it stopped. Do not repeat it.]' })
  }
  return out
}

function params(b: ResolvedTextBackend, p: TextPrompt): Record<string, unknown> {
  const g = b.generation
  const stop = stopSequences(b, p)
  const sampling = !rejectsSampling(b.model)
  return {
    model: b.model,
    max_tokens: p.maxTokens ?? g.maxTokens,
    ...(p.system.trim() ? { system: p.system } : {}),
    messages: toAnthropicMessages(p.messages, b.model),
    ...(stop.length ? { stop_sequences: stop.slice(0, 8) } : {}),
    ...(sampling && g.temperature !== null ? { temperature: Math.min(1, g.temperature) } : {}),
    ...(sampling && g.topP !== null ? { top_p: g.topP } : {}),
    ...(sampling && g.topK !== null ? { top_k: g.topK } : {}),
    ...(b.anthropic.effort ? { output_config: { effort: b.anthropic.effort } } : {}),
    ...extraBody(b)
  }
}

function prepare(b: ResolvedTextBackend, p: TextPrompt, stream: boolean): PreparedRequest {
  const fallback = useFallback(b)
  return {
    url: `${baseUrl(b)}/v1/messages`,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...(b.key ? { 'x-api-key': b.key } : {}),
      ...(fallback ? { 'anthropic-beta': FALLBACK_BETA } : {}),
      ...b.net.headers
    },
    body: { ...params(b, p), stream, ...(fallback ? { fallbacks: 'default' } : {}) }
  }
}

function mapError(b: ResolvedTextBackend, err: unknown): AppError {
  const url = `${baseUrl(b)}/v1/messages`
  if (err instanceof AppError) return err
  if (err instanceof Anthropic.APIUserAbortError) return new AppError('ABORTED', 'Stopped.')
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new AppError('TIMEOUT', `Anthropic did not respond within ${Math.round(b.net.timeoutMs / 1000)} s.`)
  }
  if (err instanceof Anthropic.APIConnectionError) return networkError(url, (err as { cause?: unknown }).cause ?? err)
  if (err instanceof Anthropic.APIError && typeof err.status === 'number') {
    return httpError(url, err.status, JSON.stringify(err.error ?? { error: { message: err.message } }))
  }
  const message = (err as Error)?.message ?? String(err)
  if (/authentication method|apiKey|authToken/i.test(message)) {
    return new AppError('AUTH', `“${b.name}” has no API key. Add one (or an x-api-key header).`)
  }
  return new AppError('ANTHROPIC', message)
}

export const anthropicAdapter: TextAdapter = {
  prepare,
  async generate(b, p, opts): Promise<GenerateResult> {
    if (!b.model) throw new AppError('NO_MODEL', `Choose a model for “${b.name}”.`)
    const emit = opts.stream ?? b.generation.stream
    const started = Date.now()
    let firstTokenMs: number | undefined
    try {
      const c = client(b)
      const body = params(b, p)
      // Always stream internally: the SDK refuses long non-streaming requests,
      // and streaming avoids HTTP timeouts. Tokens are forwarded only if enabled.
      // Both stream classes share this surface; the union of their overloads doesn't type-check directly.
      const stream: { on(event: 'text', fn: (delta: string) => void): unknown; finalMessage(): Promise<unknown> } = useFallback(b)
        ? c.beta.messages.stream(
            { ...(body as unknown as Anthropic.Beta.MessageCreateParams), betas: [FALLBACK_BETA], fallbacks: 'default' },
            { signal: opts.signal }
          )
        : c.messages.stream(body as unknown as Anthropic.MessageCreateParams, { signal: opts.signal })
      stream.on('text', (delta: string) => {
        firstTokenMs ??= Date.now() - started
        if (emit) opts.onToken?.(delta)
      })
      const msg = (await stream.finalMessage()) as Anthropic.Message
      const text = msg.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('')
      const result: GenerateResult = { text, model: msg.model, stopReason: msg.stop_reason ?? undefined, firstTokenMs }
      if (msg.stop_reason === 'refusal') {
        result.refusal = { category: msg.stop_details?.category ?? null, explanation: msg.stop_details?.explanation ?? null }
      }
      return result
    } catch (err) {
      throw mapError(b, err)
    }
  },
  async listModels(b, signal) {
    try {
      const ids: string[] = []
      for await (const model of client(b).models.list({ limit: 100 }, { signal })) ids.push(model.id)
      return ids
    } catch (err) {
      throw mapError(b, err)
    }
  }
}
