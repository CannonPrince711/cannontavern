import { useState } from 'react'
import { Loader2, Plug } from 'lucide-react'
import { TEXT_PRESETS } from '@shared/presets'
import { isInsecureUrl } from '@shared/net'
import type { TextBackendInput } from '@shared/settings'
import type { TestResult } from '@shared/types'
import { ModelField, TestResultPanel } from '@/components/settings/fields'
import { SecretField } from '@/components/settings/SecretField'
import { AddBackendMenu } from '@/components/settings/TextBackendsSection'
import { Button } from '@/components/ui/button'
import { Callout, Field } from '@/components/ui/controls'
import { Input } from '@/components/ui/input'
import { newTextBackend } from '@/lib/backends'
import { invoke } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { useApp } from '@/stores/app'
import { toast } from '@/stores/toasts'
import { StepHeader, type StepProps } from './Wizard'

const NONE: never[] = []
const FEATURED = ['openrouter', 'anthropic', 'openai', 'ollama', 'lmstudio', 'koboldcpp-v1']

export function BackendStep({ next, back }: StepProps): React.JSX.Element {
  const existing = useApp((s) => s.settings?.textBackends ?? NONE)
  const [draft, setDraft] = useState<TextBackendInput | null>(null)
  const [test, setTest] = useState<TestResult | null>(null)
  const [busy, setBusy] = useState<'test' | 'save' | null>(null)

  const pick = (d: TextBackendInput): void => {
    setDraft(d)
    setTest(null)
  }
  const set = <K extends keyof TextBackendInput>(k: K, v: TextBackendInput[K]): void => setDraft((d) => (d ? { ...d, [k]: v } : d))

  const runTest = async (): Promise<void> => {
    if (!draft) return
    setBusy('test')
    try {
      setTest(await invoke('textBackends:test', draft))
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(null)
    }
  }
  const save = async (): Promise<void> => {
    if (!draft) return
    setBusy('save')
    try {
      useApp.setState({ settings: await invoke('textBackends:save', draft) })
      next()
    } catch (err) {
      toast.error(err, 'Could not save')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <StepHeader title="Connect a text model">
        The model plays the Dungeon Master. It can run anywhere: a cloud API, your own PC, or a GPU server over Tailscale.
      </StepHeader>

      {existing.length > 0 && !draft && (
        <Callout tone="emerald" className="mb-4">
          You already have {existing.length} backend{existing.length > 1 ? 's' : ''}: {existing.map((b) => b.name).join(', ')}.
        </Callout>
      )}

      <div className="grid grid-cols-3 gap-2">
        {FEATURED.map((id) => {
          const p = TEXT_PRESETS.find((x) => x.id === id)!
          const active = draft && draft.name.startsWith(p.label) && draft.baseUrl === p.baseUrl
          return (
            <button
              key={id}
              type="button"
              aria-pressed={!!active}
              onClick={() => pick(newTextBackend(p, existing.map((b) => b.name)))}
              className={cn('rounded-lg border bg-card px-3 py-2.5 text-left transition-colors hover:bg-accent', active && 'border-primary ring-1 ring-primary')}
            >
              <span className="block text-sm font-medium">{p.label}</span>
              <span className="block text-[11px] text-muted-foreground">{p.needsKey ? 'API key' : 'Self-hosted'}</span>
            </button>
          )
        })}
      </div>
      <div className="mt-2 text-center">
        <AddBackendMenu onPick={pick}>
          <Button variant="link" size="sm">
            More: Groq, Together, DeepSeek, vLLM, llama.cpp, text-generation-webui, custom…
          </Button>
        </AddBackendMenu>
      </div>

      {draft && (
        <div className="mt-4 space-y-1 rounded-xl border bg-card/70 p-4">
          <Field label="Base URL" htmlFor="wz-url">
            <Input id="wz-url" value={draft.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} className="font-mono text-[13px]" />
          </Field>
          {isInsecureUrl(draft.baseUrl) && (
            <Callout tone="gold">Plain http:// to a public address is unencrypted. Prefer https://, a VPN or Tailscale.</Callout>
          )}
          <Field label="API key" htmlFor="wz-key" description="Encrypted with Windows DPAPI. Leave empty for local servers.">
            <SecretField id="wz-key" value={draft.apiKey} onChange={(v) => set('apiKey', v)} />
          </Field>
          <Field label="Model" htmlFor="wz-model">
            <ModelField id="wz-model" value={draft.model} onChange={(v) => set('model', v)} fetchModels={() => invoke('textBackends:fetchModels', draft)} />
          </Field>
          <div className="flex items-center gap-2 pt-2">
            <Button variant="outline" onClick={() => void runTest()} disabled={busy !== null}>
              {busy === 'test' ? <Loader2 className="animate-spin" /> : <Plug />} Test connection
            </Button>
            <span className="text-xs text-muted-foreground">More options (headers, proxy, samplers) live in Settings.</span>
          </div>
          {test && (
            <div className="pt-2">
              <TestResultPanel result={test} />
            </div>
          )}
        </div>
      )}

      <div className="mt-8 flex justify-between">
        <Button variant="ghost" onClick={back}>
          Back
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={next}>
            {existing.length ? 'Continue' : 'Skip for now'}
          </Button>
          {draft && (
            <Button onClick={() => void save()} disabled={busy !== null || !draft.baseUrl}>
              {busy === 'save' && <Loader2 className="animate-spin" />} Save & continue
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
