import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { TextBackendSchema } from '@shared/settings'
import type { ResolvedTextBackend } from '../src/main/backends/text/types'

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))
const { detectServerContext } = await import('../src/main/backends/context')

// Each test gets its own route table; the path prefix keeps the cache keys apart.
let routes: Record<string, Record<string, unknown>> = {}
let server: Server
let base: string

beforeAll(async () => {
  server = createServer((req, res) => {
    const [, prefix, ...rest] = (req.url ?? '').split('/')
    const body = routes[prefix!]?.[`/${rest.join('/')}`]
    res.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body ?? { error: 'not found' }))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>((r) => server.close(() => r())))

function backend(prefix: string, over: Record<string, unknown> = {}): ResolvedTextBackend {
  const b = TextBackendSchema.parse({ id: prefix, name: 'Test', type: 'openai', baseUrl: `${base}/${prefix}/v1`, model: 'm', ...over })
  return { ...b, key: '', net: { headers: {}, proxy: '', allowSelfSigned: false, timeoutMs: 5000, retries: 0 } }
}

describe('server context detection', () => {
  it('reads KoboldCpp’s loaded window, whatever API the backend uses', async () => {
    routes = { kobold: { '/api/extra/true_max_context_length': { value: 8192 } } }
    expect(await detectServerContext(backend('kobold', { type: 'ollama' }))).toEqual({ tokens: 8192, server: 'KoboldCpp', hard: true })
  })

  it('reads llama.cpp and vLLM', async () => {
    routes = { llama: { '/props': { default_generation_settings: { n_ctx: 4096 } } }, vllm: { '/v1/models': { data: [{ id: 'm', max_model_len: 32768 }] } } }
    expect(await detectServerContext(backend('llama'))).toMatchObject({ tokens: 4096, server: 'llama.cpp' })
    expect(await detectServerContext(backend('vllm'))).toMatchObject({ tokens: 32768, server: 'vLLM' })
  })

  it('treats Ollama’s figure as the model’s trained length, not a hard limit', async () => {
    routes = { ollama: { '/api/show': { model_info: { 'llama.context_length': 4096 } } } }
    expect(await detectServerContext(backend('ollama', { type: 'ollama' }))).toEqual({ tokens: 4096, server: 'Ollama', hard: false })
  })

  it('returns null when the server says nothing, and skips hosted APIs', async () => {
    routes = {}
    expect(await detectServerContext(backend('silent'))).toBeNull()
    expect(await detectServerContext({ ...backend('x'), baseUrl: 'https://api.openai.com/v1' })).toBeNull()
  })
})
