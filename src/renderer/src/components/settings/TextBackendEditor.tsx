import { useEffect, useMemo, useState } from 'react'
import { askConfirm } from '@/components/AskDialog'
import { AlertTriangle, Copy, Loader2, Plug, Save, ShieldAlert, Trash2, Undo2 } from 'lucide-react'
import { TEXT_TYPE_LABELS } from '@shared/presets'
import { isInsecureUrl } from '@shared/net'
import type { TextBackendInput, TextBackendType } from '@shared/settings'
import type { TestResult } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Callout, Field, NativeSelect, Switch } from '@/components/ui/controls'
import { Input, Textarea } from '@/components/ui/input'
import { invoke } from '@/lib/ipc'
import { isValidJsonObject, stopToText, textToStop } from '@/lib/backends'
import { useApp } from '@/stores/app'
import { toast } from '@/stores/toasts'
import { Disclosure, HeadersEditor, ModelField, NullableNumber, NumberInput, TestResultPanel } from './fields'
import { SecretField } from './SecretField'

interface Props {
  initial: TextBackendInput
  isNew: boolean
  onSaved?: (id: string) => void
  onDeleted?: () => void
  onDiscardNew?: () => void
}

export function TextBackendEditor({ initial, isNew, onSaved, onDeleted, onDiscardNew }: Props): React.JSX.Element {
  const warnInsecure = useApp((s) => s.settings?.security.warnInsecureHttp ?? true)
  const [baseline, setBaseline] = useState(initial)
  const [draft, setDraft] = useState(initial)
  const [stopText, setStopText] = useState(stopToText(initial.generation.stop))
  const [test, setTest] = useState<TestResult | null>(null)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setBaseline(initial)
    setDraft(initial)
    setStopText(stopToText(initial.generation.stop))
    setTest(null)
  }, [initial])

  const dirty = isNew || JSON.stringify(draft) !== JSON.stringify(baseline)
  const extraValid = isValidJsonObject(draft.generation.extraBody)
  const insecure = warnInsecure && isInsecureUrl(draft.type === 'custom' ? draft.custom.url || draft.baseUrl : draft.baseUrl)
  const set = <K extends keyof TextBackendInput>(key: K, value: TextBackendInput[K]): void => setDraft((d) => ({ ...d, [key]: value }))
  const gen = <K extends keyof TextBackendInput['generation']>(key: K, value: TextBackendInput['generation'][K]): void =>
    setDraft((d) => ({ ...d, generation: { ...d.generation, [key]: value } }))
  const net = <K extends keyof TextBackendInput['network']>(key: K, value: TextBackendInput['network'][K]): void =>
    setDraft((d) => ({ ...d, network: { ...d.network, [key]: value } }))
  const custom = <K extends keyof TextBackendInput['custom']>(key: K, value: TextBackendInput['custom'][K]): void =>
    setDraft((d) => ({ ...d, custom: { ...d.custom, [key]: value } }))

  const payload = useMemo(() => ({ ...draft, generation: { ...draft.generation, stop: textToStop(stopText) } }), [draft, stopText])

  const runTest = async (): Promise<void> => {
    setTesting(true)
    setTest(null)
    try {
      setTest(await invoke('textBackends:test', payload))
    } catch (err) {
      toast.error(err, 'Test failed to run')
    } finally {
      setTesting(false)
    }
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const settings = await invoke('textBackends:save', payload)
      useApp.setState({ settings })
      toast.success(`Saved “${payload.name}”`)
      onSaved?.(payload.id)
    } catch (err) {
      toast.error(err, 'Could not save backend')
    } finally {
      setSaving(false)
    }
  }

  const duplicate = async (): Promise<void> => {
    try {
      useApp.setState({ settings: await invoke('textBackends:duplicate', draft.id) })
    } catch (err) {
      toast.error(err)
    }
  }

  const remove = async (): Promise<void> => {
    if (isNew) return onDiscardNew?.()
    if (!(await askConfirm({ title: `Delete “${baseline.name}”?`, description: 'Its stored key is removed too.', confirmLabel: 'Delete', danger: true }))) return
    try {
      useApp.setState({ settings: await invoke('textBackends:delete', draft.id) })
      onDeleted?.()
    } catch (err) {
      toast.error(err)
    }
  }

  const keyOptional = draft.type === 'ollama' || draft.type === 'koboldcpp' || draft.type === 'textgen-webui' || draft.type === 'custom'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
        <div className="grid grid-cols-[1fr_220px] gap-4">
          <Field label="Name" htmlFor="tb-name">
            <Input id="tb-name" value={draft.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Type" htmlFor="tb-type">
            <NativeSelect id="tb-type" value={draft.type} onChange={(e) => set('type', e.target.value as TextBackendType)}>
              {Object.entries(TEXT_TYPE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>

        {draft.type !== 'custom' && (
          <Field
            label="Base URL"
            htmlFor="tb-url"
            description={
              draft.type === 'anthropic'
                ? 'Leave as https://api.anthropic.com unless you use a proxy.'
                : 'Any host or port: localhost, a LAN machine, Tailscale, or a remote server.'
            }
          >
            <Input id="tb-url" value={draft.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} spellCheck={false} className="font-mono text-[13px]" />
          </Field>
        )}
        {insecure && (
          <Callout tone="gold" icon={<ShieldAlert />}>
            This uses plain <strong>http://</strong> to a public address, so your prompts and key travel unencrypted. Prefer
            https://, a VPN or Tailscale.
          </Callout>
        )}

        <Field label={keyOptional ? 'API key (optional)' : 'API key'} htmlFor="tb-key" description="Encrypted with Windows DPAPI and never shown again. Or type env:NAME to read it from an environment variable.">
          <SecretField id="tb-key" value={draft.apiKey} onChange={(v) => set('apiKey', v)} />
        </Field>

        {draft.type !== 'custom' || draft.custom.bodyTemplate.includes('{{model}}') ? (
          <Field label="Model" htmlFor="tb-model" description={draft.type === 'koboldcpp' ? 'KoboldCpp uses whatever model it loaded; this is informational.' : undefined}>
            <ModelField
              id="tb-model"
              value={draft.model}
              onChange={(v) => set('model', v)}
              fetchModels={draft.type === 'custom' ? undefined : () => invoke('textBackends:fetchModels', payload)}
            />
          </Field>
        ) : null}

        {draft.type === 'custom' && (
          <Disclosure title="Custom request" defaultOpen>
            <div className="grid grid-cols-[1fr_120px] gap-3">
              <Field label="Request URL" htmlFor="tb-curl">
                <Input id="tb-curl" value={draft.custom.url} onChange={(e) => custom('url', e.target.value)} className="font-mono text-[13px]" />
              </Field>
              <Field label="Method" htmlFor="tb-cmethod">
                <NativeSelect id="tb-cmethod" value={draft.custom.method} onChange={(e) => custom('method', e.target.value as 'POST')}>
                  <option>POST</option>
                  <option>PUT</option>
                  <option>GET</option>
                </NativeSelect>
              </Field>
            </div>
            <Field
              label="Body template"
              htmlFor="tb-ctpl"
              description={
                <>
                  Placeholders: <code>{'{{system}}'}</code> <code>{'{{messages_json}}'}</code> <code>{'{{prompt}}'}</code>{' '}
                  <code>{'{{model}}'}</code> <code>{'{{max_tokens}}'}</code> <code>{'{{temperature}}'}</code>. Put text placeholders inside
                  quotes; <code>_json</code> and numbers go unquoted.
                </>
              }
            >
              <Textarea id="tb-ctpl" rows={8} value={draft.custom.bodyTemplate} onChange={(e) => custom('bodyTemplate', e.target.value)} className="font-mono text-[12.5px]" spellCheck={false} />
            </Field>
            <Field label="Reply JSONPath" htmlFor="tb-cpath" description="Where the reply text is in the response, e.g. $.choices[0].message.content. Empty tries common shapes.">
              <Input id="tb-cpath" value={draft.custom.responsePath} onChange={(e) => custom('responsePath', e.target.value)} className="font-mono text-[13px]" />
            </Field>
            <div className="grid grid-cols-[180px_1fr] gap-3">
              <Field label="Streaming format" htmlFor="tb-cstream">
                <NativeSelect id="tb-cstream" value={draft.custom.streamParser} onChange={(e) => custom('streamParser', e.target.value as 'none')}>
                  <option value="none">None</option>
                  <option value="sse">Server-Sent Events</option>
                  <option value="ndjson">NDJSON</option>
                </NativeSelect>
              </Field>
              <Field label="Stream delta JSONPath" htmlFor="tb-cspath">
                <Input
                  id="tb-cspath"
                  value={draft.custom.streamPath}
                  disabled={draft.custom.streamParser === 'none'}
                  placeholder="$.choices[0].delta.content"
                  onChange={(e) => custom('streamPath', e.target.value)}
                  className="font-mono text-[13px]"
                />
              </Field>
            </div>
          </Disclosure>
        )}

        {draft.type === 'anthropic' && (
          <Disclosure title="Claude options" defaultOpen={isNew}>
            <Field label="Effort" htmlFor="tb-effort" description="How much the model thinks before answering (Claude 4.6 and newer). Low is fast and cheap; high is more careful.">
              <NativeSelect
                id="tb-effort"
                value={draft.anthropic.effort}
                onChange={(e) => set('anthropic', { ...draft.anthropic, effort: e.target.value as TextBackendInput['anthropic']['effort'] })}
              >
                <option value="">Model default</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="xhigh">Extra high</option>
                <option value="max">Max</option>
              </NativeSelect>
            </Field>
            <Field
              inline
              label="Refusal fallback"
              description="If the model declines a request, Anthropic re-runs it on its recommended fallback model instead of returning the refusal. Only sent to api.anthropic.com for Claude Opus 5.5, Opus 5, Sonnet 5.5 and Fable 5.1."
            >
              <Switch
                aria-label="Refusal fallback"
                checked={draft.anthropic.refusalFallback}
                onCheckedChange={(v) => set('anthropic', { ...draft.anthropic, refusalFallback: v })}
              />
            </Field>
            <p className="text-[11px] text-muted-foreground">Claude 4.7 and newer ignore temperature, top-p and top-k; the app leaves them out for those models.</p>
          </Disclosure>
        )}

        <Disclosure title="Generation" defaultOpen={isNew}>
          <Field inline label="Stream tokens" description="Show the reply as it is written.">
            <Switch aria-label="Stream tokens" checked={draft.generation.stream} onCheckedChange={(v) => gen('stream', v)} />
          </Field>
          <div className="grid grid-cols-3 gap-4">
            <NullableNumber label="Temperature" value={draft.generation.temperature} fallback={0.9} min={0} max={5} onChange={(v) => gen('temperature', v)} />
            <NullableNumber label="Top-p" value={draft.generation.topP} fallback={0.95} min={0} max={1} onChange={(v) => gen('topP', v)} />
            <NullableNumber label="Top-k" value={draft.generation.topK} fallback={40} step={1} min={0} onChange={(v) => gen('topK', v)} />
            <NullableNumber label="Min-p" value={draft.generation.minP} fallback={0.05} min={0} max={1} step={0.01} onChange={(v) => gen('minP', v)} />
            <NullableNumber label="Repetition penalty" value={draft.generation.repetitionPenalty} fallback={1.1} min={0} max={3} step={0.01} onChange={(v) => gen('repetitionPenalty', v)} />
            <div />
            <NumberInput label="Max reply tokens" value={draft.generation.maxTokens} min={1} max={200000} onChange={(v) => gen('maxTokens', v)} />
            <NumberInput label="Context size" value={draft.generation.contextSize} min={512} step={512} onChange={(v) => gen('contextSize', v)} suffix="tok" />
            <Field label="Token estimate" htmlFor="tb-tok" className="py-0">
              <NativeSelect id="tb-tok" value={draft.tokenizer} onChange={(e) => set('tokenizer', e.target.value as 'chars4')}>
                <option value="chars4">Characters ÷ 4</option>
                <option value="chars3.5">Characters ÷ 3.5 (denser)</option>
              </NativeSelect>
            </Field>
          </div>
          <Field label="Stop sequences" htmlFor="tb-stop" description="One per line. Write \n for a line break.">
            <Textarea id="tb-stop" rows={2} value={stopText} onChange={(e) => setStopText(e.target.value)} className="font-mono text-[13px]" spellCheck={false} />
          </Field>
          <Field label="Extra body JSON" htmlFor="tb-extra" description="Merged into every request body, e.g. {&quot;seed&quot;: 42} or provider-specific options.">
            <Textarea
              id="tb-extra"
              rows={3}
              value={draft.generation.extraBody}
              onChange={(e) => gen('extraBody', e.target.value)}
              aria-invalid={!extraValid}
              placeholder="{ }"
              className="font-mono text-[13px]"
              spellCheck={false}
            />
          </Field>
          {!extraValid && <p className="text-xs text-crimson">This isn’t a JSON object yet.</p>}
        </Disclosure>

        <Disclosure title="Network" badge={draft.network.headers.length ? <span className="text-xs text-muted-foreground">{draft.network.headers.length} header(s)</span> : undefined}>
          <Field label="Custom headers" description="For reverse proxies, Cloudflare Access service tokens (CF-Access-Client-Id / -Secret) or basic auth.">
            <HeadersEditor rows={draft.network.headers} onChange={(rows) => net('headers', rows)} />
          </Field>
          <Field label="Proxy" htmlFor="tb-proxy" description="Optional: http://host:port, https://… or socks5://user:pass@host:port.">
            <Input id="tb-proxy" value={draft.network.proxy} onChange={(e) => net('proxy', e.target.value)} placeholder="direct connection" className="font-mono text-[13px]" />
          </Field>
          <Field inline label="Accept self-signed certificate" description="Only for your own server. This turns off certificate checks for this backend.">
            <Switch aria-label="Accept self-signed certificate" checked={draft.network.allowSelfSigned} onCheckedChange={(v) => net('allowSelfSigned', v)} />
          </Field>
          {draft.network.allowSelfSigned && (
            <Callout tone="crimson" icon={<AlertTriangle />}>
              Certificate checking is off. Anyone able to intercept the connection could read your prompts and key.
            </Callout>
          )}
          <div className="grid grid-cols-2 gap-4">
            <NumberInput label="Timeout" value={Math.round(draft.network.timeoutMs / 1000)} min={1} max={600} onChange={(v) => net('timeoutMs', v * 1000)} suffix="s" />
            <NumberInput label="Retries" value={draft.network.retries} min={0} max={10} onChange={(v) => net('retries', v)} />
          </div>
        </Disclosure>

        {test && <TestResultPanel result={test} />}
      </div>

      <div className="flex items-center gap-2 border-t bg-card/60 px-6 py-3">
        <Button variant="outline" onClick={() => void runTest()} disabled={testing || !extraValid}>
          {testing ? <Loader2 className="animate-spin" /> : <Plug />} Test connection
        </Button>
        {!isNew && (
          <Button variant="ghost" onClick={() => void duplicate()} aria-label="Duplicate backend">
            <Copy /> Duplicate
          </Button>
        )}
        <Button variant="ghost" className="text-crimson hover:text-crimson" onClick={() => void remove()}>
          <Trash2 /> {isNew ? 'Discard' : 'Delete'}
        </Button>
        <div className="flex-1" />
        {dirty && !isNew && (
          <Button
            variant="ghost"
            onClick={() => {
              setDraft(baseline)
              setStopText(stopToText(baseline.generation.stop))
            }}
          >
            <Undo2 /> Revert
          </Button>
        )}
        <Button onClick={() => void save()} disabled={!dirty || saving || !draft.name.trim() || !extraValid}>
          {saving ? <Loader2 className="animate-spin" /> : <Save />} {isNew ? 'Add backend' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
