import { Agent, ProxyAgent, fetch as undiciFetch, type Dispatcher, type FormData, type Response } from 'undici'
import { socksDispatcher } from 'fetch-socks'
import { hostOf } from '@shared/net'
import { AppError } from './errors'
import { redact } from './redact'

/** Network settings shared by text and image backends, with secrets already resolved. */
export interface NetConfig {
  headers: Record<string, string>
  proxy: string
  allowSelfSigned: boolean
  timeoutMs: number
  retries: number
}

const dispatchers = new Map<string, Dispatcher>()

/** One dispatcher per (proxy, TLS) combination, reused across requests. */
export function getDispatcher(net: Pick<NetConfig, 'proxy' | 'allowSelfSigned'>): Dispatcher {
  const key = `${net.proxy}|${net.allowSelfSigned}`
  let d = dispatchers.get(key)
  if (d) return d
  const tls = net.allowSelfSigned ? { rejectUnauthorized: false } : {}
  if (!net.proxy) {
    d = new Agent({ connect: tls, keepAliveTimeout: 30_000 })
  } else {
    const proxy = new URL(net.proxy)
    if (proxy.protocol.startsWith('socks')) {
      d = socksDispatcher(
        {
          type: proxy.protocol === 'socks4:' ? 4 : 5,
          host: proxy.hostname,
          port: Number(proxy.port || 1080),
          userId: proxy.username ? decodeURIComponent(proxy.username) : undefined,
          password: proxy.password ? decodeURIComponent(proxy.password) : undefined
        },
        { connect: tls }
      )
    } else if (proxy.protocol === 'http:' || proxy.protocol === 'https:') {
      d = new ProxyAgent({ uri: proxy.href, requestTls: tls, proxyTls: tls })
    } else {
      throw new AppError('BAD_PROXY', `Unsupported proxy “${net.proxy}”. Use http://, https:// or socks5://.`)
    }
  }
  dispatchers.set(key, d)
  return d
}

/**
 * Aborts when the caller aborts, or when no progress has been reported for
 * `ms`. Streams call touch() on every chunk, so a slow-but-alive stream is
 * never cut off; a stalled one is.
 */
export class Deadline {
  readonly controller = new AbortController()
  private timer: NodeJS.Timeout | undefined
  timedOut = false

  constructor(
    private ms: number,
    parent?: AbortSignal
  ) {
    if (parent) {
      if (parent.aborted) this.controller.abort(parent.reason)
      else parent.addEventListener('abort', () => this.controller.abort(parent.reason), { once: true })
    }
    this.touch()
  }

  get signal(): AbortSignal {
    return this.controller.signal
  }

  touch(): void {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timedOut = true
      this.controller.abort(new Error('timeout'))
    }, this.ms)
  }

  clear(): void {
    clearTimeout(this.timer)
  }
}

export interface HttpRequest {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string | Uint8Array | FormData
  signal?: AbortSignal
}

const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])

/**
 * Sends a request with the backend's network settings. Retries connection
 * failures and retryable statuses (honouring Retry-After) before any body is
 * read. Non-2xx responses become an AppError with a readable message.
 * The returned Deadline must be touched while streaming and cleared at the end.
 */
export async function request(net: NetConfig, req: HttpRequest): Promise<{ res: Response; deadline: Deadline }> {
  const dispatcher = getDispatcher(net)
  let attempt = 0
  for (;;) {
    const deadline = new Deadline(net.timeoutMs, req.signal)
    try {
      const res = await undiciFetch(req.url, {
        method: req.method ?? (req.body ? 'POST' : 'GET'),
        headers: { ...net.headers, ...req.headers },
        body: req.body,
        signal: deadline.signal,
        dispatcher
      })
      if (res.ok) return { res, deadline }
      if (RETRY_STATUS.has(res.status) && attempt < net.retries && !req.signal?.aborted) {
        const wait = retryDelay(res.headers.get('retry-after'), attempt)
        await res.body?.cancel().catch(() => {})
        deadline.clear()
        await sleep(wait, req.signal)
        attempt++
        continue
      }
      const text = await res.text().catch(() => '')
      deadline.clear()
      throw httpError(req.url, res.status, text)
    } catch (err) {
      deadline.clear()
      if (err instanceof AppError) throw err
      if (req.signal?.aborted) throw new AppError('ABORTED', 'Stopped.')
      if (deadline.timedOut) {
        if (attempt < net.retries) {
          attempt++
          continue
        }
        throw new AppError('TIMEOUT', `${hostOf(req.url)} did not respond within ${Math.round(net.timeoutMs / 1000)} s.`)
      }
      const netErr = networkError(req.url, err)
      if (attempt < net.retries && netErr.code !== 'TLS_UNTRUSTED') {
        await sleep(retryDelay(null, attempt), req.signal)
        attempt++
        continue
      }
      throw netErr
    }
  }
}

