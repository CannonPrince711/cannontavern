import { useEffect, useState } from 'react'
import { ArrowLeft, Hammer, Loader2, Plus, RefreshCw, Sparkles, Trash2, Wand2 } from 'lucide-react'
import { CAMPAIGN_SETTINGS, CAMPAIGN_TONES, emptyDraft, PREMISE_MAX, type CampaignConcept, type CampaignDraft } from '@shared/builder'
import { PLAY_MODE_INFO, PLAY_MODES, type PlayMode } from '@shared/play'
import { EDITION_INFO, EDITIONS } from '@shared/editions'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input, Label, Textarea } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/controls'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { invoke, on } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { useApp } from '@/stores/app'
import { toast } from '@/stores/toasts'
import { useUi } from '@/stores/ui'
import { useVault } from '@/stores/vault'

type Stage = 'concept' | 'drafting' | 'review'

// A stable empty list: a fresh [] from a store selector would re-render forever.
const NONE: never[] = []

const DEFAULT_CONCEPT: CampaignConcept = { name: '', premise: '', tones: [], setting: '', levels: '1–5', length: 'short', players: 1, mode: 'ai-dm', edition: '5e', avoid: '' }

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn('rounded-full border px-3 py-1 text-xs transition-colors hover:bg-accent', active && 'border-primary bg-primary/15 text-foreground ring-1 ring-primary')}
    >
      {children}
    </button>
  )
}

function Section({ title, children, onAdd, addLabel }: { title: string; children: React.ReactNode; onAdd?: () => void; addLabel?: string }): React.JSX.Element {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="font-display text-sm font-semibold tracking-wide">{title}</h3>
        {onAdd && (
          <Button variant="ghost" size="sm" className="ml-auto h-7" onClick={onAdd}>
            <Plus /> {addLabel ?? 'Add'}
          </Button>
        )}
      </div>
      {children}
    </section>
  )
}

function Card({ onRemove, children, label }: { onRemove: () => void; children: React.ReactNode; label: string }): React.JSX.Element {
  return (
    <div className="relative space-y-2 rounded-lg border bg-card/70 p-3 pr-10">
      {children}
      <Button variant="ghost" size="icon-sm" aria-label={`Remove ${label}`} className="absolute top-2 right-2 text-muted-foreground hover:text-crimson" onClick={onRemove}>
        <Trash2 />
      </Button>
    </div>
  )
}

/** Edits one list in the draft immutably. */
function listOps<K extends 'locations' | 'npcs' | 'factions' | 'outline' | 'quests' | 'secrets'>(draft: CampaignDraft, setDraft: (d: CampaignDraft) => void, key: K) {
  type Item = CampaignDraft[K][number]
  return {
    set: (i: number, patch: Partial<Item> | Item) =>
      setDraft({ ...draft, [key]: draft[key].map((x, j) => (j === i ? (typeof x === 'string' ? patch : { ...(x as object), ...(patch as object) }) : x)) }),
    remove: (i: number) => setDraft({ ...draft, [key]: draft[key].filter((_, j) => j !== i) }),
    add: (item: Item) => setDraft({ ...draft, [key]: [...draft[key], item] })
  }
}

