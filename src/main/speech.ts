import { AppError } from './errors'
import { request } from './http'
import { settingsStore } from './settings-store'

const MAX_CHARS = 4000

/**
 * Turns text into speech with an OpenAI-compatible server:
 * POST {baseUrl}/v1/audio/speech, answered with an mp3.
 * The renderer can't call outside servers itself (its CSP only allows the app).
 */
export async function synthesize(text: string): Promise<Uint8Array> {
  const tts = settingsStore.get().tts
  if (tts.mode !== 'server') throw new AppError('TTS_NOT_SERVER', 'Speech is set to use this computer’s voices.')
  const base = tts.baseUrl.trim().replace(/\/+$/, '')
  if (!base) throw new AppError('NO_BASE_URL', 'Set the speech server URL in Settings → Speech.')
  const input = text.slice(0, MAX_CHARS)
  const { res, deadline } = await request(
    { headers: {}, proxy: '', allowSelfSigned: false, timeoutMs: 120_000, retries: 1 },
    {
      url: `${base}/v1/audio/speech`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: tts.model, input, voice: tts.voice || 'alloy', speed: tts.speed, response_format: 'mp3' })
    }
  )
  try {
    return new Uint8Array(await res.arrayBuffer())
  } finally {
    deadline.clear()
  }
}
