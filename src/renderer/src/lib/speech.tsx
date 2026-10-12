import { invoke } from '@/lib/ipc'
import { useEffect, useState } from 'react'
import { useApp } from '@/stores/app'

let voiceList: Promise<string[]> | null = null

/** The speech server's voices (fetched once per app run), for voice pickers. */
export function useServerVoices(): string[] {
  const server = useApp((s) => (s.settings?.tts.mode === 'server' ? s.settings.tts.baseUrl : ''))
  const [voices, setVoices] = useState<string[]>([])
  useEffect(() => {
    if (!server) return setVoices([])
    voiceList ??= invoke('speech:voices').catch(() => [])
    void voiceList.then(setVoices)
  }, [server])
  return voices
}

/** A <datalist> of the server's voices; give an input list={id}. */
export function VoiceOptions({ id }: { id: string }): React.JSX.Element {
  const voices = useServerVoices()
  return (
    <datalist id={id}>
      {voices.map((v) => (
        <option key={v} value={v} />
      ))}
    </datalist>
  )
}

let audio: HTMLAudioElement | null = null
let audioUrl: string | null = null

/** Stops anything being read aloud. */
export function stopSpeaking(): void {
  audio?.pause()
  audio = null
  if (audioUrl) URL.revokeObjectURL(audioUrl)
  audioUrl = null
  window.speechSynthesis?.cancel()
}

/** Markdown and stage directions don't read well aloud. */
function spoken(text: string): string {
  return text.replace(/[*_#>`~|]/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * Reads a message aloud with the Speech settings: the computer's voices, or an
 * OpenAI-compatible speech server, which the main process calls for us.
 */
export async function speak(text: string, who?: { sessionPath?: string; role?: string; name?: string }): Promise<void> {
  const tts = useApp.getState().settings?.tts
  const input = spoken(text)
  if (!input) return
  stopSpeaking()

  if (!tts || tts.mode === 'system') {
    if (!('speechSynthesis' in window)) throw new Error('This computer has no speech voices.')
    const utterance = new SpeechSynthesisUtterance(input)
    utterance.rate = tts?.speed ?? 1
    const voice = window.speechSynthesis.getVoices().find((v) => v.name === tts?.voice)
    if (voice) utterance.voice = voice
    window.speechSynthesis.speak(utterance)
    return
  }

  const bytes = await invoke('speech:synthesize', input, who)
  audioUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'audio/mpeg' }))
  audio = new Audio(audioUrl)
  audio.onended = () => stopSpeaking()
  await audio.play()
}
