import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { TextBackendSchema } from '@shared/settings'
import { anthropicAdapter, toAnthropicMessages } from '../src/main/backends/text/anthropic'
import { customAdapter } from '../src/main/backends/text/custom'
import { koboldAdapter } from '../src/main/backends/text/kobold'
import { ollamaAdapter } from '../src/main/backends/text/ollama'
import { openAiAdapter } from '../src/main/backends/text/openai'
import type { ResolvedTextBackend, TextPrompt } from '../src/main/backends/text/types'

type Handler = (req: IncomingMessage, body: string, res: ServerResponse) => void

let server: Server
let base: string
let handler: Handler
const seen: { method: string; url: string; headers: IncomingMessage['headers']; body: unknown }[] = []

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      let parsed: unknown = body
      try {
        parsed = JSON.parse(body)
      } catch {
        /* raw */
      }
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: parsed })
      handler(req, body, res)
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => new Promise<void>((r) => server.close(() => r())))
beforeEach(() => {
  seen.length = 0
})

function backend(over: Record<string, unknown>): ResolvedTextBackend {
  const b = TextBackendSchema.parse({ id: 't', name: 'Test', type: 'openai', baseUrl: base, model: 'm', ...over })
  return {
    ...b,
    key: (over.key as string) ?? 'sk-test-key-123456',
    net: { headers: { 'X-Custom': 'yes' }, proxy: '', allowSelfSigned: false, timeoutMs: 5000, retries: 0 }
  }
}

const prompt: TextPrompt = {
  system: 'You are the DM.',
  messages: [
    { role: 'user', content: 'I open the door.' },
    { role: 'assistant', content: 'It creaks.' },
    { role: 'user', content: 'I step inside.' }
  ]
}

function sse(res: ServerResponse, events: string[]): void {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' })
  for (const e of events) res.write(e)
  res.end()
}

describe('OpenAI-compatible adapter', () => {
  it('sends chat completions with only the sampler values that are set', async () => {
    handler = (_req, _body, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ model: 'm', choices: [{ message: { content: 'The hall is dark.' }, finish_reason: 'stop' }] }))
    }
    const b = backend({ generation: { stream: false, temperature: 0.5, topK: 40, stop: ['\nPlayer:'], extraBody: '{"seed": 7}' } })
    const r = await openAiAdapter.generate(b, prompt, {})
    expect(r.text).toBe('The hall is dark.')
    const req = seen[0]!
    expect(req.url).toBe('/chat/completions')
    expect(req.headers.authorization).toBe('Bearer sk-test-key-123456')
    expect(req.headers['x-custom']).toBe('yes')
    expect(req.body).toMatchObject({
      model: 'm',
      stream: false,
      max_tokens: 800,
      temperature: 0.5,
      top_k: 40,
      stop: ['\nPlayer:'],
      seed: 7,
      messages: [{ role: 'system', content: 'You are the DM.' }, ...prompt.messages]
    })
    expect(req.body).not.toHaveProperty('top_p')
    expect(req.body).not.toHaveProperty('min_p')
  })

  it('streams SSE deltas until [DONE]', async () => {
    handler = (_req, _body, res) =>
      sse(res, [
        'data: {"model":"m","choices":[{"delta":{"content":"The "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"hall"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n'
      ])
    const tokens: string[] = []
    const r = await openAiAdapter.generate(backend({}), prompt, { onToken: (t) => tokens.push(t) })
    expect(tokens).toEqual(['The ', 'hall'])
    expect(r).toMatchObject({ text: 'The hall', model: 'm', stopReason: 'stop' })
    expect(r.firstTokenMs).toBeGreaterThanOrEqual(0)
  })

  it('turns HTTP errors into readable messages with the API message', async () => {
    handler = (_req, _body, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'Invalid API key sk-test-key-123456' } }))
    }
    const err = await openAiAdapter.generate(backend({ generation: { stream: false } }), prompt, {}).catch((e) => e)
    expect(err.code).toBe('AUTH')
    expect(err.message).toMatch(/rejected the credentials/)
  })

  it('retries 503 responses before giving up', async () => {
    let calls = 0
    handler = (_req, _body, res) => {
      calls++
      if (calls < 3) {
        res.writeHead(503, { 'Retry-After': '0' })
        res.end('busy')
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }))
      }
    }
    const b = backend({ generation: { stream: false } })
    b.net.retries = 2
    expect((await openAiAdapter.generate(b, prompt, {})).text).toBe('ok')
    expect(calls).toBe(3)
  })

  it('explains a refused connection', async () => {
    // A port that was just free: open a server, note its port, close it.
    const tmp = createServer()
    await new Promise<void>((r) => tmp.listen(0, '127.0.0.1', r))
    const port = (tmp.address() as AddressInfo).port
    await new Promise<void>((r) => tmp.close(() => r()))
    const b = backend({ baseUrl: `http://127.0.0.1:${port}`, generation: { stream: false } })
    const err = await openAiAdapter.generate(b, prompt, {}).catch((e) => e)
    expect(err.code).toBe('CONNECT_REFUSED')
  })

  it('can be stopped mid-stream', async () => {
    handler = (_req, _body, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('data: {"choices":[{"delta":{"content":"a"}}]}\n\n')
      // never ends
    }
    const ctrl = new AbortController()
    const err = await openAiAdapter
      .generate(backend({}), prompt, { signal: ctrl.signal, onToken: () => ctrl.abort() })
      .catch((e) => e)
    expect(err.code).toBe('ABORTED')
  })

  it('lists models', async () => {
    handler = (_req, _body, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'b-model' }, { id: 'a-model' }] }))
    }
    expect(await openAiAdapter.listModels(backend({}))).toEqual(['a-model', 'b-model'])
    expect(seen[0]!.url).toBe('/models')
  })
})

