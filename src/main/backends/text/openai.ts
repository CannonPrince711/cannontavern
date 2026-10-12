import { SseParser } from '@shared/streams'
import { AppError } from '../../errors'
import { readJson, readTextStream, request } from '../../http'
import {
  deepMerge,
  extraBody,
  nonNull,
  requireBase,
  stopSequences,
  type GenerateResult,
  type PreparedRequest,
  type ResolvedTextBackend,
  type TextAdapter,
  type TextPrompt
} from './types'

/**
 * OpenAI chat completions, the lingua franca of local and hosted servers
 * (OpenRouter, Groq, Together, DeepSeek, vLLM, LM Studio, llama.cpp,
 * KoboldCpp /v1, TabbyAPI, text-generation-webui).
 */
export function buildOpenAiRequest(b: ResolvedTextBackend, p: TextPrompt, stream: boolean, base: string): PreparedRequest {
  const g = b.generation
  const host = safeHost(base)
  const official = host === 'api.openai.com'
  const stop = stopSequences(b, p)
  const body: Record<string, unknown> = {
    model: b.model || undefined,
    messages: [...(p.system.trim() ? [{ role: 'system', content: p.system }] : []), ...p.messages],
    stream,
    // OpenAI's own API wants max_completion_tokens; compatible servers expect max_tokens.
    [official ? 'max_completion_tokens' : 'max_tokens']: p.maxTokens ?? g.maxTokens,
    ...nonNull({
      temperature: g.temperature,
      top_p: g.topP,
      top_k: g.topK,
      min_p: g.minP,
      repetition_penalty: g.repetitionPenalty
    }),
    ...(stop.length ? { stop: official ? stop.slice(0, 4) : stop } : {}),
    // Self-hosted servers (llama.cpp, vLLM, LM Studio…) switch a thinking model's reasoning off this way; hosted APIs may reject the field.
    ...(!g.thinking && !HOSTED_API.test(host) ? { chat_template_kwargs: { enable_thinking: false } } : {})
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (b.key) headers.Authorization = `Bearer ${b.key}`
  if (host.endsWith('openrouter.ai')) {
    headers['HTTP-Referer'] = 'https://github.com/dnd-tavern'
    headers['X-Title'] = 'DND Tavern'
  }
  return {
    url: `${base}/chat/completions`,
    method: 'POST',
    headers: { ...headers, ...b.net.headers },
    body: deepMerge(body, extraBody(b))
  }
}

/** Hosted APIs that don't take llama.cpp-style template options. */
const HOSTED_API = /(^|\.)(openai\.com|openrouter\.ai|groq\.com|together\.(ai|xyz)|deepseek\.com|mistral\.ai|x\.ai|fireworks\.ai|anthropic\.com|googleapis\.com|perplexity\.ai|cohere\.(ai|com)|deepinfra\.com|novita\.ai|featherless\.ai|nano-gpt\.com|chutes\.ai)$/i

export async function runOpenAi(
  b: ResolvedTextBackend,
  req: PreparedRequest,
  stream: boolean,
  opts: { signal?: AbortSignal; onToken?: (d: string) => void }
): Promise<GenerateResult> {
  const started = Date.now()
  const { res, deadline } = await request(b.net, {
    url: req.url,
    method: req.method,
    headers: req.headers,
    body: JSON.stringify(req.body),
    signal: opts.signal
  })
  if (!stream) {
    const json = (await readJson(res, deadline)) as OpenAiResponse
    const choice = json.choices?.[0]
    return {
      text: choice?.message?.content ?? choice?.text ?? '',
      model: json.model,
      stopReason: choice?.finish_reason ?? undefined,
      ...(choice?.message?.reasoning_content ? { reasoned: true } : {})
    }
  }

  const parser = new SseParser()
  let text = ''
  let model: string | undefined
  let stopReason: string | undefined
  let firstTokenMs: number | undefined
  let reasoned = false
  const handle = (data: string): boolean => {
    if (data.trim() === '[DONE]') return true
    let json: OpenAiResponse
    try {
      json = JSON.parse(data) as OpenAiResponse
    } catch {
      return false
    }
    if (json.error) throw new AppError('STREAM_ERROR', String(json.error.message ?? 'The server reported an error mid-stream.'))
    model ??= json.model
    const choice = json.choices?.[0]
    const delta = choice?.delta?.content ?? choice?.text ?? ''
    if (delta) {
      firstTokenMs ??= Date.now() - started
      text += delta
      opts.onToken?.(delta)
    }
    if (choice?.delta?.reasoning_content) reasoned = true
    if (choice?.finish_reason) stopReason = choice.finish_reason
    return false
  }
  outer: for await (const chunk of readTextStream(res, deadline)) {
    for (const ev of parser.feed(chunk)) if (handle(ev.data)) break outer
  }
  for (const ev of parser.end()) handle(ev.data)
  return { text, model, stopReason, firstTokenMs, ...(reasoned ? { reasoned } : {}) }
}

export async function listOpenAiModels(b: ResolvedTextBackend, base: string, signal?: AbortSignal): Promise<string[]> {
  const headers: Record<string, string> = {}
  if (b.key) headers.Authorization = `Bearer ${b.key}`
  const { res, deadline } = await request(b.net, { url: `${base}/models`, headers, signal })
  const json = (await readJson(res, deadline)) as { data?: { id?: string }[]; models?: { id?: string; name?: string }[] }
  const list = json.data ?? json.models ?? []
  return [...new Set(list.map((m) => m.id ?? (m as { name?: string }).name).filter((x): x is string => !!x))].sort()
}

export const openAiAdapter: TextAdapter = {
  prepare: (b, p, stream) => buildOpenAiRequest(b, p, stream, requireBase(b)),
  generate: (b, p, opts) => {
    const stream = opts.stream ?? b.generation.stream
    return runOpenAi(b, buildOpenAiRequest(b, p, stream, requireBase(b)), stream, opts)
  },
  listModels: (b, signal) => listOpenAiModels(b, requireBase(b), signal)
}

interface OpenAiResponse {
  model?: string
  error?: { message?: unknown }
  choices?: {
    message?: { content?: string; reasoning_content?: string }
    delta?: { content?: string; reasoning_content?: string }
    text?: string
    finish_reason?: string | null
  }[]
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}
