import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Copy, ImagePlus, Loader2, Plug, Plus, Save, ShieldAlert, Star, Trash2, Undo2 } from 'lucide-react'
import { isInsecureUrl } from '@shared/net'
import type { ImageBackendInput, ImageBackendType } from '@shared/settings'
import type { TestResult } from '@shared/types'
import { askConfirm } from '@/components/AskDialog'
import { EmptyState } from '@/components/EmptyState'
import { FrameArt } from '@/components/illustrations'
import { Button } from '@/components/ui/button'
import { Callout, Field, NativeSelect, SettingsGroup, Switch } from '@/components/ui/controls'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input, Textarea } from '@/components/ui/input'
import { IMAGE_PRESETS, IMAGE_TYPE_LABELS, imageViewToInput, newImageBackend } from '@/lib/backends'
import { invoke } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { useApp } from '@/stores/app'
import { toast } from '@/stores/toasts'
import { ComfyWorkflows } from './ComfyWorkflows'
import { ImageProfilesGroup } from './ImageProfiles'
import { Disclosure, HeadersEditor, NumberInput, TestResultPanel } from './fields'
import { SecretField } from './SecretField'

function AddImageMenu({ onPick, children }: { onPick: (d: ImageBackendInput) => void; children: React.ReactNode }): React.JSX.Element {
  const backends = useApp((s) => s.settings?.imageBackends)
  const names = backends?.map((b) => b.name) ?? []
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {IMAGE_PRESETS.map((p) => (
          <DropdownMenuItem key={p.type} onSelect={() => onPick(newImageBackend(p.type, names))}>
            <span className="flex-1">
              <span className="block">{p.label}</span>
              <span className="block text-[11px] text-muted-foreground">{p.hint}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ImageBackendEditor({ initial, isNew, onSaved, onDone }: { initial: ImageBackendInput; isNew: boolean; onSaved: (id: string) => void; onDone: () => void }): React.JSX.Element {
  const warnInsecure = useApp((s) => s.settings?.security.warnInsecureHttp ?? true)
  const [baseline, setBaseline] = useState(initial)
  const [draft, setDraft] = useState(initial)
  const [test, setTest] = useState<TestResult | null>(null)
  const [busy, setBusy] = useState<'test' | 'save' | null>(null)
  useEffect(() => {
    setBaseline(initial)
    setDraft(initial)
    setTest(null)
  }, [initial])

  const dirty = isNew || JSON.stringify(draft) !== JSON.stringify(baseline)
  const set = <K extends keyof ImageBackendInput>(k: K, v: ImageBackendInput[K]): void => setDraft((d) => ({ ...d, [k]: v }))
  const defaults = <K extends keyof ImageBackendInput['defaults']>(k: K, v: ImageBackendInput['defaults'][K]): void => setDraft((d) => ({ ...d, defaults: { ...d.defaults, [k]: v } }))
  const net = <K extends keyof ImageBackendInput['network']>(k: K, v: ImageBackendInput['network'][K]): void => setDraft((d) => ({ ...d, network: { ...d.network, [k]: v } }))
  const url = draft.type === 'custom' ? draft.custom.url || draft.baseUrl : draft.baseUrl

  const runTest = async (): Promise<void> => {
    setBusy('test')
    setTest(null)
    try {
      setTest(await invoke('imageBackends:test', draft, draft.comfy.defaultWorkflowId ?? undefined))
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(null)
    }
  }
  const save = async (): Promise<void> => {
    setBusy('save')
    try {
      useApp.setState({ settings: await invoke('imageBackends:save', draft) })
      toast.success(`Saved “${draft.name}”`)
      onSaved(draft.id)
    } catch (err) {
      toast.error(err, 'Could not save')
    } finally {
      setBusy(null)
    }
  }
  const remove = async (): Promise<void> => {
    if (isNew) return onDone()
    if (!(await askConfirm({ title: `Delete “${baseline.name}”?`, confirmLabel: 'Delete', danger: true }))) return
    try {
      useApp.setState({ settings: await invoke('imageBackends:delete', draft.id) })
      onDone()
    } catch (err) {
      toast.error(err)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
        <div className="grid grid-cols-[1fr_220px] gap-4">
          <Field label="Name" htmlFor="ib-name">
            <Input id="ib-name" value={draft.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Type" htmlFor="ib-type">
            <NativeSelect id="ib-type" value={draft.type} onChange={(e) => set('type', e.target.value as ImageBackendType)}>
              {Object.entries(IMAGE_TYPE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        {draft.type !== 'custom' && (
          <Field label="Base URL" htmlFor="ib-url" description="Local, LAN, Tailscale, or a reverse proxy (add its auth headers under Network).">
            <Input id="ib-url" value={draft.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} className="font-mono text-[13px]" spellCheck={false} />
          </Field>
        )}
        {warnInsecure && isInsecureUrl(url) && (
          <Callout tone="gold" icon={<ShieldAlert />}>
            Plain http:// to a public address is unencrypted. Prefer https://, a VPN or Tailscale.
          </Callout>
        )}
        <Field label="API key (optional)" htmlFor="ib-key">
          <SecretField id="ib-key" value={draft.apiKey} onChange={(v) => set('apiKey', v)} />
        </Field>

        {draft.type === 'comfyui' && (
          <Disclosure title="Workflows" defaultOpen badge={<span className="text-xs text-muted-foreground">{draft.comfy.workflows.length}</span>}>
            <ComfyWorkflows workflows={draft.comfy.workflows} defaultId={draft.comfy.defaultWorkflowId} onChange={(workflows, defaultWorkflowId) => set('comfy', { ...draft.comfy, workflows, defaultWorkflowId })} />
          </Disclosure>
        )}

        {draft.type === 'openai' && (
          <Disclosure title="OpenAI options" defaultOpen={isNew}>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Model" className="py-0">
                <Input value={draft.openai.model} onChange={(e) => set('openai', { ...draft.openai, model: e.target.value })} className="font-mono text-xs" />
              </Field>
              <Field label="Size" className="py-0">
                <Input value={draft.openai.size} onChange={(e) => set('openai', { ...draft.openai, size: e.target.value })} placeholder="1024x1024" />
              </Field>
              <Field label="Quality" className="py-0">
                <Input value={draft.openai.quality} onChange={(e) => set('openai', { ...draft.openai, quality: e.target.value })} placeholder="auto" />
              </Field>
            </div>
          </Disclosure>
        )}

        {draft.type === 'custom' && (
          <Disclosure title="Custom request" defaultOpen>
            <div className="grid grid-cols-[1fr_120px] gap-3">
              <Field label="Request URL" className="py-0">
                <Input value={draft.custom.url} onChange={(e) => set('custom', { ...draft.custom, url: e.target.value })} className="font-mono text-xs" />
              </Field>
              <Field label="Method" className="py-0">
                <NativeSelect value={draft.custom.method} onChange={(e) => set('custom', { ...draft.custom, method: e.target.value as 'POST' })}>
                  <option>POST</option>
                  <option>PUT</option>
                  <option>GET</option>
                </NativeSelect>
              </Field>
            </div>
            <Field label="Body template" description="Placeholders: {{prompt}} {{negative}} {{width}} {{height}} {{steps}} {{cfg}} {{seed}} {{sampler}}">
              <Textarea rows={7} value={draft.custom.bodyTemplate} onChange={(e) => set('custom', { ...draft.custom, bodyTemplate: e.target.value })} className="font-mono text-[12.5px]" />
            </Field>
            <div className="grid grid-cols-[1fr_180px] gap-3">
              <Field label="Image JSONPath" className="py-0">
                <Input value={draft.custom.imagePath} onChange={(e) => set('custom', { ...draft.custom, imagePath: e.target.value })} placeholder="$.images[0]" className="font-mono text-xs" />
              </Field>
              <Field label="Value is" className="py-0">
                <NativeSelect value={draft.custom.resultKind} onChange={(e) => set('custom', { ...draft.custom, resultKind: e.target.value as 'url' })}>
                  <option value="base64">Base64 data</option>
                  <option value="url">An image URL</option>
                </NativeSelect>
              </Field>
            </div>
          </Disclosure>
        )}

        <Disclosure title="Defaults & style" defaultOpen={isNew}>
          <div className="grid grid-cols-4 gap-3">
            <NumberInput label="Width" value={draft.defaults.width} min={64} max={4096} step={64} onChange={(v) => defaults('width', v)} />
            <NumberInput label="Height" value={draft.defaults.height} min={64} max={4096} step={64} onChange={(v) => defaults('height', v)} />
            <NumberInput label="Steps" value={draft.defaults.steps} min={1} max={200} onChange={(v) => defaults('steps', v)} />
            <NumberInput label="CFG" value={draft.defaults.cfg} min={0} max={30} step={0.5} onChange={(v) => defaults('cfg', v)} />
          </div>
          <p className="text-[11px] text-muted-foreground">Scenes use the longer side as the width, portraits as the height.</p>
          <Field label="Sampler" className="py-0">
            <Input value={draft.defaults.sampler} onChange={(e) => defaults('sampler', e.target.value)} placeholder="euler / DPM++ 2M Karras" />
          </Field>
          <Field label="Style prefix" description="Added before every prompt, e.g. “dark fantasy oil painting”.">
            <Input value={draft.defaults.stylePrefix} onChange={(e) => defaults('stylePrefix', e.target.value)} />
          </Field>
          <Field label="Style suffix" description="Added after every prompt, e.g. “highly detailed, dramatic lighting”.">
            <Input value={draft.defaults.styleSuffix} onChange={(e) => defaults('styleSuffix', e.target.value)} />
          </Field>
          <Field label="Negative prompt">
            <Textarea rows={2} value={draft.defaults.negativePrompt} onChange={(e) => defaults('negativePrompt', e.target.value)} />
          </Field>
        </Disclosure>

        <Disclosure title="Network">
          <Field label="Custom headers" description="E.g. Cloudflare Access service tokens for a ComfyUI behind a reverse proxy.">
            <HeadersEditor rows={draft.network.headers} onChange={(rows) => net('headers', rows)} />
          </Field>
          <Field label="Proxy" description="http://, https:// or socks5:// (ComfyUI progress falls back to polling through proxies).">
            <Input value={draft.network.proxy} onChange={(e) => net('proxy', e.target.value)} placeholder="direct connection" className="font-mono text-xs" />
          </Field>
          <Field inline label="Accept self-signed certificate">
            <Switch aria-label="Accept self-signed certificate" checked={draft.network.allowSelfSigned} onCheckedChange={(v) => net('allowSelfSigned', v)} />
          </Field>
          {draft.network.allowSelfSigned && (
            <Callout tone="crimson" icon={<AlertTriangle />}>
              Certificate checking is off for this backend.
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
        <Button variant="outline" onClick={() => void runTest()} disabled={busy !== null}>
          {busy === 'test' ? <Loader2 className="animate-spin" /> : <Plug />} Test (small image)
        </Button>
        {!isNew && (
          <Button variant="ghost" onClick={() => void invoke('imageBackends:duplicate', draft.id).then((s) => useApp.setState({ settings: s }))}>
            <Copy /> Duplicate
          </Button>
        )}
        <Button variant="ghost" className="text-crimson hover:text-crimson" onClick={() => void remove()}>
          <Trash2 /> {isNew ? 'Discard' : 'Delete'}
        </Button>
        <div className="flex-1" />
        {dirty && !isNew && (
          <Button variant="ghost" onClick={() => setDraft(baseline)}>
            <Undo2 /> Revert
          </Button>
        )}
        <Button onClick={() => void save()} disabled={!dirty || busy !== null || !draft.name.trim()}>
          {busy === 'save' ? <Loader2 className="animate-spin" /> : <Save />} {isNew ? 'Add backend' : 'Save'}
        </Button>
      </div>
    </div>
  )
}

export function ImageBackendsSection(): React.JSX.Element {
  const settings = useApp((s) => s.settings)!
  const updateSettings = useApp((s) => s.updateSettings)
  const backends = settings.imageBackends
  const [selectedId, setSelectedId] = useState<string | null>(backends[0]?.id ?? null)
  const [draftNew, setDraftNew] = useState<ImageBackendInput | null>(null)
  const selected = backends.find((b) => b.id === selectedId)
  const selectedJson = selected ? JSON.stringify(selected) : ''
  const initial = useMemo(() => (selected ? imageViewToInput(selected) : null), [selectedJson]) // eslint-disable-line react-hooks/exhaustive-deps
  const t = settings.imageTriggers

  return (
    <div className="space-y-6">
      <div className="flex h-[min(680px,calc(100vh-220px))] min-h-[420px] overflow-hidden rounded-xl border bg-card/80 shadow-card">
        <aside className="flex w-64 shrink-0 flex-col border-r" aria-label="Image backends">
          <div className="flex items-center justify-between border-b px-3 py-2.5">
            <span className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">Backends</span>
            <AddImageMenu onPick={(d) => (setDraftNew(d), setSelectedId(null))}>
              <Button size="sm" variant="ghost">
                <Plus /> Add
              </Button>
            </AddImageMenu>
          </div>
          <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2" role="listbox" aria-label="Image backends">
            {draftNew && (
              <li role="option" aria-selected className="rounded-md border border-dashed border-primary/60 bg-accent px-2.5 py-2 text-sm">
                {draftNew.name} <span className="block text-[11px] text-muted-foreground">new, not saved</span>
              </li>
            )}
            {backends.map((b) => (
              <li key={b.id}>
                <div
                  role="option"
                  tabIndex={0}
                  aria-selected={!draftNew && selectedId === b.id}
                  onClick={() => (setDraftNew(null), setSelectedId(b.id))}
                  onKeyDown={(e) => e.key === 'Enter' && (setDraftNew(null), setSelectedId(b.id))}
                  className={cn('flex cursor-default items-center gap-2 rounded-md px-2.5 py-2 hover:bg-accent', !draftNew && selectedId === b.id && 'bg-accent')}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{b.name}</span>
                      {settings.defaultImageBackendId === b.id && <Star className="size-3 fill-gold text-gold" aria-label="Default" />}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {IMAGE_TYPE_LABELS[b.type]}
                      {b.type === 'comfyui' ? ` · ${b.comfy.workflows.length} workflow${b.comfy.workflows.length === 1 ? '' : 's'}` : ''}
                    </span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
          {selected && !draftNew && settings.defaultImageBackendId !== selected.id && (
            <div className="border-t p-2">
              <Button variant="ghost" size="sm" className="w-full" onClick={() => void updateSettings({ defaultImageBackendId: selected.id })}>
                <Star /> Make default
              </Button>
            </div>
          )}
        </aside>
        <div className="min-w-0 flex-1">
          {draftNew ? (
            <ImageBackendEditor key={draftNew.id} initial={draftNew} isNew onSaved={(id) => (setDraftNew(null), setSelectedId(id))} onDone={() => setDraftNew(null)} />
          ) : initial ? (
            <ImageBackendEditor key={initial.id} initial={initial} isNew={false} onSaved={() => {}} onDone={() => setSelectedId(backends.find((b) => b.id !== selectedId)?.id ?? null)} />
          ) : (
            <div className="grid h-full place-items-center">
              <EmptyState
                size="lg"
                illustration={<FrameArt />}
                title="No image backend"
                description="Illustrate scenes and paint portraits with ComfyUI (local or remote), Automatic1111/Forge, OpenAI, or any API."
                action={
                  <AddImageMenu onPick={setDraftNew}>
                    <Button>
                      <ImagePlus /> Add an image backend
                    </Button>
                  </AddImageMenu>
                }
              />
            </div>
          )}
        </div>
      </div>

      <ImageProfilesGroup />

      <SettingsGroup title="Image triggers" description="When illustrations are made without you asking. Use /image, or the camera button on DM messages, any time.">
        <div className="grid grid-cols-2 gap-4 py-3">
          <NumberInput label="Illustrate every N DM replies (0 = off)" value={t.everyNDmTurns} min={0} max={50} onChange={(v) => void updateSettings({ imageTriggers: { everyNDmTurns: v } })} />
          <NumberInput label="Messages used to write a scene prompt" value={t.sceneContextMessages} min={1} max={50} onChange={(v) => void updateSettings({ imageTriggers: { sceneContextMessages: v } })} />
        </div>
        <Field inline label="Illustrate when the location changes" description="When the DM describes arriving somewhere new.">
          <Switch aria-label="Illustrate when the location changes" checked={t.onLocationChange} onCheckedChange={(v) => void updateSettings({ imageTriggers: { onLocationChange: v } })} />
        </Field>
        <Field
          inline
          label="Paint portraits for new characters and NPCs"
          description="New characters and NPCs without a portrait get one, painted in the background one at a time: from New character (once it has a description), the campaign builder, /npc, or notes you add in Obsidian. Existing characters are left alone."
        >
          <Switch aria-label="Paint portraits for new characters and NPCs" checked={t.autoPortraits} onCheckedChange={(v) => void updateSettings({ imageTriggers: { autoPortraits: v } })} />
        </Field>
      </SettingsGroup>
    </div>
  )
}
