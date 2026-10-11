import { useEffect, useState } from 'react'
import { FileJson, Loader2, Star, Trash2, Wand2 } from 'lucide-react'
import type { ComfyNodeSummary } from '@shared/ipc'
import type { ComfyMapping, ComfyWorkflow, NodeInput } from '@shared/settings'
import { Button } from '@/components/ui/button'
import { Badge, Callout, Field, NativeSelect } from '@/components/ui/controls'
import { Input } from '@/components/ui/input'
import { invoke } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { toast } from '@/stores/toasts'

const MAPPING_FIELDS: { key: keyof ComfyMapping; label: string; hint: string }[] = [
  { key: 'positive', label: 'Positive prompt', hint: 'CLIPTextEncode → text' },
  { key: 'negative', label: 'Negative prompt', hint: 'CLIPTextEncode → text' },
  { key: 'seed', label: 'Seed', hint: 'KSampler → seed' },
  { key: 'width', label: 'Width', hint: 'EmptyLatentImage → width' },
  { key: 'height', label: 'Height', hint: 'EmptyLatentImage → height' },
  { key: 'steps', label: 'Steps', hint: 'KSampler → steps' },
  { key: 'cfg', label: 'CFG', hint: 'KSampler → cfg' },
  { key: 'checkpoint', label: 'Checkpoint / model', hint: 'CheckpointLoaderSimple → ckpt_name' },
  { key: 'lora', label: 'LoRA', hint: 'LoraLoader → lora_name (optional)' },
  { key: 'loraStrength', label: 'LoRA strength', hint: 'LoraLoader → strength_model (optional)' },
  { key: 'sourceImage', label: 'Source image (img2img)', hint: 'LoadImage → image; the character avatar is uploaded here' }
]

function MappingRow({ label, hint, value, nodes, onChange }: { label: string; hint: string; value: NodeInput | null; nodes: ComfyNodeSummary[]; onChange: (v: NodeInput | null) => void }): React.JSX.Element {
  const node = nodes.find((n) => n.id === value?.nodeId)
  return (
    <div className="grid grid-cols-[150px_1fr_150px] items-center gap-2 py-1">
      <div>
        <div className="text-xs font-medium">{label}</div>
        <div className="truncate text-[10px] text-muted-foreground" title={hint}>
          {hint}
        </div>
      </div>
      <NativeSelect
        aria-label={`${label}: node`}
        value={value?.nodeId ?? ''}
        onChange={(e) => {
          const n = nodes.find((x) => x.id === e.target.value)
          onChange(n ? { nodeId: n.id, input: n.inputs[0]?.name ?? '' } : null)
        }}
      >
        <option value="">Not mapped</option>
        {nodes.map((n) => (
          <option key={n.id} value={n.id}>
            #{n.id} · {n.classType}
            {n.title && n.title !== n.classType ? ` (${n.title})` : ''}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect aria-label={`${label}: input`} value={value?.input ?? ''} disabled={!node} onChange={(e) => value && onChange({ ...value, input: e.target.value })}>
        {(node?.inputs ?? []).map((i) => (
          <option key={i.name} value={i.name}>
            {i.name}
          </option>
        ))}
      </NativeSelect>
    </div>
  )
}

function WorkflowEditor({ wf, onChange }: { wf: ComfyWorkflow; onChange: (wf: ComfyWorkflow) => void }): React.JSX.Element {
  const [nodes, setNodes] = useState<ComfyNodeSummary[] | null>(null)
  const [guess, setGuess] = useState<ComfyMapping | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setNodes(null)
    setError(null)
    invoke('comfy:inspectWorkflow', wf.file, wf.location)
      .then((info) => {
        setNodes(info.nodes)
        setGuess(info.guess)
      })
      .catch((err: Error) => setError(err.message))
  }, [wf.file, wf.location])

  const setMap = (key: keyof ComfyMapping, v: NodeInput | null): void => onChange({ ...wf, mapping: { ...wf.mapping, [key]: v } })

  return (
    <div className="space-y-3 border-t px-4 py-4">
      <div className="grid grid-cols-[1fr_160px] gap-3">
        <Field label="Name" className="py-0">
          <Input value={wf.name} onChange={(e) => onChange({ ...wf, name: e.target.value })} />
        </Field>
        <Field label="Used for" className="py-0">
          <NativeSelect value={wf.purpose} onChange={(e) => onChange({ ...wf, purpose: e.target.value as ComfyWorkflow['purpose'] })}>
            <option value="portrait">Portraits</option>
            <option value="scene">Scenes</option>
            <option value="map">Maps</option>
            <option value="battlemap">Battlemaps</option>
            <option value="other">Anything</option>
          </NativeSelect>
        </Field>
      </div>
      {error && <Callout tone="crimson">{error}</Callout>}
      {!nodes && !error && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Reading the workflow…
        </p>
      )}
      {nodes && (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <h4 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Node mapping</h4>
            {guess && (
              <Button variant="ghost" size="sm" onClick={() => onChange({ ...wf, mapping: guess })}>
                <Wand2 /> Auto-detect
              </Button>
            )}
          </div>
          {MAPPING_FIELDS.map((f) => (
            <MappingRow key={f.key} label={f.label} hint={f.hint} value={wf.mapping[f.key]} nodes={nodes} onChange={(v) => setMap(f.key, v)} />
          ))}
          {!wf.mapping.positive && <Callout tone="gold" className="mt-2">Map the positive prompt, or the workflow can’t be used.</Callout>}
        </div>
      )}
      <div className="grid grid-cols-3 gap-3">
        <Field label="Seed" className="py-0">
          <NativeSelect value={wf.seedMode} onChange={(e) => onChange({ ...wf, seedMode: e.target.value as 'random' | 'fixed' })}>
            <option value="random">Random each time</option>
            <option value="fixed">Fixed</option>
          </NativeSelect>
        </Field>
        <Field label="Fixed seed" className="py-0">
          <Input type="number" value={wf.fixedSeed} disabled={wf.seedMode !== 'fixed'} onChange={(e) => onChange({ ...wf, fixedSeed: Number(e.target.value) || 0 })} />
        </Field>
        <div />
        <Field label="Checkpoint override" className="py-0" description="Leave empty to keep the workflow’s.">
          <Input value={wf.checkpoint} disabled={!wf.mapping.checkpoint} onChange={(e) => onChange({ ...wf, checkpoint: e.target.value })} placeholder="sdxl_base.safetensors" className="font-mono text-xs" />
        </Field>
        <Field label="LoRA" className="py-0">
          <Input value={wf.lora} disabled={!wf.mapping.lora} onChange={(e) => onChange({ ...wf, lora: e.target.value })} placeholder="style.safetensors" className="font-mono text-xs" />
        </Field>
        <Field label="LoRA strength" className="py-0">
          <Input type="number" step={0.05} value={wf.loraStrength} disabled={!wf.mapping.lora} onChange={(e) => onChange({ ...wf, loraStrength: Number(e.target.value) })} />
        </Field>
      </div>
    </div>
  )
}

