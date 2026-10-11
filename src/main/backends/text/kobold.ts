import { SseParser } from '@shared/streams'
import { getDispatcher, readJson, readTextStream, request } from '../../http'
import { fetch as undiciFetch } from 'undici'
import {
  deepMerge,
  extraBody,
  flattenPrompt,
  nonNull,
  requireBase,
  stopSequences,
  type PreparedRequest,
  type ResolvedTextBackend,
  type TextAdapter,
  type TextPrompt
} from './types'

/** KoboldCpp's native KoboldAI API (text completion, SSE streaming). */
function prepare(b: ResolvedTextBackend, p: TextPrompt, stream: boolean): PreparedRequest {
  const g = b.generation
  const user = p.userLabel ?? 'Player'
  const stop = [...stopSequences(b, p), `\n${user}:`]
  const body = {
    prompt: flattenPrompt(p),
    max_length: p.maxTokens ?? g.maxTokens,
    max_context_length: g.contextSize,
    ...nonNull({
      temperature: g.temperature,
      top_p: g.topP,
      top_k: g.topK,
      min_p: g.minP,
      rep_pen: g.repetitionPenalty
    }),
    stop_sequence: stop,
    trim_stop: true
  }
  const path = stream ? '/api/extra/generate/stream' : '/api/v1/generate'
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (b.key) headers.Authorization = `Bearer ${b.key}`
  return { url: `${requireBase(b)}${path}`, method: 'POST', headers: { ...headers, ...b.net.headers }, body: deepMerge(body, extraBody(b)) }
}

export const koboldAdapter: TextAdapter = {
  prepare,
  async generate(b, p, opts) {
    const stream = opts.stream ?? b.generation.stream
    const req = prepare(b, p, stream)
    const started = Date.now()
    // KoboldCpp keeps generating after a disconnect; ask it to stop too.
    const onAbort = (): void => {
      void undiciFetch(`${requireBase(b)}/api/extra/abort`, {
        method: 'POST',
        headers: req.headers,
        body: '{}',
        dispatcher: getDispatcher(b.net)
      }).catch(() => {})
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const { res, deadline } = await request(b.net, {
        url: req.url,
        headers: req.headers,
        body: JSON.stringify(req.body),
        signal: opts.signal
      })
      if (!stream) {
        const json = (await readJson(res, deadline)) as { results?: { text?: string; finish_reason?: string }[] }
        return { text: json.results?.[0]?.text ?? '', stopReason: json.results?.[0]?.finish_reason }
      }
      const parser = new SseParser()
      let text = ''
      let firstTokenMs: number | undefined
      const handle = (data: string): void => {
        try {
          const token = (JSON.parse(data) as { token?: string }).token ?? ''
          if (token) {
            firstTokenMs ??= Date.now() - started
            text += token
            opts.onToken?.(token)
          }
        } catch {
          /* keep-alive or malformed line */
        }
      }
      for await (const chunk of readTextStream(res, deadline)) for (const ev of parser.feed(chunk)) handle(ev.data)
      for (const ev of parser.end()) handle(ev.data)
      return { text, firstTokenMs }
    } finally {
      opts.signal?.removeEventListener('abort', onAbort)
    }
  },
  async listModels(b, signal) {
    const { res, deadline } = await request(b.net, { url: `${requireBase(b)}/api/v1/model`, signal })
    const json = (await readJson(res, deadline)) as { result?: string }
    return json.result ? [json.result] : []
  }
}
