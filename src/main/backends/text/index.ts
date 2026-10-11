import type { TextBackend, TextBackendInput, TextBackendType } from '@shared/settings'
import type { TestResult } from '@shared/types'
import { toErrorInfo } from '../../errors'
import { redact } from '../../redact'
import { reveal } from '../../secrets'
import { netFromInput, netFromStored, revealInput } from '../resolve'
import { anthropicAdapter } from './anthropic'
import { customAdapter } from './custom'
import { koboldAdapter } from './kobold'
import { ollamaAdapter } from './ollama'
import { openAiAdapter } from './openai'
import { textgenAdapter } from './textgen'
import type { PreparedRequest, ResolvedTextBackend, TextAdapter } from './types'
import { detectServerContext, type ServerContext } from '../context'

const ADAPTERS: Record<TextBackendType, TextAdapter> = {
  openai: openAiAdapter,
  anthropic: anthropicAdapter,
  ollama: ollamaAdapter,
  koboldcpp: koboldAdapter,
  'textgen-webui': textgenAdapter,
  custom: customAdapter
}

export function textAdapter(type: TextBackendType): TextAdapter {
  return ADAPTERS[type]
}

export function resolveTextBackend(b: TextBackend): ResolvedTextBackend {
  return { ...b, key: reveal(b.apiKey), net: netFromStored(b.network) }
}

/** Resolves an unsaved form from the renderer ("keep" secrets come from the stored copy). */
export function resolveTextInput(input: TextBackendInput, stored: TextBackend | undefined): ResolvedTextBackend {
  const backend = {
    ...input,
    apiKey: { kind: 'none' as const },
    network: { ...input.network, headers: [] }
  } satisfies TextBackend
  return { ...backend, key: revealInput(input.apiKey, stored?.apiKey), net: netFromInput(input.network, stored?.network) }
}

/** Sends a tiny request and reports latency, first tokens or the full error. */
export async function testTextBackend(b: ResolvedTextBackend): Promise<TestResult> {
  const started = Date.now()
  try {
    const result = await textAdapter(b.type).generate(
      b,
      {
        system: 'You are a connection test. Answer in at most five words.',
        messages: [{ role: 'user', content: 'Say: The tavern doors are open.' }],
        maxTokens: 64
      },
      { stream: b.generation.stream }
    )
    const ms = Date.now() - started
    const sample = result.text.trim()
      ? result.text.trim().slice(0, 200)
      : `(connected, but no text came back${result.stopReason ? `; stop reason: ${result.stopReason}` : ''})`
    const server = await detectServerContext(b, { fresh: true }).catch(() => null)
    const parts = [
      result.model && `model ${result.model}`,
      result.firstTokenMs !== undefined && `first token ${result.firstTokenMs} ms`,
      server && `${server.server} context ${server.tokens.toLocaleString('en-US')} tokens`
    ]
    return {
      ok: true,
      ms,
      sample: parts.some(Boolean) ? `${sample}\n${parts.filter(Boolean).join(' · ')}` : sample,
      ...(server ? { serverContext: server.tokens } : {}),
      ...(server && server.tokens < b.generation.contextSize ? { notice: contextNotice(server, b.generation.contextSize) } : {})
    }
  } catch (err) {
    return { ok: false, ms: Date.now() - started, error: toErrorInfo(err) }
  }
}

function contextNotice(server: ServerContext, setting: number): string {
  const n = (v: number): string => v.toLocaleString('en-US')
  if (!server.hard) {
    return `This model was trained on ${n(server.tokens)} tokens of context. Ollama will load the ${n(setting)} you set, but replies may get worse past ${n(server.tokens)}.`
  }
  const flag = { KoboldCpp: '--contextsize', 'llama.cpp': '--ctx-size', vLLM: '--max-model-len', Ollama: '' }[server.server]
  return `The server loaded a context window of ${n(server.tokens)} tokens, less than this backend’s Context size (${n(setting)}), so DND Tavern will fit prompts into ${n(server.tokens)}. To get more, restart ${server.server} with a bigger ${flag} (e.g. ${flag} ${Math.min(server.tokens * 2, setting)}), then set Context size to match.`
}

/** The request as the prompt inspector shows it: every secret masked. */
export function redactRequest(req: PreparedRequest): PreparedRequest {
  const SENSITIVE = /^(authorization|x-api-key|api-key|cookie|cf-access-client-secret|proxy-authorization)$/i
  const headers = Object.fromEntries(
    Object.entries(req.headers).map(([k, v]) => [k, SENSITIVE.test(k) ? '••••••' : redact(v)])
  )
  return { ...req, url: redact(req.url), headers, body: JSON.parse(redact(JSON.stringify(req.body ?? null))) }
}