/** The ComfyUI part of an image backend: several workflows, each with a node mapping. */
export function ComfyWorkflows({
  workflows,
  defaultId,
  onChange
}: {
  workflows: ComfyWorkflow[]
  defaultId: string | null
  onChange: (workflows: ComfyWorkflow[], defaultId: string | null) => void
}): React.JSX.Element {
  const [open, setOpen] = useState<string | null>(workflows[0]?.id ?? null)
  const [busy, setBusy] = useState(false)

  const importWorkflow = async (): Promise<void> => {
    setBusy(true)
    try {
      const info = await invoke('comfy:importWorkflow')
      if (!info) return
      const wf: ComfyWorkflow = {
        id: crypto.randomUUID(),
        name: info.file.replace(/\.json$/i, ''),
        purpose: workflows.some((w) => w.purpose === 'portrait') ? 'scene' : 'portrait',
        location: 'appdata',
        file: info.file,
        mapping: info.guess,
        seedMode: 'random',
        fixedSeed: 0,
        checkpoint: '',
        lora: '',
        loraStrength: 0.8
      }
      onChange([...workflows, wf], defaultId ?? wf.id)
      setOpen(wf.id)
      const mapped = Object.values(info.guess).filter(Boolean).length
      toast.success(`Imported ${wf.name}`, `${info.nodes.length} nodes, ${mapped} values mapped automatically. Check them below.`)
    } catch (err) {
      toast.error(err, 'Could not import the workflow')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      {workflows.length === 0 && (
        <Callout tone="muted">
          Export a workflow from ComfyUI with <strong>Save (API Format)</strong> (enable Dev mode in ComfyUI’s settings), then import it here. You can add several, for example Portrait, Scene and Map.
        </Callout>
      )}
      {workflows.map((wf) => (
        <div key={wf.id} className={cn('rounded-lg border bg-background/30', open === wf.id && 'border-primary/50')}>
          <div className="flex items-center gap-2 px-3 py-2">
            <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpen(open === wf.id ? null : wf.id)} aria-expanded={open === wf.id}>
              <FileJson className="size-4 shrink-0 text-gold" />
              <span className="truncate text-sm font-medium">{wf.name}</span>
              <Badge>{wf.purpose}</Badge>
              {!wf.mapping.positive && <Badge tone="crimson">needs mapping</Badge>}
            </button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={defaultId === wf.id ? 'Default workflow' : 'Make default workflow'}
              aria-pressed={defaultId === wf.id}
              onClick={() => onChange(workflows, wf.id)}
            >
              <Star className={defaultId === wf.id ? 'fill-gold text-gold' : undefined} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove ${wf.name}`}
              onClick={() => {
                const rest = workflows.filter((w) => w.id !== wf.id)
                onChange(rest, defaultId === wf.id ? (rest[0]?.id ?? null) : defaultId)
              }}
            >
              <Trash2 />
            </Button>
          </div>
          {open === wf.id && <WorkflowEditor wf={wf} onChange={(next) => onChange(workflows.map((w) => (w.id === wf.id ? next : w)), defaultId)} />}
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => void importWorkflow()} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <FileJson />} Import workflow (API format)…
      </Button>
    </div>
  )
}
