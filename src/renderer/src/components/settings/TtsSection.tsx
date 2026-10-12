import { Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, NativeSelect, SettingsGroup, Switch } from '@/components/ui/controls'
import { Input } from '@/components/ui/input'
import { speak, stopSpeaking, VoiceOptions } from '@/lib/speech'
import { useApp } from '@/stores/app'
import { toast } from '@/stores/toasts'
import { NumberInput } from './fields'

export function TtsSection(): React.JSX.Element {
  const settings = useApp((s) => s.settings)!
  const updateSettings = useApp((s) => s.updateSettings)
  const tts = settings.tts
  const set = (patch: Partial<typeof tts>): void => void updateSettings({ tts: patch })
  const test = (): void => {
    speak('The dice are rolled, and the tavern falls silent.').catch((err) => toast.error(err))
  }

  return (
    <>
      <SettingsGroup title="Speech" description="Read replies aloud. Each message gets a Read aloud button once this is on.">
        <Field inline label="Read aloud buttons" description="Shows the button on messages and in their right-click menu.">
          <Switch aria-label="Read aloud buttons" checked={tts.enabled} onCheckedChange={(v) => set({ enabled: v })} />
        </Field>
        <Field label="Voice source" htmlFor="tts-mode">
          <NativeSelect id="tts-mode" value={tts.mode} onChange={(e) => set({ mode: e.target.value as 'system' | 'server' })}>
            <option value="system">This computer’s voices</option>
            <option value="server">Speech server (OpenAI-compatible)</option>
          </NativeSelect>
        </Field>
        {tts.mode === 'server' && (
          <>
            <Field label="Speech server URL" htmlFor="tts-url" description="The base address only, e.g. https://your-pod-8880.proxy.runpod.net. The app adds /v1/audio/speech.">
              <Input id="tts-url" value={tts.baseUrl} onChange={(e) => set({ baseUrl: e.target.value.trim() })} />
            </Field>
            <Field label="Model" htmlFor="tts-model" description="The speech model the server expects, e.g. tts-1 or kokoro.">
              <Input id="tts-model" value={tts.model} onChange={(e) => set({ model: e.target.value.trim() })} />
            </Field>
          </>
        )}
        <Field label="Voice" htmlFor="tts-voice" description={tts.mode === 'system' ? 'Leave blank for the default voice.' : 'A voice name the server knows, e.g. alloy.'}>
          <Input id="tts-voice" list={tts.mode === 'server' ? 'tts-voice-options' : undefined} value={tts.voice} onChange={(e) => set({ voice: e.target.value.trim() })} />
          {tts.mode === 'server' && <VoiceOptions id="tts-voice-options" />}
        </Field>
        <NumberInput label="Speed" value={tts.speed} min={0.25} max={4} step={0.05} onChange={(v) => set({ speed: v })} suffix="×" />
      </SettingsGroup>
      <div className="flex justify-end gap-2 py-2">
        <Button type="button" variant="ghost" onClick={stopSpeaking}>
          Stop
        </Button>
        <Button type="button" onClick={test}>
          <Volume2 />
          Test voice
        </Button>
      </div>
    </>
  )
}
