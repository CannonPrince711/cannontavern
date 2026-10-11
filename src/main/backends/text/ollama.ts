import { NdjsonParser } from '@shared/streams'
import { AppError } from '../../errors'
import { readJson, readTextStream, request } from '../../http'
import {
  deepMerge,
  extraBody,
  nonNull,
  requireBase,
  stopSequences,
  type PreparedRequest,
  type ResolvedTextBackend,
  type TextAdapter,
  type TextPrompt
} from './types'

/** Ollama's native /api/chat (NDJSON streaming). */
function base(b: ResolvedTextBackend): string {
  return requireBase(b).replace(/\/api$/, '')
}

function prepare(b: ResolvedTextBackend, p: TextPrompt, stream: boolean): PreparedRequest {
  const g = b.generation
  const stop = stopSequences(b, p)
  const body = {
    model: b.model,
    messages: [...(p.system.trim() ? [{ role: 'system', content: p.system }] : []), ...p.messages],
    stream,
    options: nonNull({
      temperature: g.temperature,
      top_p: g.topP,
      top_k: g.topK,
      min_p: g.minP,
      repeat_penalty: g.repetitionPenalty,
      num_predict: p.maxTokens ?? g.maxTokens,
      num_ctx: g.contextSize,
      stop: stop.length ? stop : null
    })
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (b.key) headers.Authorization = `Bearer ${b.key}`
  return { url: `${base(b)}/api/chat`, method: 'POST', headers: { ...headers, ...b.net.headers }, body: deepMerge(body, extraBody(b)) }
}

interface OllamaChunk {
  model?: string
  message?: { content?: string }
  done?: boolean
  done_reason?: string
  error?: string
}

export const ollamaAdapter: TextAdapter = {
  prepare,
  async generate(b, p, opts) {
    if (!b.model) throw new AppError('NO_MODEL', `Choose a model for “${b.name}” (Fetch models lists what Ollama has).`)
    const stream = opts.stream ?? b.generation.stream
    const req = prepare(b, p, stream)
    const started = Date.now()
    const { res, deadline } = await request(b.net, {
      url: req.url,
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: opts.signal
    })
    if (!stream) {
      const json = (await readJson(res, deadline)) as OllamaChunk
      if (json.error) throw new AppError('OLLAMA', json.error)
      return { text: json.message?.content ?? '', model: json.model, stopReason: json.done_reason }
    }
    const parser = new NdjsonParser()
    let text = ''
    let model: string | undefined
    let stopReason: string | undefined
    let firstTokenMs: number | undefined
    const handle = (values: unknown[]): void => {
      for (const v of values as OllamaChunk[]) {
        if (v.error) throw new AppError('OLLAMA', v.error)
        model ??= v.model
        const delta = v.message?.content ?? ''
        if (delta) {
          firstTokenMs ??= Date.now() - started
          text += delta
          opts.onToken?.(delta)
        }
        if (v.done) stopReason = v.done_reason
      }
    }
    for await (const chunk of readTextStream(res, deadline)) handle(parser.feed(chunk).values)
    handle(parser.end().values)
    return { text, model, stopReason, firstTokenMs }
  },
  async listModels(b, signal) {
    const headers: Record<string, string> = {}
    if (b.key) headers.Authorization = `Bearer ${b.key}`
    const { res, deadline } = await request(b.net, { url: `${base(b)}/api/tags`, headers, signal })
    const json = (await readJson(res, deadline)) as { models?: { name?: string; model?: string }[] }
    return (json.models ?? []).map((m) => m.name ?? m.model ?? '').filter(Boolean).sort()
  }
}