describe('Ollama adapter', () => {
  it('streams NDJSON from /api/chat with options', async () => {
    handler = (_req, _body, res) => {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
      res.write('{"model":"llama3","message":{"content":"Ro"}}\n{"message":{"content":"ll"}}\n')
      res.end('{"done":true,"done_reason":"stop"}\n')
    }
    const r = await ollamaAdapter.generate(backend({ type: 'ollama', model: 'llama3', key: '' }), prompt, {})
    expect(r).toMatchObject({ text: 'Roll', model: 'llama3', stopReason: 'stop' })
    expect(seen[0]!.url).toBe('/api/chat')
    expect(seen[0]!.body).toMatchObject({ options: { num_predict: 800, num_ctx: 16384, temperature: 0.9 } })
    expect(seen[0]!.headers.authorization).toBeUndefined()
  })
})

describe('KoboldCpp adapter', () => {
  it('flattens the chat into a prompt and reads the result', async () => {
    handler = (_req, _body, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ results: [{ text: ' You see a lantern.' }] }))
    }
    const r = await koboldAdapter.generate(backend({ type: 'koboldcpp', generation: { stream: false } }), prompt, {})
    expect(r.text).toBe(' You see a lantern.')
    const body = seen[0]!.body as { prompt: string; stop_sequence: string[] }
    expect(seen[0]!.url).toBe('/api/v1/generate')
    expect(body.prompt).toBe('You are the DM.\n\nPlayer: I open the door.\nDM: It creaks.\nPlayer: I step inside.\nDM:')
    expect(body.stop_sequence).toContain('\nPlayer:')
  })
})

describe('Custom adapter', () => {
  it('renders the body template and reads the reply by JSONPath', async () => {
    handler = (_req, _body, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ output: { parts: ['Hello', 'there'] } }))
    }
    const b = backend({
      type: 'custom',
      generation: { stream: false },
      custom: {
        url: `${base}/gen`,
        bodyTemplate: '{"q":"{{prompt}}","n":{{max_tokens}},"msgs":{{messages_json}}}',
        responsePath: '$.output.parts[1]'
      }
    })
    expect((await customAdapter.generate(b, prompt, {})).text).toBe('there')
    const body = seen[0]!.body as { q: string; n: number; msgs: unknown[] }
    expect(seen[0]!.url).toBe('/gen')
    expect(body.n).toBe(800)
    expect(body.msgs).toHaveLength(4)
    expect(body.q).toContain('Player: I step inside.')
  })

  it('streams with an SSE parser and a stream path', async () => {
    handler = (_req, _body, res) => sse(res, ['data: {"t":"a"}\n\n', 'data: {"t":"b"}\n\n'])
    const b = backend({
      type: 'custom',
      custom: { url: `${base}/s`, bodyTemplate: '{}', streamParser: 'sse', streamPath: '$.t' }
    })
    expect((await customAdapter.generate(b, prompt, {})).text).toBe('ab')
  })

  it('reports templates that are not valid JSON', async () => {
    const b = backend({ type: 'custom', custom: { url: `${base}/x`, bodyTemplate: '{"a": {{nope}}' } })
    const err = await customAdapter.generate(b, prompt, {}).catch((e) => e)
    expect(err.code).toBe('BAD_TEMPLATE')
  })
})

