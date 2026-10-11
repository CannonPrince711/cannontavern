import { getByPath, renderTemplate } from '@shared/template'
import { AppError } from '../../errors'
import { readJson, request } from '../../http'
import { randomSeed, sniffExt, type ImageAdapter, type ImageResult, type ResolvedImageBackend } from './types'

function base(b: ResolvedImageBackend): string {
  const u = b.baseUrl.trim().replace(/\/+$/, '')
  if (!u) throw new AppError('NO_BASE_URL', `“${b.name}” has no base URL.`)
  return u
}

function auth(b: ResolvedImageBackend): Record<string, string> {
  return b.key ? { Authorization: `Bearer ${b.key}` } : {}
}

function decodeImage(value: string): Buffer {
  const b64 = value.replace(/^data:image\/[a-z]+;base64,/, '')
  return Buffer.from(b64, 'base64')
}

async function download(b: ResolvedImageBackend, url: string, signal?: AbortSignal): Promise<Buffer> {
  const { res, deadline } = await request(b.net, { url, signal })
  try {
    return Buffer.from(await res.arrayBuffer())
  } finally {
    deadline.clear()
  }
}

/** Automatic1111 / Forge: /sdapi/v1/txt2img and /img2img, progress from /sdapi/v1/progress. */
export const a1111Adapter: ImageAdapter = {
  async generate(b, req, opts) {
    const root = base(b)
    const seed = req.seed >= 0 ? req.seed : randomSeed()
    const body: Record<string, unknown> = {
      prompt: req.prompt,
      negative_prompt: req.negative,
      width: req.width,
      height: req.height,
      steps: req.steps,
      cfg_scale: req.cfg,
      sampler_name: req.sampler || undefined,
      seed,
      n_iter: 1,
      batch_size: 1
    }
    let path = '/sdapi/v1/txt2img'
    if (req.source) {
      path = '/sdapi/v1/img2img'
      body.init_images = [req.source.data.toString('base64')]
      body.denoising_strength = 0.55
    }
    let done = false
    const poll = (async () => {
      while (!done && !opts.signal?.aborted) {
        await new Promise((r) => setTimeout(r, 800))
        try {
          const { res, deadline } = await request({ ...b.net, retries: 0, timeoutMs: 5000 }, { url: `${root}/sdapi/v1/progress?skip_current_image=true`, headers: auth(b) })
          const p = (await readJson(res, deadline)) as { progress?: number; state?: { sampling_step?: number; sampling_steps?: number } }
          if (!done && typeof p.progress === 'number') opts.onProgress?.(p.progress, p.state?.sampling_steps ? `Step ${p.state.sampling_step}/${p.state.sampling_steps}` : undefined)
        } catch {
          /* progress is best-effort */
        }
      }
    })()
    const onAbort = (): void => void request(b.net, { url: `${root}/sdapi/v1/interrupt`, method: 'POST', headers: auth(b), body: '' }).catch(() => {})
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const { res, deadline } = await request({ ...b.net, timeoutMs: Math.max(b.net.timeoutMs, 300_000) }, {
        url: `${root}${path}`,
        headers: { 'Content-Type': 'application/json', ...auth(b) },
        body: JSON.stringify(body),
        signal: opts.signal
      })
      const json = (await readJson(res, deadline)) as { images?: string[]; info?: string }
      const first = json.images?.[0]
      if (!first) throw new AppError('A1111_NO_IMAGE', 'The server returned no image.')
      const data = decodeImage(first)
      let finalSeed = seed
      try {
        finalSeed = (JSON.parse(json.info ?? '{}') as { seed?: number }).seed ?? seed
      } catch {
        /* keep requested seed */
      }
      return { data, ext: sniffExt(data), seed: finalSeed }
    } finally {
      done = true
      opts.signal?.removeEventListener('abort', onAbort)
      await poll
    }
  }
}

/** OpenAI-compatible /images/generations (OpenAI, and servers that copy it). */
export const openAiImageAdapter: ImageAdapter = {
  async generate(b, req, opts) {
    const root = base(b)
    const model = b.openai.model
    const body: Record<string, unknown> = {
      model,
      prompt: req.prompt,
      n: 1,
      size: b.openai.size || `${req.width}x${req.height}`,
      ...(b.openai.quality ? { quality: b.openai.quality } : {}),
      // dall-e models return URLs unless asked; gpt-image models always return base64.
      ...(/dall-e/i.test(model) ? { response_format: 'b64_json' } : {})
    }
    opts.onProgress?.(0.1, 'Generating…')
    const { res, deadline } = await request({ ...b.net, timeoutMs: Math.max(b.net.timeoutMs, 300_000) }, {
      url: `${root}/images/generations`,
      headers: { 'Content-Type': 'application/json', ...auth(b) },
      body: JSON.stringify(body),
      signal: opts.signal
    })
    const json = (await readJson(res, deadline)) as { data?: { b64_json?: string; url?: string }[] }
    const item = json.data?.[0]
    let data: Buffer
    if (item?.b64_json) data = decodeImage(item.b64_json)
    else if (item?.url) data = await download(b, item.url, opts.signal)
    else throw new AppError('OPENAI_NO_IMAGE', 'The server returned no image.')
    return { data, ext: sniffExt(data) }
  }
}

/** Custom: URL + body template + JSONPath to an image URL or base64 string. */
export const customImageAdapter: ImageAdapter = {
  async generate(b, req, opts) {
    const url = (b.custom.url || b.baseUrl).trim()
    if (!url) throw new AppError('NO_BASE_URL', `“${b.name}” needs a request URL.`)
    const seed = req.seed >= 0 ? req.seed : randomSeed()
    const rendered = renderTemplate(b.custom.bodyTemplate, {
      prompt: req.prompt,
      negative: req.negative,
      width: req.width,
      height: req.height,
      steps: req.steps,
      cfg: req.cfg,
      seed,
      sampler: req.sampler
    })
    opts.onProgress?.(0.1, 'Generating…')
    const { res, deadline } = await request({ ...b.net, timeoutMs: Math.max(b.net.timeoutMs, 300_000) }, {
      url,
      method: b.custom.method,
      headers: { 'Content-Type': 'application/json', ...auth(b) },
      body: b.custom.method === 'GET' ? undefined : rendered,
      signal: opts.signal
    })
    const type = res.headers.get('content-type') ?? ''
    let data: Buffer
    if (type.startsWith('image/')) {
      data = Buffer.from(await res.arrayBuffer())
      deadline.clear()
    } else {
      const json = await readJson(res, deadline)
      const value = getByPath(json, b.custom.imagePath || '$.images[0]')
      if (typeof value !== 'string' || !value) {
        throw new AppError('CUSTOM_NO_IMAGE', `Nothing found at ${b.custom.imagePath || '$.images[0]'} in the response.`, JSON.stringify(json).slice(0, 2000))
      }
      data = b.custom.resultKind === 'url' || /^https?:\/\//.test(value) ? await download(b, value, opts.signal) : decodeImage(value)
    }
    const result: ImageResult = { data, ext: sniffExt(data), seed }
    return result
  }
}
