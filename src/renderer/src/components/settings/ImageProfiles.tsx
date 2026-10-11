import { useEffect, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { IMAGE_PURPOSES, type ImageProfile, type ImagePurpose } from '@shared/settings'
import { Button } from '@/components/ui/button'
import { Field, NativeSelect, SettingsGroup } from '@/components/ui/controls'
import { Input } from '@/components/ui/input'
import { Tip } from '@/components/ui/tooltip'
import { invoke } from '@/lib/ipc'
import { useApp } from '@/stores/app'
import { toast } from '@/stores/toasts'
import { Disclosure, NumberInput } from './fields'

const PURPOSE_INFO: Record<ImagePurpose, { label: string; hint: string; style: string }> = {
  scene: { label: 'Scenes', hint: 'Illustrations of the story', style: 'cinematic fantasy illustration' },
  portrait: { label: 'Portraits', hint: 'Characters and NPCs', style: 'character portrait, detailed face' },
  map: { label: 'Maps', hint: 'Campaign maps', style: 'parchment map, ink and watercolour' },
  other: { label: 'Other', hint: '/image with your own prompt', style: '' }
}

/** Settings → Image backends → Generation options: a backend, model, size and style per purpose. */
export function ImageProfilesGroup(): React.JSX.Element | null {
  const settings = useApp((s) => s.settings)
  if (!settings?.imageBackends.length) return null
  return (
    <SettingsGroup
      title="Generation options"
      description="Give scenes, portraits and maps their own backend, model, size and style. Anything left on its default uses the backend’s own settings (and the model switcher)."
    >
      <div className="space-y-2 py-3">
        {IMAGE_PURPOSES.map((p) => (
          <ProfileRow key={p} purpose={p} />
        ))}
      </div>
    </SettingsGroup>
  )
}

function ProfileRow({ purpose }: { purpose: ImagePurpose }): React.JSX.Element {
  const settings = useApp((s) => s.settings!)
  const update = useApp((s) => s.updateSettings)
  const saved = settings.imageProfiles[purpose]
  // Text fields save when you leave them, not on every key.
  const [draft, setDraft] = useState<ImageProfile>(saved)
  useEffect(() => setDraft(saved), [saved])
  const [models, setModels] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(false)

  const info = PURPOSE_INFO[purpose]
  const defaultBackend = settings.imageBackends.find((b) => b.id === settings.defaultImageBackendId) ?? settings.imageBackends[0]
  const backend = settings.imageBackends.find((b) => b.id === draft.backendId) ?? defaultBackend
  const workflows = backend?.type === 'comfyui' ? backend.comfy.workflows : []

  const save = (patch: Partial<ImageProfile>): void => {
    const next = { ...draft, ...patch }
    setDraft(next)
    if (JSON.stringify(next) !== JSON.stringify(saved)) void update({ imageProfiles: { [purpose]: next } })
  }
  const fetchModels = async (): Promise<void> => {
    if (!backend) return
    setLoading(true)
    try {
      const list = await invoke('imageBackends:models', backend.id)
      setModels(list.models)
      if (!list.models.length) toast.info(list.note ?? 'This backend didn’t list any models.')
    } catch (err) {
      toast.error(err, 'Could not list models')
    } finally {
      setLoading(false)
    }
  }

  const summary = [
    draft.backendId ? backend?.name : null,
    draft.model.trim() || null,
    draft.width && draft.height ? `${draft.width}×${draft.height}` : null,
    draft.steps ? `${draft.steps} steps` : null
  ].filter(Boolean)
  const listId = `ip-models-${purpose}`

  return (
    <Disclosure
      title={`${info.label} · ${info.hint}`}
      badge={<span className="text-xs font-normal text-muted-foreground">{summary.length ? summary.join(' · ') : 'Backend defaults'}</span>}
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Backend" htmlFor={`ip-backend-${purpose}`} className="py-0">
          <NativeSelect id={`ip-backend-${purpose}`} value={draft.backendId ?? ''} onChange={(e) => save({ backendId: e.target.value || null, workflowId: null })}>
            <option value="">Default ({defaultBackend?.name ?? 'none'})</option>
            {settings.imageBackends.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Model / checkpoint" htmlFor={`ip-model-${purpose}`} className="py-0">
          <div className="flex gap-2">
            <Input
              id={`ip-model-${purpose}`}
              list={listId}
              value={draft.model}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
              onBlur={() => save({})}
              placeholder="The backend’s model"
              className="font-mono text-[13px]"
            />
            <datalist id={listId}>{models?.map((m) => <option key={m} value={m} />)}</datalist>
            <Tip label="List the backend’s models">
              <Button variant="outline" size="icon" aria-label={`List models for ${info.label}`} onClick={() => void fetchModels()} disabled={loading || !backend}>
                {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              </Button>
            </Tip>
          </div>
        </Field>
        {workflows.length > 0 && (
          <Field label="ComfyUI workflow" htmlFor={`ip-wf-${purpose}`} className="py-0">
            <NativeSelect id={`ip-wf-${purpose}`} value={draft.workflowId ?? ''} onChange={(e) => save({ workflowId: e.target.value || null })}>
              <option value="">Tagged for {info.label.toLowerCase()} (or the default)</option>
              {workflows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        <div className="grid grid-cols-3 gap-2">
          <NumberInput label="Width" value={draft.width} min={0} max={4096} step={64} onChange={(v) => save({ width: v })} />
          <NumberInput label="Height" value={draft.height} min={0} max={4096} step={64} onChange={(v) => save({ height: v })} />
          <NumberInput label="Steps" value={draft.steps} min={0} max={200} onChange={(v) => save({ steps: v })} />
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">0 means automatic: the backend’s size{purpose === 'scene' ? ' as landscape' : purpose === 'portrait' ? ' as portrait' : purpose === 'map' ? ' at 4:3' : ''}, and its steps.</p>
      <Field label="Style" htmlFor={`ip-style-${purpose}`} description="Added to the front of every prompt for this kind of image." className="py-0">
        <Input id={`ip-style-${purpose}`} value={draft.style} onChange={(e) => setDraft({ ...draft, style: e.target.value })} onBlur={() => save({})} placeholder={info.style ? `e.g. ${info.style}` : 'Optional'} />
      </Field>
      <Field label="Negative prompt" htmlFor={`ip-neg-${purpose}`} description="Added to the backend’s negative prompt." className="py-0">
        <Input id={`ip-neg-${purpose}`} value={draft.negative} onChange={(e) => setDraft({ ...draft, negative: e.target.value })} onBlur={() => save({})} placeholder={purpose === 'map' ? 'e.g. text, labels, people' : 'Optional'} />
      </Field>
    </Disclosure>
  )
}