describe('Anthropic adapter (SDK against a mock server)', () => {
  const anthropicStream = (text: string): string[] => [
    'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-opus-5-5","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":0}}}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
    `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":${JSON.stringify(text)}}}\n\n`,
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":5}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n'
  ]

  it('sends a Messages request without sampling params for Claude 5 models', async () => {
    handler = (_req, _body, res) => sse(res, anthropicStream('Welcome, traveller.'))
    const tokens: string[] = []
    const b = backend({ type: 'anthropic', model: 'claude-opus-5-5', generation: { temperature: 0.9, topP: 0.9 } })
    const r = await anthropicAdapter.generate(b, prompt, { onToken: (t) => tokens.push(t) })
    expect(r).toMatchObject({ text: 'Welcome, traveller.', model: 'claude-opus-5-5', stopReason: 'end_turn' })
    expect(tokens.join('')).toBe('Welcome, traveller.')
    const req = seen[0]!
    expect(req.url).toBe('/v1/messages')
    expect(req.headers['x-api-key']).toBe('sk-test-key-123456')
    expect(req.headers['anthropic-version']).toBeTruthy()
    // Not api.anthropic.com → no fallback beta.
    expect(req.headers['anthropic-beta']).toBeUndefined()
    expect(req.body).toMatchObject({ model: 'claude-opus-5-5', system: 'You are the DM.', max_tokens: 800, stream: true })
    expect(req.body).not.toHaveProperty('temperature')
    expect(req.body).not.toHaveProperty('top_p')
    expect(req.body).not.toHaveProperty('fallbacks')
  })

  it('keeps sampling params for older Claude models', async () => {
    handler = (_req, _body, res) => sse(res, anthropicStream('ok'))
    await anthropicAdapter.generate(backend({ type: 'anthropic', model: 'claude-haiku-4-5', generation: { temperature: 1.5 } }), prompt, {})
    expect(seen[0]!.body).toMatchObject({ temperature: 1 })
  })

  it('maps API errors to readable messages', async () => {
    handler = (_req, _body, res) => {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'model: nope' } }))
    }
    const err = await anthropicAdapter.generate(backend({ type: 'anthropic', model: 'nope' }), prompt, {}).catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
    expect(err.message).toMatch(/model: nope/)
  })

  it('shapes the conversation for the Messages API', () => {
    expect(
      toAnthropicMessages(
        [
          { role: 'assistant', content: 'Greetings.' },
          { role: 'system', content: 'Roll: 17' },
          { role: 'user', content: 'I attack.' },
          { role: 'assistant', content: 'You swing' }
        ],
        'claude-opus-5-5'
      )
    ).toEqual([
      { role: 'user', content: '[The scene begins.]' },
      { role: 'assistant', content: 'Greetings.' },
      { role: 'user', content: '[Roll: 17]\n\nI attack.' },
      { role: 'assistant', content: 'You swing' },
      { role: 'user', content: '[Continue your previous reply exactly where it stopped. Do not repeat it.]' }
    ])
  })
})

describe('thinking models', () => {
  it('asks self-hosted servers to skip hidden thinking unless it is on', () => {
    const off = openAiAdapter.prepare(backend({}), prompt, false)
    expect(off.body).toMatchObject({ chat_template_kwargs: { enable_thinking: false } })
    const on = openAiAdapter.prepare(backend({ generation: { thinking: true } }), prompt, false)
    expect(on.body).not.toHaveProperty('chat_template_kwargs')
    const hosted = openAiAdapter.prepare(backend({ baseUrl: 'https://openrouter.ai/api/v1' }), prompt, false)
    expect(hosted.body).not.toHaveProperty('chat_template_kwargs')
  })

  it('notices a reply that was all thinking', async () => {
    handler = (_req, _body, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('data: {"choices":[{"delta":{"reasoning_content":"Hmm, the alley…"}}]}\n\n')
      res.write('data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n')
      res.end('data: [DONE]\n\n')
    }
    const r = await openAiAdapter.generate(backend({}), prompt, { stream: true })
    expect(r).toMatchObject({ text: '', stopReason: 'length', reasoned: true })
  })
})
