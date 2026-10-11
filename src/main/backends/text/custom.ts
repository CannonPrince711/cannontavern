import { NdjsonParser, SseParser } from '@shared/streams'
import { getByPath, renderTemplate } from '@shared/template'
import { AppError } from '../../errors'
import { readJson, readTextStream, request } from '../../http'
import {
  deepMerge,
  extraBody,
  flattenPrompt,
  stopSequences,
  trimBase,
  type PreparedRequest,
  type ResolvedTextBackend,
  type TextAdapter,
  type TextPrompt
} from './types'

/** Response paths tried when the user leaves "reply JSONPath" empty. */
const COMMON_PATHS = [
  '$.choices[0].message.content',
  '$.choices[0].text',
  '$.content[0].text',
  '$.message.content',
  '$.results[0].text',
  '$.response',
  '$.output',
  '$.text'
]

function url(b: ResolvedTextBackend): string {
  const u = trimBase(b.custom.url || b.baseUrl)
  if (!u) throw new AppError('NO_BASE_URL', `“${b.name}” needs a request URL.`)
  return u
}

function prepare(b: ResolvedTextBackend, p: TextPrompt): PreparedRequest {
  const g = b.generation
  const messages = [...(p.system.trim() ? [{ role: 'system', content: p.system }] : []), ...p.messages]
  const rendered = renderTemplate(b.custom.bodyTemplate, {
    system: p.system,
    messages_json: messages,
    prompt: flattenPrompt(p),
    model: b.model,
    max_tokens: p.maxTokens ?? g.maxTokens,
    temperature: g.temperature ?? 0.8,
    stop_json: stopSequences(b, p)
  })
  let body: unknown = rendered
  if (rendered.trim()) {
    try {
      body = deepMerge(JSON.parse(rendered) as Record<string, unknown>, extraBody(b))
    } catch (err) {
      if (err instanceof AppError) throw err
      throw new AppError('BAD_TEMPLATE', 'The body template does not produce valid JSON.', rendered.slice(0, 2000))
    }
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (b.key) headers.Authorization = `Bearer ${b.key}`
  return { url: url(b), method: b.custom.method, headers: { ...headers, ...b.net.headers }, body }
}

function pickText(json: unknown, path: string): string {
  if (path.trim()) {
    const v = getByPath(json, path)
    return typeof v === 'string' ? v : v === undefined || v === null ? '' : JSON.stringify(v)
  }
  for (const p of COMMON_PATHS) {
    const v = getByPath(json, p)
    if (typeof v === 'string') return v
  }
  throw new AppError('BAD_RESPONSE', 'Could not find the reply in the response. Set “Reply JSONPath”.', JSON.stringify(json).slice(0, 2000))
}

export const customAdapter: TextAdapter = {
  prepare: (b, p) => prepare(b, p),
  async generate(b, p, opts) {
    const req = prepare(b, p)
    const stream = (opts.stream ?? b.generation.stream) && b.custom.streamParser !== 'none'
    const started = Date.now()
    const { res, deadline } = await request(b.net, {
      url: req.url,
      method: req.method,
      headers: req.headers,
      body: req.method === 'GET' ? undefined : typeof req.body === 'string' ? req.body : JSON.stringify(req.body),
      signal: opts.signal
    })
    if (!stream) return { text: pickText(await readJson(res, deadline), b.custom.responsePath) }

    let text = ''
    let firstTokenMs: number | undefined
    const path = b.custom.streamPath || '$.choices[0].delta.content'
    const emit = (value: unknown): void => {
      const delta = getByPath(value, path)
      if (typeof delta === 'string' && delta) {
        firstTokenMs ??= Date.now() - started
        text += delta
        opts.onToken?.(delta)
      }
    }
    if (b.custom.streamParser === 'sse') {
      const parser = new SseParser()
      const handle = (data: string): void => {
        if (data.trim() === '[DONE]') return
        try {
          emit(JSON.parse(data))
        } catch {
          /* non-JSON keep-alive */
        }
      }
      for await (const chunk of readTextStream(res, deadline)) for (const ev of parser.feed(chunk)) handle(ev.data)
      for (const ev of parser.end()) handle(ev.data)
    } else {
      const parser = new NdjsonParser()
      for await (const chunk of readTextStream(res, deadline)) parser.feed(chunk).values.forEach(emit)
      parser.end().values.forEach(emit)
    }
    return { text, firstTokenMs }
  },
  async listModels() {
    return []
  }
}
