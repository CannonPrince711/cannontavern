import { useEffect, useState } from 'react'
import { BookPlus, Loader2, Sparkles } from 'lucide-react'
import { IMAGE_PURPOSES, type ImagePurpose } from '@shared/settings'
import { chatBackendId, WORLD_RESOURCE_KINDS, type ImageOverride, type WorldOverrides, type WorldResourceKind } from '@shared/world'
import { Button } from '@/components/ui/button'
import { Badge, Field, NativeSelect, SettingsGroup, Switch } from '@/components/ui/controls'
import { Input, Textarea } from '@/components/ui/input'
import { Disclosure, NumberInput } from '@/components/settings/fields'
import { invoke } from '@/lib/ipc'
import { useApp } from '@/stores/app'
import { toast } from '@/stores/toasts'
import { useVault } from '@/stores/vault'

const PURPOSE_LABEL: Record<ImagePurpose, string> = {
  scene: 'Scenes',
  portrait: 'Portraits',
  map: 'Maps',
  battlemap: 'Battlemaps',
  other: 'Other (/image)'
}

const KIND_LABEL: Record<WorldResourceKind, string> = { items: 'Gear & prices', magic: 'Magic items', creatures: 'Creatures', services: 'Shops & services', townsfolk: 'Townsfolk' }

