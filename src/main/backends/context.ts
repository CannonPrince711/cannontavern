/**
 * The context window a self-hosted server actually loaded. The backend's
 * "Context size" setting is what DND Tavern plans for, but servers such as
 * KoboldCpp fix their window at launch (--contextsize, 4096 by default), and a
 * prompt planned for a bigger window gets silently cut. Asking the server and
 * using the smaller of the two avoids that.
 */
import type { TextBackend } from '@shared/settings'
import { readJson, request } from '../http'
import { resolveTextBackend } from './text'
import type { ResolvedTextBackend } from './text/types'

const HOSTED = /(^|\.)(openai\.com|anthropic\.com|openrouter\.ai|groq\.com|together\.xyz|deepseek\.com|mistral\.ai|googleapis\.com|x\.ai|fireworks\.ai)$/i
const TTL = 10 * 60_000
// A server that didn't answer may just be starting up: ask again sooner.
const MISS_TTL = 60_000
const cache = new Map<string, { at: number; found: ServerContext | null }>()

export interface ServerContext {
  tokens: number
  /** Which server said so. */
  server: 'KoboldCpp' | 'llama.cpp' | 'Ollama' | 'vLLM'
  /**
   * A fixed window that longer prompts can't use. Ollama's figure is only the
   * model's trained length: it loads whatever num_ctx a request asks for.
   */
  hard: boolean
}

function root(url: string): string {
  return url.trim().replace(/\/+$/, '').replace(/\/v1$/i, '')
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) && n >= 256 ? Math.floor(n) : null
}

/** Asks the server for its context window; null when it doesn't say (or it's a hosted API). */
export async function detectServerContext(b: ResolvedTextBackend, opts: { fresh?: boolean } = {}): Promise<ServerContext | null> {
  let host = ''
  try {
    host = new URL(b.baseUrl).hostname
  } catch {
    return null
  }
  if (b.type === 'anthropic' || HOSTED.test(host)) return null
  const key = `${root(b.baseUrl)}|${b.model}`
  const hit = cache.get(key)
  if (!opts.fresh && hit && Date.now() - hit.at < (hit.found ? TTL : MISS_TTL)) return hit.found

  const net = { ...b.net, retries: 0, timeoutMs: 4000 }
  const auth: Record<string, string> = b.key ? { Authorization: `Bearer ${b.key}` } : {}
  const base = root(b.baseUrl)
  const fetchJson = async (path: string, body?: unknown): Promise<unknown> => {
    const { res, deadline } = await request(net, {
      url: `${base}${path}`,
      headers: body === undefined ? auth : { ...auth, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) })
    })
    return readJson(res, deadline)
  }
  const found = (tokens: number | null, server: ServerContext['server'], hard = true): ServerContext | null => (tokens ? { tokens, server, hard } : null)
  const probes: (() => Promise<ServerContext | null>)[] = [
    // KoboldCpp, whichever of its APIs the backend talks to (it also emulates Ollama and OpenAI).
    async () => found(num(((await fetchJson('/api/extra/true_max_context_length')) as { value?: unknown }).value), 'KoboldCpp'),
    // llama.cpp server.
    async () => {
      const p = (await fetchJson('/props')) as { default_generation_settings?: { n_ctx?: unknown }; n_ctx?: unknown }
      return found(num(p.default_generation_settings?.n_ctx ?? p.n_ctx), 'llama.cpp')
    },
    // Ollama: the model's trained length (requests ask for num_ctx = the Context size setting).
    async () => {
      if (b.type !== 'ollama' || !b.model) return null
      const info = (await fetchJson('/api/show', { model: b.model })) as { model_info?: Record<string, unknown> }
      const entry = Object.entries(info.model_info ?? {}).find(([k]) => k.endsWith('.context_length'))
      return found(entry ? num(entry[1]) : null, 'Ollama', false)
    },
    // vLLM lists max_model_len with its models.
    async () => {
      const list = (await fetchJson('/v1/models')) as { data?: { id?: string; max_model_len?: unknown }[] }
      const m = list.data?.find((x) => x.id === b.model) ?? list.data?.[0]
      return found(m ? num(m.max_model_len) : null, 'vLLM')
    }
  ]
  // All at once (each gives up after a few seconds), first answer in the order above wins.
  const answers = await Promise.all(probes.map((probe) => probe().catch(() => null)))
  const result = answers.find((a) => a !== null) ?? null
  cache.set(key, { at: Date.now(), found: result })
  return result
}

/** The window to plan prompts for: the setting, capped by what the server loaded. */
export async function effectiveContext(b: TextBackend): Promise<number> {
  const setting = b.generation.contextSize || 8192
  const server = await detectServerContext(resolveTextBackend(b)).catch(() => null)
  return server?.hard ? Math.min(setting, server.tokens) : setting
}
