import { useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import { Crosshair, FileImage, ImagePlus, Loader2, MapPin as PinIcon, Plus, Shield, Trash2, Wand2, X } from 'lucide-react'
import { nearestPin, PIN_KIND_INFO, PIN_KINDS, SCALE_UNITS, type CampaignMap, type MapPin, type PartyMarker, type PinKind, type ScaleUnit } from '@shared/map'
import { Button } from '@/components/ui/button'
import { NativeSelect, Switch } from '@/components/ui/controls'
import { Input, Label, Textarea } from '@/components/ui/input'
import { Tip } from '@/components/ui/tooltip'
import { invoke, on } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { useApp } from '@/stores/app'
import { useChat } from '@/stores/chat'
import { toast } from '@/stores/toasts'
import { useUi } from '@/stores/ui'
import { useVault, vaultUrl } from '@/stores/vault'

// ── Store ───────────────────────────────────────────────────────────────────

interface MapStore {
  campaignPath: string | null
  map: CampaignMap | null
  open: boolean
  load: (campaignPath: string | null) => Promise<void>
  /** Optimistic local change, saved shortly after. */
  change: (patch: Partial<Pick<CampaignMap, 'image' | 'pins' | 'party' | 'aspect' | 'scale'>>) => void
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
let lastSave = 0

export const useMap = create<MapStore>((set, get) => ({
  campaignPath: null,
  map: null,
  open: false,
  async load(campaignPath) {
    if (!campaignPath) return set({ campaignPath: null, map: null })
    if (campaignPath !== get().campaignPath) set({ campaignPath, map: null })
    try {
      const map = await invoke('maps:get', campaignPath)
      if (get().campaignPath === campaignPath) set({ map })
    } catch {
      /* no vault */
    }
  },
  change(patch) {
    const { map, campaignPath } = get()
    if (!map || !campaignPath) return
    const next = { ...map, ...patch }
    set({ map: next })
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      lastSave = Date.now()
      invoke('maps:save', campaignPath, { image: next.image, pins: next.pins, party: next.party, aspect: next.aspect, scale: next.scale })
        .then((saved) => get().campaignPath === campaignPath && set({ map: { ...get().map!, path: saved.path, exists: true } }))
        .catch((err) => toast.error(err, 'Could not save the map'))
    }, 350)
  }
}))

/** Keeps the map store on the active campaign and in sync with edits made in Obsidian. */
export function useMapSync(): void {
  // The open session's campaign wins over the sidebar's active one.
  const sessionCampaign = useChat((s) => s.session?.campaignPath)
  const activeCampaign = useVault((s) => s.activeCampaign)
  const campaign = sessionCampaign ?? activeCampaign
  useEffect(() => {
    void useMap.getState().load(campaign)
  }, [campaign])
  useEffect(
    () =>
      on('vault:changed', (e) => {
        const { map, campaignPath } = useMap.getState()
        // Ignore the echo of our own save.
        if (map && campaignPath && e.path === map.path && Date.now() - lastSave > 1500) void useMap.getState().load(campaignPath)
      }),
    []
  )
}

const newId = (): string => `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`

/** Posts a travel note so the DM knows where the party went. */
async function announce(pin: MapPin): Promise<void> {
  if (!useApp.getState().settings?.play.announceTravel) return
  const session = useChat.getState().session
  if (!session || session.campaignPath !== useMap.getState().campaignPath) return
  await useChat.getState().post({ role: 'system', text: `The party travels to ${pin.name}.`, swipes: [], swipeIndex: 0 })
}

// ── Map surface (shared by the full view and the mini-map) ─────────────────

function PinMarker({ pin, selected, scale = 1, small }: { pin: MapPin; selected?: boolean; scale?: number; small?: boolean }): React.JSX.Element {
  return (
    <span
      // Positioned by the inline transform only (Tailwind's translate-* classes would add a second offset).
      className="pointer-events-none absolute flex flex-col items-center"
      style={{ left: `${pin.x! * 100}%`, top: `${pin.y! * 100}%`, transform: `translate(-50%, ${small ? '-50%' : '-100%'}) scale(${1 / scale})`, transformOrigin: small ? 'center' : 'bottom center' }}
    >
      {small ? (
        <span className="size-2 rounded-full ring-1 ring-black/40" style={{ background: PIN_KIND_INFO[pin.kind].color }} />
      ) : (
        <>
          <span className={cn('mb-0.5 max-w-40 truncate rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white', selected && 'ring-1 ring-white')}>{pin.name}</span>
          <PinIcon className="size-6 drop-shadow" style={{ color: PIN_KIND_INFO[pin.kind].color }} fill="currentColor" stroke="#0008" />
        </>
      )}
    </span>
  )
}