/** "Generate resources for this world": writes a lorebook of things that fit the campaign. */
function WorldResources({ campaignPath }: { campaignPath: string }): React.JSX.Element {
  const [kinds, setKinds] = useState<WorldResourceKind[]>(['items', 'magic', 'creatures'])
  const [count, setCount] = useState(8)
  const [busy, setBusy] = useState(false)
  const generate = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await invoke('campaigns:generateResources', campaignPath, { kinds, count })
      const name = r.lorebookPath.split('/').pop()?.replace(/\.md$/i, '') ?? 'the lorebook'
      toast.success(`Added ${r.added} entries to ${name}`, 'It’s attached to this campaign; edit it like any lorebook.')
    } catch (err) {
      toast.error(err, 'Couldn’t generate resources')
    } finally {
      setBusy(false)
    }
  }
  return (
    <SettingsGroup
      title="World resources"
      description="Have the DM’s model write items, creatures and people that fit this world into a lorebook attached to the campaign. Run it again to add more. This writes the lorebook right away; it doesn’t wait for Save."
    >
      <div className="space-y-3 py-3">
        <div className="flex flex-wrap gap-1.5">
          {WORLD_RESOURCE_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kinds.includes(k)}
              onClick={() => setKinds((ks) => (ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k]))}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-accent ${kinds.includes(k) ? 'border-primary bg-primary/15 text-foreground ring-1 ring-primary' : ''}`}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <label htmlFor="ws-res-count" className="text-xs text-muted-foreground">
            Entries per kind
          </label>
          <NativeSelect id="ws-res-count" value={String(count)} onChange={(e) => setCount(Number(e.target.value))} className="w-20">
            {[4, 8, 12, 16].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </NativeSelect>
          <Button className="ml-auto" onClick={() => void generate()} disabled={busy || !kinds.length}>
            {busy ? <Loader2 className="animate-spin" /> : <BookPlus />} Generate resources for this world
          </Button>
        </div>
      </div>
    </SettingsGroup>
  )
}

/** "" = inherit, "on", "off". */
function TriSelect({ id, value, global, onChange }: { id: string; value: boolean | undefined; global: boolean; onChange: (v: boolean | undefined) => void }): React.JSX.Element {
  return (
    <NativeSelect id={id} value={value === undefined ? '' : value ? 'on' : 'off'} onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value === 'on')} className="w-44">
      <option value="">Global ({global ? 'on' : 'off'})</option>
      <option value="on">On in this world</option>
      <option value="off">Off in this world</option>
    </NativeSelect>
  )
}

/** A model picker: the installed models when known, plus whatever is set already. */
function ModelSelect({ id, value, models, inheritLabel, onChange }: { id: string; value: string | undefined; models: string[] | undefined; inheritLabel: string; onChange: (v: string | undefined) => void }): React.JSX.Element {
  const options = [...new Set([...(value ? [value] : []), ...(models ?? [])])]
  return (
    <NativeSelect id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)} className="font-mono text-[13px]">
      <option value="">{inheritLabel}</option>
      {options.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
    </NativeSelect>
  )
}

/**
 * Campaign settings → This world: overrides of the global text model, DM
 * prompt, image options and triggers. Every field shows what it falls back to.
 */
export function WorldSettings({ campaignPath, world, onChange }: { campaignPath: string; world: WorldOverrides; onChange: (w: WorldOverrides) => void }): React.JSX.Element | null {
  const settings = useApp((s) => s.settings)
  const presets = useVault((s) => s.index?.presets ?? [])
  const [imageModels, setImageModels] = useState<Record<string, string[]>>({})
  const [textModels, setTextModels] = useState<Record<string, string[]>>({})
  const [suggesting, setSuggesting] = useState(false)
  const [notes, setNotes] = useState('')

  // What's installed, so the pickers offer real choices (an offline backend just offers none).
  useEffect(() => {
    if (!settings) return
    for (const b of settings.imageBackends) {
      invoke('imageBackends:models', b.id)
        .then((l) => setImageModels((m) => ({ ...m, [b.id]: l.models })))
        .catch(() => setImageModels((m) => ({ ...m, [b.id]: [] })))
    }
    for (const b of settings.textBackends) {
      invoke('textBackends:models', b.id)
        .then((l) => setTextModels((m) => ({ ...m, [b.id]: l })))
        .catch(() => setTextModels((m) => ({ ...m, [b.id]: [] })))
    }
  }, [settings?.imageBackends.length, settings?.textBackends.length]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!settings) return null
  const set = (patch: Partial<WorldOverrides>): void => onChange({ ...world, ...patch })
  const setImage = (p: ImagePurpose, o: ImageOverride | undefined): void => onChange({ ...world, images: { ...world.images, [p]: o } })

  const globalChat = settings.textBackends.find((b) => b.id === chatBackendId(settings))
  const chat = settings.textBackends.find((b) => b.id === world.text_backend) ?? globalChat
  const globalCharacter = settings.roles.character ? settings.textBackends.find((b) => b.id === settings.roles.character) : undefined
  const summary = settings.textBackends.find((b) => b.id === (settings.roles.summary ?? settings.defaultTextBackendId)) ?? settings.textBackends[0]
  const globalPreset = settings.general.defaultPreset ? (presets.find((p) => p.path === settings.general.defaultPreset)?.name ?? 'Preset') : 'Built-in DM prompt'
  const defaultImage = settings.imageBackends.find((b) => b.id === settings.defaultImageBackendId) ?? settings.imageBackends[0]

  const suggest = async (): Promise<void> => {
    setSuggesting(true)
    try {
      const r = await invoke('campaigns:suggestGenerators', campaignPath)
      onChange({ ...world, ...r.world, images: { ...world.images, ...r.world.images } })
      setNotes(r.notes)
      toast.success('Picked models for this world', 'Review them, then Save.')
    } catch (err) {
      toast.error(err, 'Couldn’t pick models')
    } finally {
      setSuggesting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-lg border bg-background/30 p-3">
        <p className="flex-1 text-xs leading-relaxed text-muted-foreground">
          Anything set to <span className="font-medium text-foreground">Global</span> follows Settings. Override only what this world needs, for example an anime model for
          portraits, or a different DM model. {notes && <span className="mt-1 block text-foreground">{notes}</span>}
        </p>
        <Button variant="outline" onClick={() => void suggest()} disabled={suggesting}>
          {suggesting ? <Loader2 className="animate-spin" /> : <Sparkles />} Pick best for this world
        </Button>
      </div>

      <SettingsGroup title="Text models" description="The models that play the DM and the characters in this world.">
        <div className="grid grid-cols-2 gap-4 py-3">
          <Field label="Backend" htmlFor="ws-text-backend" className="py-0">
            <NativeSelect id="ws-text-backend" value={world.text_backend ?? ''} onChange={(e) => set({ text_backend: e.target.value || undefined, text_model: undefined })}>
              <option value="">Global ({globalChat?.name ?? 'none'})</option>
              {settings.textBackends.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Model" htmlFor="ws-text-model" className="py-0">
            <ModelSelect id="ws-text-model" value={world.text_model} models={chat ? textModels[chat.id] : []} inheritLabel={`The backend’s (${chat?.model || 'server default'})`} onChange={(v) => set({ text_model: v })} />
          </Field>
        </div>
        <Field
          label="Characters’ backend"
          htmlFor="ws-character-backend"
          description="Plays the characters when the AI writes as them: AI only, You are the DM, and companions. Global follows Settings → Text backends → Characters."
        >
          <NativeSelect id="ws-character-backend" value={world.character_backend ?? ''} onChange={(e) => set({ character_backend: e.target.value || undefined })}>
            <option value="">Global ({globalCharacter?.name ?? 'same as the DM'})</option>
            {settings.textBackends.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Model for summaries and recaps" htmlFor="ws-summary-model" description={`Used in the summaries backend (${summary?.name ?? 'none'}); its fallbacks keep their own models.`}>
          <ModelSelect id="ws-summary-model" value={world.summary_model} models={summary ? textModels[summary.id] : []} inheritLabel={`Global (${summary?.model || 'server default'})`} onChange={(v) => set({ summary_model: v })} />
        </Field>
        <Field inline label="Temperature" description={`Global: ${chat?.generation.temperature ?? 'backend default'}`}>
          <div className="flex items-center gap-3">
            {world.temperature !== undefined && (
              <Input type="number" min={0} max={5} step={0.05} value={world.temperature} onChange={(e) => set({ temperature: Math.min(5, Math.max(0, Number(e.target.value) || 0)) })} className="w-24" aria-label="Temperature in this world" />
            )}
            <Switch checked={world.temperature !== undefined} onCheckedChange={(on) => set({ temperature: on ? (chat?.generation.temperature ?? 0.9) : undefined })} aria-label="Override temperature" />
          </div>
        </Field>
      </SettingsGroup>

      <SettingsGroup title="DM prompt" description="How the DM is told to run this world.">
        <Field label="Preset" htmlFor="ws-preset">
          <NativeSelect id="ws-preset" value={world.preset === undefined ? '__global' : world.preset} onChange={(e) => set({ preset: e.target.value === '__global' ? undefined : e.target.value })}>
            <option value="__global">Global ({globalPreset})</option>
            <option value="">Built-in DM prompt</option>
            {presets.map((p) => (
              <option key={p.path} value={p.path}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Extra DM instructions" htmlFor="ws-dm" description="Added to the DM prompt in this world only, e.g. pacing, content limits or how NPCs talk.">
          <Textarea id="ws-dm" rows={3} value={world.dm_instructions ?? ''} onChange={(e) => set({ dm_instructions: e.target.value.trim() ? e.target.value : undefined })} placeholder="Optional" />
        </Field>
        <Field inline label="Own player prompt" description="When the AI plays the character (You are DM / AI only).">
          <Switch checked={world.player_prompt !== undefined} onCheckedChange={(on) => set({ player_prompt: on ? settings.prompt.playerPrompt : undefined })} aria-label="Override the player prompt" />
        </Field>
        {world.player_prompt !== undefined && (
          <Field label="Player prompt" htmlFor="ws-player">
            <Textarea id="ws-player" rows={3} value={world.player_prompt} onChange={(e) => set({ player_prompt: e.target.value })} placeholder="Empty uses the built-in player prompt" />
          </Field>
        )}
        <Field inline label="Use the shared Resources lore" description="The lorebooks in Resources/Lore (common gear, creatures, services, townsfolk). Turn off for worlds they don’t fit.">
          <Switch checked={world.shared_resources !== false} onCheckedChange={(on) => set({ shared_resources: on ? undefined : false })} aria-label="Use the shared Resources lore" />
        </Field>
      </SettingsGroup>

      <WorldResources campaignPath={campaignPath} />

      <SettingsGroup title="Images" description="Backend, model and style per kind of image, for this world.">
        <div className="space-y-2 py-3">
          {IMAGE_PURPOSES.map((p) => {
            const g = settings.imageProfiles[p]
            const o = world.images?.[p]
            const backend = settings.imageBackends.find((b) => b.id === (o?.backend ?? g.backendId)) ?? defaultImage
            const workflows = backend?.type === 'comfyui' ? backend.comfy.workflows : []
            const globalSummary = [g.model || null, g.width && g.height ? `${g.width}×${g.height}` : null].filter(Boolean).join(' · ') || 'backend defaults'
            return (
              <Disclosure
                key={p}
                title={PURPOSE_LABEL[p]}
                badge={o ? <Badge tone="gold">This world: {[o.model, o.style ? 'style' : null].filter(Boolean).join(' · ') || 'custom'}</Badge> : <span className="text-xs font-normal text-muted-foreground">Global · {globalSummary}</span>}
              >
                <Field inline label="Override for this world" className="py-0">
                  <Switch
                    checked={!!o}
                    onCheckedChange={(on) =>
                      setImage(
                        p,
                        on
                          ? { ...(g.backendId ? { backend: g.backendId } : {}), model: g.model, width: g.width, height: g.height, steps: g.steps, style: g.style, negative: g.negative }
                          : undefined
                      )
                    }
                    aria-label={`Override ${PURPOSE_LABEL[p]} for this world`}
                  />
                </Field>
                {o && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Backend" htmlFor={`ws-ib-${p}`} className="py-0">
                        <NativeSelect id={`ws-ib-${p}`} value={o.backend ?? ''} onChange={(e) => setImage(p, { ...o, backend: e.target.value || undefined, workflow: undefined })}>
                          <option value="">Default ({defaultImage?.name ?? 'none'})</option>
                          {settings.imageBackends.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </NativeSelect>
                      </Field>
                      <Field label="Model / checkpoint" htmlFor={`ws-im-${p}`} className="py-0">
                        <ModelSelect
                          id={`ws-im-${p}`}
                          value={o.model || undefined}
                          models={backend ? imageModels[backend.id] : []}
                          inheritLabel="The backend’s model"
                          onChange={(v) => setImage(p, { ...o, model: v ?? '' })}
                        />
                      </Field>
                      {workflows.length > 0 && (
                        <Field label="ComfyUI workflow" htmlFor={`ws-iw-${p}`} className="py-0">
                          <NativeSelect id={`ws-iw-${p}`} value={o.workflow ?? ''} onChange={(e) => setImage(p, { ...o, workflow: e.target.value || undefined })}>
                            <option value="">Tagged for {PURPOSE_LABEL[p].toLowerCase()} (or the default)</option>
                            {workflows.map((w) => (
                              <option key={w.id} value={w.id}>
                                {w.name}
                              </option>
                            ))}
                          </NativeSelect>
                        </Field>
                      )}
                      <div className="grid grid-cols-3 gap-2">
                        <NumberInput label="Width" value={o.width ?? 0} min={0} max={4096} step={64} onChange={(v) => setImage(p, { ...o, width: v })} />
                        <NumberInput label="Height" value={o.height ?? 0} min={0} max={4096} step={64} onChange={(v) => setImage(p, { ...o, height: v })} />
                        <NumberInput label="Steps" value={o.steps ?? 0} min={0} max={200} onChange={(v) => setImage(p, { ...o, steps: v })} />
                      </div>
                    </div>
                    <Field label="Style" htmlFor={`ws-is-${p}`} description="Added to the front of every prompt for this kind of image." className="py-0">
                      <Input id={`ws-is-${p}`} value={o.style ?? ''} onChange={(e) => setImage(p, { ...o, style: e.target.value })} placeholder={g.style ? `Global: ${g.style}` : 'Optional'} />
                    </Field>
                    <Field label="Negative prompt" htmlFor={`ws-in-${p}`} className="py-0">
                      <Input id={`ws-in-${p}`} value={o.negative ?? ''} onChange={(e) => setImage(p, { ...o, negative: e.target.value })} placeholder={g.negative ? `Global: ${g.negative}` : 'Optional'} />
                    </Field>
                  </>
                )}
              </Disclosure>
            )
          })}
        </div>
      </SettingsGroup>

      <SettingsGroup title="Automatic images" description="When this world paints pictures on its own.">
        <Field inline label="Portraits for new characters and NPCs" htmlFor="ws-auto-portraits" description="NPCs tied to this campaign only.">
          <TriSelect id="ws-auto-portraits" value={world.auto_portraits} global={settings.imageTriggers.autoPortraits} onChange={(v) => set({ auto_portraits: v })} />
        </Field>
        <Field inline label="Scene image when the location changes" htmlFor="ws-auto-location">
          <TriSelect id="ws-auto-location" value={world.scene_on_location_change} global={settings.imageTriggers.onLocationChange} onChange={(v) => set({ scene_on_location_change: v })} />
        </Field>
        <Field inline label="Scene image every N DM replies" description={`Global: ${settings.imageTriggers.everyNDmTurns || 'off'}. 0 turns it off in this world.`}>
          <div className="flex items-center gap-3">
            {world.scene_every !== undefined && (
              <Input type="number" min={0} max={1000} value={world.scene_every} onChange={(e) => set({ scene_every: Math.max(0, Math.round(Number(e.target.value) || 0)) })} className="w-24" aria-label="Scene image every N DM replies in this world" />
            )}
            <Switch checked={world.scene_every !== undefined} onCheckedChange={(on) => set({ scene_every: on ? settings.imageTriggers.everyNDmTurns : undefined })} aria-label="Override scene image frequency" />
          </div>
        </Field>
      </SettingsGroup>
    </div>
  )
}
