import { invoke } from '@/lib/ipc'
import { useEffect, useState } from 'react'
import { useApp } from '@/stores/app'
import { splitForSpeech } from '@shared/speech'

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
/** Bumped by every new reading and by stop, so an old reading's pieces stop playing. */
let reading = 0

/** Stops anything being read aloud. */
export function stopSpeaking(): void {
  reading++
  endAudio()
  window.speechSynthesis?.cancel()
}

function endAudio(): void {
  audio?.pause()
  audio = null
  if (audioUrl) URL.revokeObjectURL(audioUrl)
  audioUrl = null
}

/** Markdown and stage directions don't read well aloud. */
function spoken(text: string): string {
  return text.replace(/[*_#>`~|]/g, '').replace(/\s+/g, ' ').trim()
}

/** Plays one piece; resolves when it ends, or at once if the reading was stopped. */
function play(bytes: Uint8Array, id: number): Promise<void> {
  if (id !== reading) return Promise.resolve()
  endAudio()
  audioUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'audio/mpeg' }))
  const a = new Audio(audioUrl)
  audio = a
  return new Promise((resolve, reject) => {
    a.onended = () => resolve()
    a.onpause = () => resolve()
    a.onerror = () => reject(new Error('The speech audio couldn’t be played.'))
    a.play().catch(reject)
  })
}

/**
 * Reads a message aloud with the Speech settings: the computer's voices, or an
 * OpenAI-compatible speech server, which the main process calls for us. Long
 * text goes to the server in sentence-sized pieces: the first plays while the
 * next is made, so reading starts in seconds and never hits a server timeout.
 */
export async function speak(text: string, who?: { sessionPath?: string; role?: string; name?: string }): Promise<void> {
  const tts = useApp.getState().settings?.tts
  const input = spoken(text)
  if (!input) return
  stopSpeaking()
  const id = reading

  if (!tts || tts.mode === 'system') {
    if (!('speechSynthesis' in window)) throw new Error('This computer has no speech voices.')
    const utterance = new SpeechSynthesisUtterance(input)
    utterance.rate = tts?.speed ?? 1
    const voice = window.speechSynthesis.getVoices().find((v) => v.name === tts?.voice)
    if (voice) utterance.voice = voice
    window.speechSynthesis.speak(utterance)
    return
  }

  const pieces = splitForSpeech(input)
  const make = (i: number): Promise<Uint8Array> => invoke('speech:synthesize', pieces[i]!, who)
  let next = make(0)
  for (let i = 0; i < pieces.length; i++) {
    const bytes = await next
    if (id !== reading) return
    if (i + 1 < pieces.length) {
      next = make(i + 1)
      // Stopped before it's needed: nobody awaits it, so don't let it reject unhandled.
      next.catch(() => {})
    }
    await play(bytes, id)
    if (id !== reading) return
  }
  if (id === reading) endAudio()
}