function PartyToken({ party, scale = 1, small }: { party: PartyMarker; scale?: number; small?: boolean }): React.JSX.Element {
  return (
    <span
      className="pointer-events-none absolute grid place-items-center rounded-full border-2 border-white bg-emerald text-white shadow-lg"
      style={{ left: `${party.x * 100}%`, top: `${party.y * 100}%`, width: small ? 12 : 28, height: small ? 12 : 28, transform: `translate(-50%, -50%) scale(${1 / scale})` }}
      aria-label="The party"
    >
      {!small && <Shield className="size-3.5" />}
    </span>
  )
}

// ── Full map view ───────────────────────────────────────────────────────────

function ImageChooser({ campaignPath, onClose }: { campaignPath: string; onClose?: () => void }): React.JSX.Element {
  const change = useMap((s) => s.change)
  const hasImageBackend = useApp((s) => (s.settings?.imageBackends.length ?? 0) > 0)
  const [images, setImages] = useState<string[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [extra, setExtra] = useState('')
  useEffect(() => {
    void invoke('maps:images', campaignPath).then(setImages).catch(() => setImages([]))
  }, [campaignPath])
  const use = (image: string): void => {
    change({ image })
    onClose?.()
  }
  const run = async (kind: 'file' | 'ai'): Promise<void> => {
    setBusy(kind)
    try {
      const path = kind === 'file' ? await invoke('maps:importImage', campaignPath) : await invoke('maps:generate', campaignPath, extra.trim() || undefined)
      if (path) use(path)
    } catch (err) {
      toast.error(err, kind === 'ai' ? 'Could not generate the map' : 'Could not import the image')
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="mx-auto w-full max-w-xl space-y-4 rounded-xl border bg-card/80 p-5 shadow-card">
      <h3 className="font-display text-base font-semibold tracking-wide">Choose a map image</h3>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={() => void run('file')} disabled={busy !== null}>
          {busy === 'file' ? <Loader2 className="animate-spin" /> : <FileImage />} Choose a file…
        </Button>
        <Button onClick={() => void run('ai')} disabled={busy !== null || !hasImageBackend}>
          {busy === 'ai' ? <Loader2 className="animate-spin" /> : <Wand2 />} Generate with AI
        </Button>
      </div>
      {hasImageBackend && (
        <Input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Optional details for the AI map, e.g. an island chain with a volcano" aria-label="Map details" />
      )}
      {busy === 'ai' && <p className="text-xs text-muted-foreground">Painting the map with your image backend. This can take a minute.</p>}
      {images && images.length > 0 && (
        <div className="space-y-2">
          <Label>Or use an image from this campaign</Label>
          <div className="grid max-h-56 grid-cols-4 gap-2 overflow-y-auto">
            {images.map((p) => (
              <button key={p} type="button" onClick={() => use(p)} className="overflow-hidden rounded-md border hover:ring-2 hover:ring-primary" title={p.split('/').pop()}>
                <img src={vaultUrl(p)} alt={p.split('/').pop()} className="aspect-square w-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        </div>
      )}
      {onClose && (
        <div className="text-right">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  )
}

function PinEditor({ pin, onChange, onDelete, onPartyHere }: { pin: MapPin; onChange: (p: Partial<MapPin>) => void; onDelete: () => void; onPartyHere: () => void }): React.JSX.Element {
  const index = useVault((s) => s.index)
  const target = pin.note?.trim().toLowerCase()
  const person = target ? index?.characters.concat(index.npcs).find((c) => c.displayName.toLowerCase() === target || c.name.toLowerCase() === target) : undefined
  return (
    <div className="space-y-2.5 rounded-lg border bg-card/70 p-3">
      <div className="space-y-1">
        <Label htmlFor="pin-name">Name</Label>
        <Input id="pin-name" value={pin.name} onChange={(e) => onChange({ name: e.target.value })} autoFocus={pin.name === 'New pin'} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="pin-kind">Kind</Label>
        <NativeSelect id="pin-kind" value={pin.kind} onChange={(e) => onChange({ kind: e.target.value as PinKind })}>
          {PIN_KINDS.map((k) => (
            <option key={k} value={k}>
              {PIN_KIND_INFO[k].label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1">
        <Label htmlFor="pin-desc">Description</Label>
        <Textarea id="pin-desc" rows={3} value={pin.description} onChange={(e) => onChange({ description: e.target.value })} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="pin-note">Linked note</Label>
        <div className="flex gap-1.5">
          <Input id="pin-note" value={pin.note ?? ''} onChange={(e) => onChange({ note: e.target.value || undefined })} placeholder="e.g. Cinderhold" />
          {pin.note && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => (person ? useUi.setState({ editingCharacter: person.path }) : void invoke('vault:searchNotes', pin.note!).then((hits) => hits[0] && invoke('vault:openInObsidian', hits[0].path)).catch((err) => toast.error(err)))}
            >
              Open
            </Button>
          )}
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <Button size="sm" variant="secondary" onClick={onPartyHere} disabled={pin.x === null}>
          <Shield /> Party here
        </Button>
        <Button size="sm" variant="ghost" className="ml-auto text-crimson" onClick={onDelete}>
          <Trash2 /> Delete
        </Button>
      </div>
    </div>
  )
}

export function MapOverlay(): React.JSX.Element | null {
  const open = useMap((s) => s.open)
  const map = useMap((s) => s.map)
  const campaignPath = useMap((s) => s.campaignPath)
  const change = useMap((s) => s.change)
  const settings = useApp((s) => s.settings)
  const campaignName = useVault((s) => s.index?.campaigns.find((c) => c.path === s.activeCampaign)?.displayName)
  const [selected, setSelected] = useState<string | null>(null)
  const [placing, setPlacing] = useState<'new' | 'party' | string | null>(null)
  const [chooser, setChooser] = useState(false)
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 })
  const boxRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ kind: 'pan' | 'pin' | 'party'; id?: string; sx: number; sy: number; tx: number; ty: number; moved: boolean } | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (placing) setPlacing(null)
      else useMap.setState({ open: false })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, placing])
  useEffect(() => setView({ scale: 1, tx: 0, ty: 0 }), [map?.image])

  const pins = map?.pins ?? []
  const pin = pins.find((p) => p.id === selected) ?? null
  const unplaced = useMemo(() => pins.filter((p) => p.x === null), [pins])

  if (!open) return null
  const close = (): void => useMap.setState({ open: false })
  if (!campaignPath || !map) {
    return (
      <div className="fixed inset-x-0 top-10 bottom-0 z-40 grid place-items-center bg-background" role="dialog" aria-label="Map">
        <p className="text-sm text-muted-foreground">{campaignPath ? 'Loading the map…' : 'Choose a campaign first.'}</p>
      </div>
    )
  }

  const setPins = (next: MapPin[]): void => change({ pins: next })
  const updatePin = (id: string, patch: Partial<MapPin>): void => setPins(pins.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  const frac = (e: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const r = boxRef.current?.getBoundingClientRect()
    if (!r || !r.width) return null
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
  }
  const moveParty = (x: number, y: number): void => {
    const near = nearestPin(pins, x, y)
    const party: PartyMarker = near ? { x: near.x!, y: near.y!, at: near.id } : { x, y }
    const arrived = near && near.id !== map.party?.at
    change({ party })
    if (arrived) void announce(near)
  }
  const hitPin = (e: React.PointerEvent): MapPin | null => {
    const f = frac(e)
    return f ? nearestPin(pins, f.x, f.y, 0.025 / view.scale) : null
  }
  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    try {
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    } catch {
      /* not a capturable pointer */
    }
    const f = frac(e)
    if (placing && f) {
      if (placing === 'new') {
        const p: MapPin = { id: newId(), name: 'New pin', x: f.x, y: f.y, kind: 'location', description: '' }
        setPins([...pins, p])
        setSelected(p.id)
      } else if (placing === 'party') moveParty(f.x, f.y)
      else updatePin(placing, { x: f.x, y: f.y })
      setPlacing(null)
      return
    }
    const onParty = map.party && f && Math.hypot(map.party.x - f.x, map.party.y - f.y) < 0.02 / view.scale
    const p = onParty ? null : hitPin(e)
    drag.current = { kind: onParty ? 'party' : p ? 'pin' : 'pan', id: p?.id, sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty, moved: false }
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    const d = drag.current
    if (!d) return
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 3) d.moved = true
    if (!d.moved) return
    const f = frac(e)
    if (d.kind === 'pan') setView((v) => ({ ...v, tx: d.tx + e.clientX - d.sx, ty: d.ty + e.clientY - d.sy }))
    else if (d.kind === 'pin' && d.id && f) updatePin(d.id, { x: f.x, y: f.y })
    else if (d.kind === 'party' && f) change({ party: { x: f.x, y: f.y } })
  }
  const onPointerUp = (e: React.PointerEvent): void => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.kind === 'party' && d.moved) {
      const f = frac(e)
      if (f) moveParty(f.x, f.y)
    } else if (d.kind === 'pin' && d.id && !d.moved) setSelected(d.id)
    else if (d.kind === 'pan' && !d.moved) setSelected(null)
  }
  const onWheel = (e: React.WheelEvent): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    const k = Math.exp(-e.deltaY * 0.0015)
    setView((v) => {
      const scale = Math.max(0.5, Math.min(6, v.scale * k))
      const mx = e.clientX - rect.left - rect.width / 2
      const my = e.clientY - rect.top - rect.height / 2
      return { scale, tx: mx - ((mx - v.tx) * scale) / v.scale, ty: my - ((my - v.ty) * scale) / v.scale }
    })
  }
  const atPin = map.party?.at ? pins.find((p) => p.id === map.party!.at) : undefined

  return (
    <div className="fixed inset-x-0 top-10 bottom-0 z-40 flex flex-col bg-background" role="dialog" aria-modal aria-label="Map">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <h2 className="font-display text-base font-semibold tracking-wide">{campaignName ?? 'Campaign'} map</h2>
        <span className="text-xs text-muted-foreground">
          {pins.length} pin{pins.length === 1 ? '' : 's'}
          {atPin ? ` · party at ${atPin.name}` : ''}
        </span>
        <div className="ml-4 flex items-center gap-1.5">
          <Button size="sm" variant={placing === 'new' ? 'default' : 'outline'} onClick={() => setPlacing(placing === 'new' ? null : 'new')} disabled={chooser}>
            <Plus /> Add pin
          </Button>
          <Button size="sm" variant={placing === 'party' ? 'default' : 'outline'} onClick={() => setPlacing(placing === 'party' ? null : 'party')} disabled={chooser}>
            <Crosshair /> Place party
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setChooser(true)}>
            <ImagePlus /> {map.image ? 'Change image' : 'Add a map image'}
          </Button>
        </div>
        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <Switch aria-label="Tell the DM when the party moves" checked={settings?.play.announceTravel ?? true} onCheckedChange={(v) => void useApp.getState().updateSettings({ play: { announceTravel: v } })} /> Tell the DM when the party moves
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch aria-label="Show the mini-map" checked={settings?.behavior.miniMap ?? true} onCheckedChange={(v) => void useApp.getState().updateSettings({ behavior: { miniMap: v } })} /> Mini-map
        </label>
        <Button variant="ghost" size="icon-sm" aria-label="Close map" onClick={close}>
          <X />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div
          className={cn('relative min-w-0 flex-1 overflow-hidden bg-[#0b0a0d]', placing ? 'cursor-crosshair' : 'cursor-grab')}
          onPointerDown={!chooser ? onPointerDown : undefined}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onWheel={!chooser ? onWheel : undefined}
        >
          {chooser ? (
            <div className="grid h-full place-items-center overflow-y-auto p-6">
              <ImageChooser campaignPath={campaignPath} onClose={chooser ? () => setChooser(false) : undefined} />
            </div>
          ) : (
            <div className="absolute inset-0 grid place-items-center p-6">
              <div style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})` }} className="relative max-h-full max-w-full">
                <div ref={boxRef} className="relative">
                  {map.image ? (
                    <img
                      src={vaultUrl(map.image)}
                      alt="Campaign map"
                      className="block max-h-[calc(100vh-140px)] max-w-full select-none"
                      draggable={false}
                      onLoad={(e) => {
                        const img = e.currentTarget
                        const aspect = img.naturalWidth / img.naturalHeight
                        if (img.naturalHeight && Math.abs(aspect - map.aspect) > 0.001) change({ aspect })
                      }}
                    />
                  ) : (
                    // No image: pins live on a blank grid (the mini-map works the same way).
                    <div
                      aria-label="Blank map grid"
                      className="rounded-md border border-white/10"
                      style={{
                        width: `min(calc(100vw - 380px), calc((100vh - 150px) * ${map.aspect}))`,
                        aspectRatio: String(map.aspect),
                        background: '#16151a',
                        backgroundImage: 'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)',
                        backgroundSize: '40px 40px'
                      }}
                    />
                  )}
                  {pins.filter((p) => p.x !== null).map((p) => (
                    <PinMarker key={p.id} pin={p} selected={p.id === selected} scale={view.scale} />
                  ))}
                  {map.party && <PartyToken party={map.party} scale={view.scale} />}
                </div>
              </div>
              {placing && (
                <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-xs text-white">
                  {placing === 'new' ? 'Click the map to add a pin' : placing === 'party' ? 'Click where the party is' : 'Click the map to place this pin'} · Esc to cancel
                </div>
              )}
            </div>
          )}
        </div>
        <aside className="flex w-[300px] shrink-0 flex-col gap-3 overflow-y-auto border-l p-3" aria-label="Pins">
          <div className="flex items-center gap-2 rounded-lg border bg-card/70 px-3 py-2 text-sm">
            <Shield className="size-4 text-emerald" />
            <span className="min-w-0 flex-1 truncate">{atPin ? `Party at ${atPin.name}` : map.party ? 'Party on the road' : 'Party not placed'}</span>
          </div>
          <div className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
            <span className="shrink-0" title="How wide the whole map is, for the scale bar">Map width</span>
            <Input
              type="number"
              min={0}
              value={map.scale?.width ?? ''}
              onChange={(e) => {
                const width = Number(e.target.value)
                change({ scale: width > 0 ? { width, unit: map.scale?.unit ?? 'mi' } : null })
              }}
              placeholder="—"
              aria-label="Map width"
              className="h-7 w-20 text-xs"
            />
            <NativeSelect
              value={map.scale?.unit ?? 'mi'}
              onChange={(e) => map.scale && change({ scale: { ...map.scale, unit: e.target.value as ScaleUnit } })}
              aria-label="Map width unit"
              className="h-7 w-[4.75rem] text-xs"
            >
              {SCALE_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </NativeSelect>
          </div>
          {pin ? (
            <PinEditor
              pin={pin}
              onChange={(patch) => updatePin(pin.id, patch)}
              onDelete={() => {
                setPins(pins.filter((p) => p.id !== pin.id))
                if (map.party?.at === pin.id) change({ party: { x: map.party.x, y: map.party.y } })
                setSelected(null)
              }}
              onPartyHere={() => {
                if (pin.x === null || pin.y === null) return
                const arrived = map.party?.at !== pin.id
                change({ party: { x: pin.x, y: pin.y, at: pin.id } })
                if (arrived) void announce(pin)
              }}
            />
          ) : (
            <p className="px-1 text-xs text-muted-foreground">Click a pin to edit it, or drag it to move. Drag the green token to move the party; drop it on a pin to arrive there.</p>
          )}
          {unplaced.length > 0 && (
            <div className="space-y-1">
              <h3 className="px-1 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">Not on the map yet</h3>
              {unplaced.map((p) => (
                <div key={p.id} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent">
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <Tip label="Click the map to place it">
                    <Button size="sm" variant="ghost" className="h-6" onClick={() => setPlacing(p.id)}>
                      Place
                    </Button>
                  </Tip>
                </div>
              ))}
            </div>
          )}
          <div className="space-y-0.5">
            <h3 className="px-1 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">Pins</h3>
            {pins.filter((p) => p.x !== null).map((p) => (
              <button key={p.id} type="button" onClick={() => setSelected(p.id)} className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent', p.id === selected && 'bg-accent')}>
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: PIN_KIND_INFO[p.kind].color }} />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {map.party?.at === p.id && <Shield className="size-3.5 text-emerald" />}
              </button>
            ))}
            {pins.length === 0 && <p className="px-1 text-xs text-muted-foreground">No pins yet. Use “Add pin”.</p>}
          </div>
        </aside>
      </div>
    </div>
  )
}
