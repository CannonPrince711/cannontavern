import { readJson, request } from '../../http'
import { buildOpenAiRequest, listOpenAiModels, runOpenAi } from './openai'
import { requireBase, type ResolvedTextBackend, type TextAdapter } from './types'

/**
 * text-generation-webui serves an OpenAI-compatible API at /v1 (and accepts
 * its own sampler fields like min_p and repetition_penalty).
 */
function v1(b: ResolvedTextBackend): string {
  const base = requireBase(b)
  return base.endsWith('/v1') ? base : `${base}/v1`
}

export const textgenAdapter: TextAdapter = {
  prepare: (b, p, stream) => buildOpenAiRequest(b, p, stream, v1(b)),
  generate: (b, p, opts) => {
    const stream = opts.stream ?? b.generation.stream
    return runOpenAi(b, buildOpenAiRequest(b, p, stream, v1(b)), stream, opts)
  },
  async listModels(b, signal) {
    try {
      const headers: Record<string, string> = b.key ? { Authorization: `Bearer ${b.key}` } : {}
      const { res, deadline } = await request(b.net, { url: `${v1(b)}/internal/model/list`, headers, signal })
      const json = (await readJson(res, deadline)) as { model_names?: string[] }
      if (json.model_names?.length) return [...json.model_names].sort()
    } catch {
      /* older builds: fall back to /models */
    }
    return listOpenAiModels(b, v1(b), signal)
  }
}
