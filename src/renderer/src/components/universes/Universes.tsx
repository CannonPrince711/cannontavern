import { useEffect, useState } from 'react'
import { Globe2, Loader2, Plus, Save, Sparkles } from 'lucide-react'
import type { UniverseSummary } from '@shared/types'
import type { Universe, UniverseDraft } from '@shared/universes'
import { findRuleset, RulesetPicker, useRulesets } from '@/components/rulesets/Rulesets'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input, Label, Textarea } from '@/components/ui/input'
import { invoke } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { toast } from '@/stores/toasts'
import { useUi } from '@/stores/ui'
import { useVault } from '@/stores/vault'

const NO_UNIVERSES: UniverseSummary[] = []

export function useUniverses(): UniverseSummary[] {
  return useVault((s) => s.index?.universes ?? NO_UNIVERSES)
}

type Form = Omit<Universe, 'path' | 'body'> & { path?: string }

/**
 * Universes: shared worlds that campaigns are set in. Make one with the AI
 * (bible plus a lorebook of places, factions and history), edit it, and
 * choose which campaigns live there.
 */
export function UniversesDialog(): React.JSX.Element | null {
  const open = useUi((s) => s.managingUniverses)
  const universes = useUniverses()
  const campaigns = useVault((s) => s.index?.campaigns)
  const [selected, setSelected] = useState<string | 'new' | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [concept, setConcept] = useState('')
  const [draft, setDraft] = useState<UniverseDraft | null>(null)
  const [busy, setBusy] = useState<'gen' | 'save' | null>(null)
  const rulesets = useRulesets()

  // Open on the first universe, or the "new" page when there are none.
  useEffect(() => {
    if (open && selected === null) setSelected(universes[0]?.folder ?? 'new')
    if (!open) setSelected(null)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setForm(null)
    if (!selected || selected === 'new') return
    let stale = false
    invoke('universes:get', selected)
      .then((u) => !stale && u && setForm({ path: u.path, name: u.name, blurb: u.blurb, setting: u.setting, tone: u.tone, ...(u.ruleset ? { ruleset: u.ruleset } : {}), lorebooks: u.lorebooks }))
      .catch((err) => toast.error(err, 'Couldn’t read the universe'))
    return () => {
      stale = true
    }
  }, [selected])

  if (!open) return null
  const close = (): void => useUi.setState({ managingUniverses: false })
  const set = <K extends keyof Form>(k: K, v: Form[K]): void => setForm((f) => (f ? { ...f, [k]: v } : f))
  const inside = (campaigns ?? []).filter((c) => selected && selected !== 'new' && c.universe?.toLowerCase() === selected.toLowerCase())
  const outside = (campaigns ?? []).filter((c) => !inside.includes(c))

  const generate = async (): Promise<void> => {
    setBusy('gen')
    try {
      setDraft(await invoke('universes:generate', concept))
    } catch (err) {
      toast.error(err, 'Couldn’t create the universe')
    } finally {
      setBusy(null)
    }
  }
  const create = async (d: UniverseDraft): Promise<void> => {
    setBusy('save')
    try {
      const u = await invoke('universes:create', d)
      toast.success(`${u.name} created`, d.places.length + d.factions.length ? 'Its places, factions and history are in a lorebook every campaign there shares.' : undefined)
      setDraft(null)
      setConcept('')
      setSelected(u.path)
    } catch (err) {
      toast.error(err, 'Couldn’t save the universe')
    } finally {
      setBusy(null)
    }
  }
  const save = async (): Promise<void> => {
    if (!form) return
    setBusy('save')
    try {
      await invoke('universes:save', form)
      toast.success(`${form.name} saved`)
    } catch (err) {
      toast.error(err, 'Couldn’t save the universe')
    } finally {
      setBusy(null)
    }
  }
  const move = async (campaignPath: string, universe: string | null): Promise<void> => {
    try {
      await invoke('campaigns:update', campaignPath, { universe })
    } catch (err) {
      toast.error(err, 'Couldn’t move the campaign')
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="w-[min(920px,calc(100vw-48px))]">
        <DialogHeader>
          <DialogTitle>Universes</DialogTitle>
          <DialogDescription>Shared worlds for your campaigns: each campaign set in one gets its setting, lorebooks and ruleset, and characters can join the whole universe.</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 grid-cols-[200px_1fr] gap-4 overflow-hidden px-6 pb-2">
          <nav className="space-y-0.5 overflow-y-auto" aria-label="Universes">
            {universes.map((u) => (
              <button
                key={u.folder}
                type="button"
                onClick={() => setSelected(u.folder)}
                className={cn('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent', selected === u.folder && 'bg-accent')}
              >
                <Globe2 className="size-4 shrink-0 text-gold" />
                <span className="truncate">{u.displayName}</span>
              </button>
            ))}
            <button type="button" onClick={() => setSelected('new')} className={cn('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent', selected === 'new' && 'bg-accent text-foreground')}>
              <Plus className="size-4" /> New universe
            </button>
          </nav>

          <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
            {selected === 'new' ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="uv-concept">Have the AI make it</Label>
                  <Textarea
                    id="uv-concept"
                    rows={3}
                    value={concept}
                    onChange={(e) => setConcept(e.target.value)}
                    placeholder="e.g. a superhero city where powers came from a fallen moon · a dying sun with floating kingdoms · gothic Victorian horror with secret societies"
                  />
                  <div className="flex gap-2">
                    <Button onClick={() => void generate()} disabled={busy !== null || !concept.trim()}>
                      {busy === 'gen' ? <Loader2 className="animate-spin" /> : <Sparkles />} {draft ? 'Try again' : 'Create with AI'}
                    </Button>
                    <Button variant="ghost" disabled={busy !== null || !concept.trim()} onClick={() => void create({ name: concept.trim().slice(0, 80), blurb: '', tone: '', setting: '', ruleset: '', places: [], factions: [], history: [] })}>
                      Blank universe named this
                    </Button>
                  </div>
                  {busy === 'gen' && <p className="text-xs text-muted-foreground">Writing the world… this can take a minute or two.</p>}
                </div>
                {draft && (
                  <section className="space-y-2 rounded-lg border p-3">
                    <h3 className="font-display text-base">{draft.name}</h3>
                    {draft.blurb && <p className="text-sm text-muted-foreground">{draft.blurb}</p>}
                    <p className="text-sm whitespace-pre-wrap">{draft.setting}</p>
                    {[['Places', draft.places], ['Factions', draft.factions], ['History', draft.history]].map(([label, list]) =>
                      (list as UniverseDraft['places']).length ? (
                        <div key={label as string}>
                          <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label as string}</h4>
                          <ul className="mt-1 space-y-1 text-sm">
                            {(list as UniverseDraft['places']).map((e) => (
                              <li key={e.name}>
                                <b>{e.name}</b>: {e.text}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null
                    )}
                    <Button onClick={() => void create(draft)} disabled={busy !== null}>
                      {busy === 'save' && <Loader2 className="animate-spin" />} Create this universe
                    </Button>
                  </section>
                )}
              </>
            ) : !form ? (
              <div className="grid place-items-center py-16 text-muted-foreground">
                <Loader2 className="size-5 animate-spin" />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="uv-name">Name</Label>
                    <Input id="uv-name" value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={80} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="uv-tone">Tone</Label>
                    <Input id="uv-tone" value={form.tone} onChange={(e) => set('tone', e.target.value)} maxLength={300} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="uv-blurb">One-line pitch</Label>
                  <Input id="uv-blurb" value={form.blurb} onChange={(e) => set('blurb', e.target.value)} maxLength={300} />
                </div>
                <div className="space-y-1.5">
                  <Label>Default ruleset</Label>
                  <RulesetPicker variant="select" value={findRuleset(rulesets, form.ruleset)?.id ?? 'dnd5e'} onChange={(r) => set('ruleset', r.id)} />
                  <p className="text-xs text-muted-foreground">Campaigns that join take it on unless they have their own.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="uv-setting">Setting bible</Label>
                  <Textarea id="uv-setting" rows={9} value={form.setting} onChange={(e) => set('setting', e.target.value)} />
                  <p className="text-xs text-muted-foreground">The DM reads this in every campaign set here, before the campaign’s own setting.</p>
                </div>
                {form.lorebooks.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Shared lorebooks: {form.lorebooks.map((l) => l.replace(/^\[\[|\]\]$/g, '').split('|').pop()!.split('/').pop()).join(', ')}
                  </p>
                )}
                <section className="space-y-1.5">
                  <h3 className="text-sm font-medium">Campaigns in this universe</h3>
                  {inside.length === 0 && <p className="text-xs text-muted-foreground">None yet. Add one below, or pick this universe in the campaign builder.</p>}
                  <ul className="space-y-1">
                    {inside.map((c) => (
                      <li key={c.path} className="flex items-center gap-2 text-sm">
                        <span className="flex-1 truncate">{c.displayName}</span>
                        <Button size="sm" variant="ghost" onClick={() => void move(c.path, null)}>
                          Remove
                        </Button>
                      </li>
                    ))}
                  </ul>
                  {outside.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {outside.map((c) => (
                        <button key={c.path} type="button" onClick={() => void move(c.path, form.path!)} className="flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-xs hover:bg-accent">
                          <Plus className="size-3" /> {c.displayName}
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Close
          </Button>
          {form && selected !== 'new' && (
            <Button onClick={() => void save()} disabled={busy !== null || !form.name.trim()}>
              {busy === 'save' ? <Loader2 className="animate-spin" /> : <Save />} Save universe
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
