import { useState } from 'react'
import { FileJson, FileUp, ImagePlus, Loader2, Plug, UserPlus } from 'lucide-react'
import type { ImageBackendInput, ImageBackendType } from '@shared/settings'
import type { TestResult } from '@shared/types'
import { TestResultPanel } from '@/components/settings/fields'
import { SecretField } from '@/components/settings/SecretField'
import { Button } from '@/components/ui/button'
import { Callout, Field } from '@/components/ui/controls'
import { Input } from '@/components/ui/input'
import { IMAGE_PRESETS, newImageBackend } from '@/lib/backends'
import { invoke } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { useApp } from '@/stores/app'
import { toast } from '@/stores/toasts'
import { useVault } from '@/stores/vault'
import { StepHeader, type StepProps } from './Wizard'

function ImageCard(): React.JSX.Element {
  const existing = useApp((s) => s.settings?.imageBackends)
  const [draft, setDraft] = useState<ImageBackendInput | null>(null)
  const [test, setTest] = useState<TestResult | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const pick = (type: ImageBackendType): void => {
    setDraft(newImageBackend(type, existing?.map((b) => b.name) ?? []))
    setTest(null)
    setSaved(false)
  }
  const importWorkflow = async (): Promise<void> => {
    if (!draft) return
    setBusy('import')
    try {
      const info = await invoke('comfy:importWorkflow')
      if (!info) return
      const wf = { id: crypto.randomUUID(), name: info.file.replace(/\.json$/i, ''), purpose: 'scene' as const, location: 'appdata' as const, file: info.file, mapping: info.guess, seedMode: 'random' as const, fixedSeed: 0, checkpoint: '', lora: '', loraStrength: 0.8 }
      setDraft({ ...draft, comfy: { ...draft.comfy, workflows: [...draft.comfy.workflows, wf], defaultWorkflowId: draft.comfy.defaultWorkflowId ?? wf.id } })
      toast.success(`Imported ${wf.name}`)
    } catch (err) {
      toast.error(err, 'Could not import the workflow')
    } finally {
      setBusy(null)
    }
  }
  const run = async (kind: 'test' | 'save'): Promise<void> => {
    if (!draft) return
    setBusy(kind)
    try {
      if (kind === 'test') setTest(await invoke('imageBackends:test', draft, draft.comfy.defaultWorkflowId ?? undefined))
      else {
        useApp.setState({ settings: await invoke('imageBackends:save', draft) })
        setSaved(true)
      }
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="rounded-xl border bg-card/70 p-4">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <ImagePlus className="size-4 text-gold" /> Images <span className="text-xs font-normal text-muted-foreground">(optional)</span>
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">Illustrate scenes and paint portraits. You can add this later in Settings.</p>
      {existing?.length ? <Callout tone="emerald" className="mb-3">Already set up: {existing.map((b) => b.name).join(', ')}</Callout> : null}
      <div className="grid grid-cols-3 gap-2">
        {IMAGE_PRESETS.filter((p) => p.type !== 'custom').map((p) => (
          <button key={p.type} type="button" onClick={() => pick(p.type)} aria-pressed={draft?.type === p.type} className={cn('rounded-lg border bg-card px-3 py-2 text-left text-sm hover:bg-accent', draft?.type === p.type && 'border-primary ring-1 ring-primary')}>
            {p.label}
          </button>
        ))}
      </div>
      {draft && (
        <div className="mt-3 space-y-1">
          <Field label="Base URL" className="py-1">
            <Input value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} className="font-mono text-xs" />
          </Field>
          {draft.type === 'openai' && (
            <Field label="API key" className="py-1">
              <SecretField value={draft.apiKey} onChange={(v) => setDraft({ ...draft, apiKey: v })} />
            </Field>
          )}
          {draft.type === 'comfyui' && (
            <div className="flex items-center gap-2 py-1">
              <Button variant="outline" size="sm" onClick={() => void importWorkflow()} disabled={busy !== null}>
                {busy === 'import' ? <Loader2 className="animate-spin" /> : <FileJson />} Import workflow (API format)
              </Button>
              <span className="text-xs text-muted-foreground">{draft.comfy.workflows.length ? `${draft.comfy.workflows.length} workflow(s), mapped automatically` : 'Needed before generating'}</span>
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => void run('test')} disabled={busy !== null || (draft.type === 'comfyui' && !draft.comfy.workflows.length)}>
              {busy === 'test' ? <Loader2 className="animate-spin" /> : <Plug />} Test
            </Button>
            <Button size="sm" onClick={() => void run('save')} disabled={busy !== null || saved}>
              {busy === 'save' && <Loader2 className="animate-spin" />} {saved ? 'Saved' : 'Save'}
            </Button>
          </div>
          {test && <TestResultPanel result={test} />}
        </div>
      )}
    </section>
  )
}

function CharacterCard(): React.JSX.Element {
  const characters = useVault((s) => s.index?.characters)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const create = async (): Promise<void> => {
    setBusy(true)
    try {
      const note = await invoke('characters:create', name.trim())
      useVault.getState().selectCharacter(note.path)
      toast.success(`${note.card.name} created`, 'Fill in the card and sheet any time.')
      setName('')
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }
  const importCards = async (): Promise<void> => {
    try {
      const notes = await invoke('characters:import')
      if (notes.length) toast.success(`Imported ${notes.map((n) => n.card.name).join(', ')}`)
    } catch (err) {
      toast.error(err, 'Import failed')
    }
  }
  return (
    <section className="rounded-xl border bg-card/70 p-4">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <UserPlus className="size-4 text-gold" /> Your character
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">Create one, import SillyTavern cards, or skip and play the sample character from the next step.</p>
      {characters?.length ? <Callout tone="emerald" className="mb-3">In your vault: {characters.map((c) => c.displayName).join(', ')}</Callout> : null}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) void create()
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Character name" aria-label="Character name" />
        <Button type="submit" disabled={!name.trim() || busy}>
          {busy && <Loader2 className="animate-spin" />} Create
        </Button>
      </form>
      <Button variant="link" size="sm" className="mt-1 px-0" onClick={() => void importCards()}>
        <FileUp /> Import SillyTavern cards (PNG or JSON)…
      </Button>
    </section>
  )
}

export function ExtrasStep({ next, back }: StepProps): React.JSX.Element {
  return (
    <div>
      <StepHeader title="Images & characters">Both optional. Everything here is also in Settings and the sidebar.</StepHeader>
      <div className="space-y-4">
        <ImageCard />
        <CharacterCard />
      </div>
      <div className="mt-8 flex justify-between">
        <Button variant="ghost" onClick={back}>
          Back
        </Button>
        <Button onClick={next}>Continue</Button>
      </div>
    </div>
  )
}