function ConceptStep({ concept, setConcept, onDraft, onManual, hasBackend }: { concept: CampaignConcept; setConcept: (c: CampaignConcept) => void; onDraft: () => void; onManual: () => void; hasBackend: boolean }): React.JSX.Element {
  const set = <K extends keyof CampaignConcept>(k: K, v: CampaignConcept[K]): void => setConcept({ ...concept, [k]: v })
  const custom = !CAMPAIGN_SETTINGS.slice(0, -1).includes(concept.setting as (typeof CAMPAIGN_SETTINGS)[number]) && concept.setting !== ''
  const tooLong = concept.premise.length > PREMISE_MAX
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-[1fr_auto] gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="cb-name">Name (optional)</Label>
          <Input id="cb-name" value={concept.name} onChange={(e) => set('name', e.target.value)} placeholder="Leave empty and the AI will name it" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cb-levels">Levels</Label>
          <Input id="cb-levels" value={concept.levels} onChange={(e) => set('levels', e.target.value)} className="w-24" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cb-premise">Premise</Label>
        <Textarea
          id="cb-premise"
          rows={concept.premise.length > 500 ? 10 : 3}
          value={concept.premise}
          onChange={(e) => set('premise', e.target.value)}
          aria-invalid={tooLong || undefined}
          aria-describedby="cb-premise-count"
          className={cn(tooLong && 'border-crimson focus-visible:ring-crimson/40')}
          placeholder="A fog-bound fishing town where a drowned bell rings at night, and someone keeps disappearing each time it does… (or paste a whole campaign prompt)"
        />
        <p id="cb-premise-count" className={cn('text-right text-[11px] tabular-nums', tooLong ? 'text-crimson' : 'text-muted-foreground')}>
          {tooLong && 'Too long: shorten it to draft. '}
          {concept.premise.length.toLocaleString('en-US')} / {PREMISE_MAX.toLocaleString('en-US')} characters
        </p>
      </div>
      <div className="space-y-1.5">
        <Label>Tone</Label>
        <div className="flex flex-wrap gap-1.5">
          {CAMPAIGN_TONES.map((t) => (
            <Chip key={t} active={concept.tones.includes(t)} onClick={() => set('tones', concept.tones.includes(t) ? concept.tones.filter((x) => x !== t) : [...concept.tones, t].slice(-4))}>
              {t}
            </Chip>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Setting</Label>
        <div className="flex flex-wrap gap-1.5">
          {CAMPAIGN_SETTINGS.map((t) => {
            const isCustom = t === 'Your own idea'
            const active = isCustom ? custom : concept.setting === t
            return (
              <Chip key={t} active={active} onClick={() => set('setting', isCustom ? (custom ? '' : ' ') : active ? '' : t)}>
                {t}
              </Chip>
            )
          })}
        </div>
        {custom && <Input value={concept.setting.trimStart()} onChange={(e) => set('setting', e.target.value || ' ')} placeholder="Describe your setting" aria-label="Your setting" autoFocus />}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Length</Label>
          <div className="grid grid-cols-3 gap-1.5">
            {(['one-shot', 'short', 'long'] as const).map((l) => (
              <Chip key={l} active={concept.length === l} onClick={() => set('length', l)}>
                {l === 'one-shot' ? 'One-shot' : l === 'short' ? 'Short arc' : 'Long campaign'}
              </Chip>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cb-players">Player characters</Label>
          <Input id="cb-players" type="number" min={1} max={8} value={concept.players} onChange={(e) => set('players', Math.max(1, Math.min(8, Number(e.target.value) || 1)))} className="w-24" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Rules</Label>
        <div className="flex gap-1.5">
          {EDITIONS.map((e) => (
            <Chip key={e} active={concept.edition === e} onClick={() => set('edition', e)}>
              {EDITION_INFO[e].label}
            </Chip>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Who plays</Label>
        <div className="grid grid-cols-3 gap-2">
          {PLAY_MODES.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={concept.mode === m}
              onClick={() => set('mode', m)}
              className={cn('rounded-lg border px-3 py-2 text-left hover:bg-accent', concept.mode === m && 'border-primary ring-1 ring-primary')}
            >
              <span className="block text-sm font-medium">{PLAY_MODE_INFO[m].label}</span>
              <span className="block text-[11px] leading-snug text-muted-foreground">{PLAY_MODE_INFO[m].description}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cb-avoid">Keep out of the story (optional)</Label>
        <Input id="cb-avoid" value={concept.avoid} onChange={(e) => set('avoid', e.target.value)} placeholder="e.g. spiders, harm to children" />
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onManual}>
          <Hammer /> Fill it in by hand
        </Button>
        <Button onClick={onDraft} disabled={!hasBackend || tooLong}>
          <Wand2 /> Draft with AI
        </Button>
      </div>
      {!hasBackend && <p className="text-right text-xs text-muted-foreground">Add a text backend in Settings to draft with AI.</p>}
    </div>
  )
}

function ReviewStep({ draft, setDraft, mode, setMode }: { draft: CampaignDraft; setDraft: (d: CampaignDraft) => void; mode: PlayMode; setMode: (m: PlayMode) => void }): React.JSX.Element {
  const set = <K extends keyof CampaignDraft>(k: K, v: CampaignDraft[K]): void => setDraft({ ...draft, [k]: v })
  const locations = listOps(draft, setDraft, 'locations')
  const npcs = listOps(draft, setDraft, 'npcs')
  const factions = listOps(draft, setDraft, 'factions')
  const outline = listOps(draft, setDraft, 'outline')
  const quests = listOps(draft, setDraft, 'quests')
  const secrets = listOps(draft, setDraft, 'secrets')
  const field = (id: keyof CampaignDraft, label: string, rows = 3, placeholder = ''): React.JSX.Element => (
    <div className="space-y-1.5">
      <Label htmlFor={`cb-${id}`}>{label}</Label>
      <Textarea id={`cb-${id}`} rows={rows} value={draft[id] as string} onChange={(e) => set(id, e.target.value as never)} placeholder={placeholder} />
    </div>
  )
  return (
    <Tabs defaultValue="overview" className="flex min-h-0 flex-col">
      <TabsList className="mb-4 self-start">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="world">Places & people</TabsTrigger>
        <TabsTrigger value="story">Story</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="space-y-4">
        <div className="grid grid-cols-[1fr_auto] items-end gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="cb-dname">Name</Label>
            <Input id="cb-dname" value={draft.name} onChange={(e) => set('name', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cb-mode">Who plays</Label>
            <NativeSelect id="cb-mode" value={mode} onChange={(e) => setMode(e.target.value as PlayMode)} className="w-44">
              {PLAY_MODES.map((m) => (
                <option key={m} value={m}>
                  {PLAY_MODE_INFO[m].label}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        {field('pitch', 'Pitch (for the players)', 3)}
        {field('setting', 'Setting', 3)}
        <div className="grid grid-cols-2 gap-4">
          {field('tone', 'Tone', 2)}
          {field('houseRules', 'House rules', 2, 'Optional')}
        </div>
        {field('hook', 'The hook', 3)}
        {field('opening', 'Opening scene (read aloud)', 6)}
      </TabsContent>
      <TabsContent value="world" className="space-y-6">
        <Section title="Locations" onAdd={() => locations.add({ name: '', description: '', keys: [] })} addLabel="Location">
          {draft.locations.map((l, i) => (
            <Card key={i} label={l.name || 'location'} onRemove={() => locations.remove(i)}>
              <div className="grid grid-cols-[1fr_1fr] gap-2">
                <Input value={l.name} onChange={(e) => locations.set(i, { name: e.target.value })} placeholder="Name" aria-label="Location name" />
                <Input value={l.keys.join(', ')} onChange={(e) => locations.set(i, { keys: e.target.value.split(',').map((k) => k.trim()).filter(Boolean) })} placeholder="Trigger words, comma separated" aria-label="Trigger words" />
              </div>
              <Textarea rows={2} value={l.description} onChange={(e) => locations.set(i, { description: e.target.value })} placeholder="Description" aria-label="Location description" />
            </Card>
          ))}
        </Section>
        <Section title="NPCs" onAdd={() => npcs.add({ name: '', role: '', description: '', personality: '', want: '', secret: '' })} addLabel="NPC">
          {draft.npcs.map((n, i) => (
            <Card key={i} label={n.name || 'NPC'} onRemove={() => npcs.remove(i)}>
              <div className="grid grid-cols-2 gap-2">
                <Input value={n.name} onChange={(e) => npcs.set(i, { name: e.target.value })} placeholder="Name" aria-label="NPC name" />
                <Input value={n.role} onChange={(e) => npcs.set(i, { role: e.target.value })} placeholder="Role" aria-label="NPC role" />
              </div>
              <Textarea rows={2} value={n.description} onChange={(e) => npcs.set(i, { description: e.target.value })} placeholder="Description" aria-label="NPC description" />
              <div className="grid grid-cols-3 gap-2">
                <Input value={n.personality} onChange={(e) => npcs.set(i, { personality: e.target.value })} placeholder="Personality" aria-label="NPC personality" />
                <Input value={n.want} onChange={(e) => npcs.set(i, { want: e.target.value })} placeholder="Wants" aria-label="NPC wants" />
                <Input value={n.secret} onChange={(e) => npcs.set(i, { secret: e.target.value })} placeholder="Secret (DM only)" aria-label="NPC secret" />
              </div>
            </Card>
          ))}
        </Section>
        <Section title="Factions" onAdd={() => factions.add({ name: '', goal: '', description: '' })} addLabel="Faction">
          {draft.factions.map((f, i) => (
            <Card key={i} label={f.name || 'faction'} onRemove={() => factions.remove(i)}>
              <div className="grid grid-cols-2 gap-2">
                <Input value={f.name} onChange={(e) => factions.set(i, { name: e.target.value })} placeholder="Name" aria-label="Faction name" />
                <Input value={f.goal} onChange={(e) => factions.set(i, { goal: e.target.value })} placeholder="Goal" aria-label="Faction goal" />
              </div>
              <Textarea rows={2} value={f.description} onChange={(e) => factions.set(i, { description: e.target.value })} placeholder="Description" aria-label="Faction description" />
            </Card>
          ))}
        </Section>
      </TabsContent>
      <TabsContent value="story" className="space-y-6">
        <Section title="Outline" onAdd={() => outline.add({ title: '', summary: '' })} addLabel="Act">
          {draft.outline.map((o, i) => (
            <Card key={i} label={o.title || 'act'} onRemove={() => outline.remove(i)}>
              <Input value={o.title} onChange={(e) => outline.set(i, { title: e.target.value })} placeholder={`Act ${i + 1}`} aria-label="Act title" />
              <Textarea rows={2} value={o.summary} onChange={(e) => outline.set(i, { summary: e.target.value })} placeholder="What happens" aria-label="Act summary" />
            </Card>
          ))}
        </Section>
        <Section title="Starting quests" onAdd={() => quests.add('')} addLabel="Quest">
          {draft.quests.map((q, i) => (
            <div key={i} className="flex gap-2">
              <Input value={q} onChange={(e) => quests.set(i, e.target.value)} placeholder="Quest" aria-label="Quest" />
              <Button variant="ghost" size="icon" aria-label="Remove quest" onClick={() => quests.remove(i)}>
                <Trash2 />
              </Button>
            </div>
          ))}
        </Section>
        <Section title="Secrets (DM only)" onAdd={() => secrets.add('')} addLabel="Secret">
          {draft.secrets.map((q, i) => (
            <div key={i} className="flex gap-2">
              <Input value={q} onChange={(e) => secrets.set(i, e.target.value)} placeholder="Secret" aria-label="Secret" />
              <Button variant="ghost" size="icon" aria-label="Remove secret" onClick={() => secrets.remove(i)}>
                <Trash2 />
              </Button>
            </div>
          ))}
        </Section>
      </TabsContent>
    </Tabs>
  )
}

/** AI-assisted (or hand-filled) campaign creation. */
export function CampaignBuilder(): React.JSX.Element | null {
  const open = useUi((s) => s.buildingCampaign)
  const hasBackend = useApp((s) => (s.settings?.textBackends.length ?? 0) > 0)
  const characters = useVault((s) => s.index?.characters) ?? NONE
  const [stage, setStage] = useState<Stage>('concept')
  const [concept, setConcept] = useState<CampaignConcept>(DEFAULT_CONCEPT)
  const [draft, setDraft] = useState<CampaignDraft>(emptyDraft())
  const [mode, setMode] = useState<PlayMode>('ai-dm')
  const [session, setSession] = useState(true)
  const [character, setCharacter] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [run, setRun] = useState(0)

  const close = (): void => {
    useUi.setState({ buildingCampaign: false })
    setTimeout(() => {
      setStage('concept')
      setDraft(emptyDraft())
    }, 200)
  }

  const draftWithAi = async (): Promise<void> => {
    setRun((r) => r + 1)
    setStage('drafting')
    setMode(concept.mode)
    try {
      const d = await invoke('campaigns:draft', { ...concept, setting: concept.setting.trim() })
      // Ignore a draft that arrives after the user went back or closed.
      if (useUi.getState().buildingCampaign) {
        setDraft(d)
        setStage('review')
      }
    } catch (err) {
      // Cancelled: just go back to the concept.
      if ((err as { code?: string })?.code !== 'ABORTED') toast.error(err, 'Could not draft the campaign')
      setStage('concept')
    }
  }

  const create = async (): Promise<void> => {
    if (!draft.name.trim()) {
      toast.warning('Give the campaign a name first.')
      return
    }
    setBusy(true)
    try {
      const r = await invoke('campaigns:build', draft, { mode, session, edition: concept.edition, ...(character ? { characterPath: character } : {}) })
      const vault = useVault.getState()
      vault.setIndex(r.index)
      vault.setActiveCampaign(r.campaignPath)
      vault.selectSession(r.sessionPath)
      useUi.setState({ creatingCampaign: false })
      toast.success(`“${draft.name.trim()}” is ready`, 'Campaign, party, lorebook and NPC notes are in your vault.')
      close()
    } catch (err) {
      toast.error(err, 'Could not create the campaign')
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null
  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="w-[min(920px,calc(100vw-48px))]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-gold" /> Campaign builder
          </DialogTitle>
          <DialogDescription>
            {stage === 'concept' && 'Describe the campaign you want. The AI drafts the rest, and you can change everything before it’s written to your vault.'}
            {stage === 'drafting' && 'Designing your campaign…'}
            {stage === 'review' && 'Review and edit. Nothing is written until you press Create.'}
          </DialogDescription>
        </DialogHeader>
        <div key={run} className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">
          {stage === 'concept' && (
            <ConceptStep
              concept={concept}
              setConcept={setConcept}
              hasBackend={hasBackend}
              onDraft={() => void draftWithAi()}
              onManual={() => {
                setDraft(emptyDraft(concept.name))
                setMode(concept.mode)
                setStage('review')
              }}
            />
          )}
          {stage === 'drafting' && <DraftProgress key={run} onCancel={() => void invoke('campaigns:cancelDraft').catch(() => {})} />}
          {stage === 'review' && <ReviewStep draft={draft} setDraft={setDraft} mode={mode} setMode={setMode} />}
        </div>
        {stage === 'review' && (
          <DialogFooter className="flex-wrap items-center">
            <label className="mr-auto flex items-center gap-2 text-sm">
              <input type="checkbox" checked={session} onChange={(e) => setSession(e.target.checked)} className="accent-[var(--primary)]" />
              Start Session 01{mode !== 'user-dm' && draft.opening.trim() ? ' with the opening scene' : ''}
              {session && (
                <NativeSelect value={character} onChange={(e) => setCharacter(e.target.value)} className="ml-1 w-44" aria-label="Character for Session 01">
                  <option value="">No character</option>
                  {characters.map((c) => (
                    <option key={c.path} value={c.path}>
                      {c.displayName}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </label>
            <Button variant="ghost" onClick={() => setStage('concept')}>
              <ArrowLeft /> Concept
            </Button>
            {hasBackend && (
              <Button variant="outline" onClick={() => void draftWithAi()}>
                <RefreshCw /> Redraft
              </Button>
            )}
            <Button onClick={() => void create()} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Hammer />} Create campaign
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

type DraftProgressEvent = { chars: number; tokens: number; maxTokens: number; section: string | null; attempt: 'full' | 'compact' | 'rest'; streaming: boolean }

/** The draft as it streams in: what it's writing, how much, how fast, and a way out. */
function DraftProgress({ onCancel }: { onCancel: () => void }): React.JSX.Element {
  const [p, setP] = useState<DraftProgressEvent | null>(null)
  const [started] = useState(() => Date.now())
  const [firstToken, setFirstToken] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const off = on('campaigns:draftProgress', (e) => {
      setP(e)
      if (e.chars > 0) setFirstToken((t) => t ?? Date.now())
    })
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => (off(), clearInterval(timer))
  }, [])
  const elapsed = Math.floor((now - started) / 1000)
  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`
  const writingFor = firstToken ? (now - firstToken) / 1000 : 0
  const speed = p && writingFor > 2 ? p.tokens / writingFor : null
  const writing = !!p && p.chars > 0
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center" role="status">
      <Loader2 className="size-8 animate-spin text-gold" />
      <p className="font-display text-lg tracking-wide">{writing && p.section ? `Writing ${p.section}…` : 'Designing your campaign'}</p>
      <p className="max-w-md text-sm text-muted-foreground">
        {p?.attempt === 'compact'
          ? 'The first reply couldn’t be read, so it’s trying again with a smaller campaign.'
          : p?.attempt === 'rest'
            ? 'The server stopped the first reply before the lists, so it’s now adding the places, people and story.'
          : writing
            ? 'Inventing places, people, factions and secrets.'
            : p && !p.streaming
              ? 'Waiting for the whole reply (this backend doesn’t stream, so there’s no progress to show). Turn on Stream tokens in the backend’s settings to watch it write.'
              : 'Sending the concept. The model reads it first; long premises take a little while.'}
      </p>
      {writing && (
        <div className="w-full max-w-sm space-y-1.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-gold transition-[width] duration-300" style={{ width: `${Math.min(100, (p.tokens / p.maxTokens) * 100)}%` }} />
          </div>
          <p className="text-xs tabular-nums text-muted-foreground">
            ≈ {p.tokens.toLocaleString('en-US')} tokens{speed ? ` · ${speed.toFixed(1)} tokens/s` : ''} · up to {p.maxTokens.toLocaleString('en-US')}
          </p>
        </div>
      )}
      <p className="text-xs tabular-nums text-muted-foreground">{clock}</p>
      <Button variant="outline" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  )
}
