import { AppError } from './errors'
import { request } from './http'
import type { VaultPath } from '@shared/types'
import { readCharacter } from './library'
import { settingsStore } from './settings-store'
import { vaultService } from './vault/service'
import { campaignOfSession, worldOf } from './world'

const MAX_CHARS = 4000

/**
 * Turns text into speech with an OpenAI-compatible server:
 * POST {baseUrl}/v1/audio/speech, answered with an mp3.
 * The renderer can't call outside servers itself (its CSP only allows the app).
 */
export async function synthesize(text: string, voiceOverride?: string): Promise<Uint8Array> {
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
      body: JSON.stringify({ model: tts.model, input, voice: voiceOverride?.trim() || tts.voice || 'alloy', speed: tts.speed, response_format: 'mp3' })
    }
  )
  try {
    return new Uint8Array(await res.arrayBuffer())
  } finally {
    deadline.clear()
  }
}

/**
 * The voice for a message: the speaker's own (their character or NPC note),
 * else the world's narrator voice, else Settings → Speech.
 */
export async function voiceFor(who: { sessionPath?: VaultPath; role?: string; name?: string }): Promise<string | undefined> {
  const index = vaultService.getIndex()
  const vault = index ? vaultService.require() : null
  if (who.role === 'player' && who.name && index && vault) {
    const wanted = who.name.trim().toLowerCase()
    const hit = [...index.characters, ...index.npcs].find((c) => c.displayName.trim().toLowerCase() === wanted || c.name?.trim().toLowerCase() === wanted)
    if (hit) {
      const own = (await readCharacter(vault, hit.path).catch(() => null))?.card.voice
      if (own) return own
    }
  }
  if (who.sessionPath) {
    const campaign = campaignOfSession(who.sessionPath)
    const narrator = campaign ? worldOf(campaign)?.narrator_voice : undefined
    if (narrator?.trim()) return narrator.trim()
  }
  return undefined
}

/** The speech server's voice list (GET /v1/audio/voices), or [] when it has none. */
export async function serverVoices(): Promise<string[]> {
  const tts = settingsStore.get().tts
  const base = tts.baseUrl.trim().replace(/\/+$/, '')
  if (tts.mode !== 'server' || !base) return []
  try {
    const { res, deadline } = await request({ headers: {}, proxy: '', allowSelfSigned: false, timeoutMs: 15_000, retries: 0 }, { url: `${base}/v1/audio/voices`, method: 'GET', headers: {} })
    try {
      const json = (await res.json()) as { voices?: unknown }
      return Array.isArray(json.voices) ? json.voices.filter((v): v is string => typeof v === 'string') : []
    } finally {
      deadline.clear()
    }
  } catch {
    return []
  }
}