/** Reads a streamed body as text chunks, touching the deadline as data arrives. */
export async function* readTextStream(res: Response, deadline: Deadline): AsyncGenerator<string> {
  if (!res.body) return
  const decoder = new TextDecoder()
  try {
    for await (const chunk of res.body) {
      deadline.touch()
      yield decoder.decode(chunk as Uint8Array, { stream: true })
    }
    const tail = decoder.decode()
    if (tail) yield tail
  } catch (err) {
    if (deadline.signal.aborted && !deadline.timedOut) throw new AppError('ABORTED', 'Stopped.')
    if (deadline.timedOut) throw new AppError('TIMEOUT', 'The stream stalled and timed out.')
    throw networkError(res.url, err)
  } finally {
    deadline.clear()
  }
}

export async function readJson(res: Response, deadline: Deadline): Promise<unknown> {
  try {
    const text = await res.text()
    try {
      return JSON.parse(text)
    } catch {
      throw new AppError('BAD_RESPONSE', 'The server did not return JSON.', redact(text.slice(0, 2000)))
    }
  } finally {
    deadline.clear()
  }
}

function retryDelay(retryAfter: string | null, attempt: number): number {
  const secs = retryAfter ? Number(retryAfter) : NaN
  if (Number.isFinite(secs)) return Math.min(10_000, Math.max(0, secs * 1000))
  return Math.min(8_000, 500 * 2 ** attempt)
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(new AppError('ABORTED', 'Stopped.'))
      },
      { once: true }
    )
  })
}

/** Turns an HTTP status + body into a readable error. */
export function httpError(url: string, status: number, body: string): AppError {
  const host = hostOf(url)
  const apiMessage = extractApiMessage(body)
  const detail = redact(`HTTP ${status} from ${url}\n\n${body.slice(0, 4000)}`)
  const suffix = apiMessage ? `: ${redact(apiMessage)}` : ''
  switch (status) {
    case 401:
    case 403:
      return new AppError('AUTH', `${host} rejected the credentials (HTTP ${status})${suffix}`, detail)
    case 404:
      return new AppError('NOT_FOUND', `${host} returned 404. Check the base URL and model name${suffix}`, detail)
    case 429:
      return new AppError('RATE_LIMIT', `${host} is rate limiting requests (HTTP 429)${suffix}`, detail)
    default:
      return new AppError(`HTTP_${status}`, `${host} returned HTTP ${status}${suffix}`, detail)
  }
}

function extractApiMessage(body: string): string {
  try {
    const json = JSON.parse(body) as Record<string, unknown>
    const err = json.error
    if (typeof err === 'string') return err
    if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
      return (err as { message: string }).message
    }
    if (typeof json.detail === 'string') return json.detail
    if (typeof json.message === 'string') return json.message
  } catch {
    /* not JSON */
  }
  return body.length < 200 ? body.trim() : ''
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID'
])

/** Explains connection-level failures (refused, DNS, TLS…). */
export function networkError(url: string, err: unknown): AppError {
  const host = hostOf(url)
  const cause = (err as { cause?: { code?: string; message?: string } })?.cause
  const code = cause?.code ?? (err as NodeJS.ErrnoException)?.code ?? ''
  const detail = redact(`${(err as Error)?.message ?? String(err)}${cause?.message ? `\n${cause.message}` : ''}`)
  if (/bad port/i.test(cause?.message ?? '')) {
    return new AppError('BAD_PORT', `Port ${safePort(url)} is blocked by the networking stack (it’s reserved for other protocols). Use a different port.`, detail)
  }
  if (TLS_CODES.has(code)) {
    return new AppError(
      'TLS_UNTRUSTED',
      `${host} uses a TLS certificate Windows doesn’t trust (${code}). If this is your own server, enable “Accept self-signed certificate”.`,
      detail
    )
  }
  switch (code) {
    case 'ECONNREFUSED':
      return new AppError('CONNECT_REFUSED', `Could not connect to ${host}. Is the server running and reachable?`, detail)
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return new AppError('DNS', `Host “${host}” was not found. Check the address (and VPN/Tailscale, if used).`, detail)
    case 'ETIMEDOUT':
    case 'UND_ERR_CONNECT_TIMEOUT':
      return new AppError('CONNECT_TIMEOUT', `Connecting to ${host} timed out.`, detail)
    case 'ECONNRESET':
    case 'UND_ERR_SOCKET':
      return new AppError('CONNECT_RESET', `The connection to ${host} was closed unexpectedly.`, detail)
    default:
      return new AppError('NETWORK', `Request to ${host} failed${code ? ` (${code})` : ''}.`, detail)
  }
}

function safePort(url: string): string {
  try {
    return new URL(url).port
  } catch {
    return '?'
  }
}
