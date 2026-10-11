import { useEffect, useMemo, useState } from 'react'
import { Loader2, Save } from 'lucide-react'
import { EDITION_INFO, EDITIONS, SOURCEBOOKS, type Edition } from '@shared/editions'
import { PLAY_MODE_INFO, PLAY_MODES, type PlayMode } from '@shared/play'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/controls'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input, Label, Textarea } from '@/components/ui/input'
import { invoke } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { toast } from '@/stores/toasts'
import { useUi } from '@/stores/ui'
import { useVault } from '@/stores/vault'

interface Form {
  edition: Edition
  sources: string[]
  other: string
  mode: PlayMode
  setting: string
  tone: string
  house_rules: string
}

/** Campaign settings: rules edition and sourcebooks, default play mode, setting, tone and house rules. */
export function CampaignSettings(): React.JSX.Element | null {
  const path = useUi((s) => s.campaignSettings)
  const name = useVault((s) => s.index?.campaigns.find((c) => c.path === path)?.displayName)
  const [form, setForm] = useState<Form | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!path) return setForm(null)
    let stale = false
    invoke('campaigns:get', path)
      .then(({ campaign: c }) => {
        if (stale) return
        const edition = c.edition ?? '5e'
        const known = new Set(SOURCEBOOKS[edition].map((b) => b.name))
        const sources = c.sources ?? []
        setForm({
          edition,
          sources: sources.length ? sources.filter((s) => known.has(s)) : SOURCEBOOKS[edition].filter((b) => b.core).map((b) => b.name),
          other: sources.filter((s) => !known.has(s)).join(', '),
          mode: c.mode ?? 'ai-dm',
          setting: c.setting,
          tone: c.tone,
          house_rules: c.house_rules
        })
      })
      .catch((err) => toast.error(err, 'Could not read the campaign'))
    return () => {
      stale = true
    }
  }, [path])

  const groups = useMemo(() => {
    if (!form) return []
    const map = new Map<string, string[]>()
    for (const b of SOURCEBOOKS[form.edition]) map.set(b.group, [...(map.get(b.group) ?? []), b.name])
    return [...map.entries()]
  }, [form?.edition]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!path) return null
  const close = (): void => useUi.setState({ campaignSettings: null })
  const set = <K extends keyof Form>(k: K, v: Form[K]): void => setForm((f) => (f ? { ...f, [k]: v } : f))
  const toggle = (book: string): void => setForm((f) => (f ? { ...f, sources: f.sources.includes(book) ? f.sources.filter((b) => b !== book) : [...f.sources, book] } : f))
  const switchEdition = (e: Edition): void =>
    setForm((f) => (f ? { ...f, edition: e, sources: SOURCEBOOKS[e].filter((b) => b.core).map((b) => b.name) } : f))

  const save = async (): Promise<void> => {
    if (!form) return
    setBusy(true)
    try {
      const other = form.other.split(',').map((s) => s.trim()).filter(Boolean)
      await invoke('campaigns:update', path, {
        edition: form.edition,
        sources: [...form.sources, ...other],
        mode: form.mode,
        setting: form.setting,
        tone: form.tone,
        house_rules: form.house_rules
      })
      toast.success('Campaign settings saved', 'They’re in Campaign.md and used from the next reply.')
      close()
    } catch (err) {
      toast.error(err, 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="w-[min(820px,calc(100vw-48px))]">
        <DialogHeader>
          <DialogTitle>{name ?? 'Campaign'} settings</DialogTitle>
          <DialogDescription>Saved in the campaign’s Campaign.md, so you can also edit them in Obsidian.</DialogDescription>
        </DialogHeader>
        {!form ? (
          <div className="grid place-items-center py-16 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pb-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="cs-edition">Rules</Label>
                <NativeSelect id="cs-edition" value={form.edition} onChange={(e) => switchEdition(e.target.value as Edition)}>
                  {EDITIONS.map((e) => (
                    <option key={e} value={e}>
                      {EDITION_INFO[e].label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cs-mode">New sessions</Label>
                <NativeSelect id="cs-mode" value={form.mode} onChange={(e) => set('mode', e.target.value as PlayMode)}>
                  {PLAY_MODES.map((m) => (
                    <option key={m} value={m}>
                      {PLAY_MODE_INFO[m].label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>

            <section className="space-y-2">
              <div className="flex items-center gap-2">
                <h3 className="font-display text-sm font-semibold tracking-wide">Allowed sourcebooks</h3>
                <span className="text-xs text-muted-foreground">
                  {form.sources.length} selected · the DM may use rules, spells, feats, classes and monsters from these
                </span>
              </div>
              {groups.map(([group, books]) => (
                <div key={group}>
                  <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                    {group}
                    <button
                      type="button"
                      className="font-normal tracking-normal normal-case underline-offset-2 hover:text-foreground hover:underline"
                      onClick={() => setForm((f) => (f ? { ...f, sources: books.every((b) => f.sources.includes(b)) ? f.sources.filter((s) => !books.includes(s)) : [...new Set([...f.sources, ...books])] } : f))}
                    >
                      {books.every((b) => form.sources.includes(b)) ? 'none' : 'all'}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {books.map((b) => (
                      <button
                        key={b}
                        type="button"
                        aria-pressed={form.sources.includes(b)}
                        onClick={() => toggle(b)}
                        className={cn('rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-accent', form.sources.includes(b) && 'border-primary bg-primary/15 text-foreground ring-1 ring-primary')}
                      >
                        {b}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <div className="space-y-1.5 pt-1">
                <Label htmlFor="cs-other">Other books or material (comma separated)</Label>
                <Input id="cs-other" value={form.other} onChange={(e) => set('other', e.target.value)} placeholder="e.g. Dragon Magazine, homebrew races" />
              </div>
            </section>

            <div className="space-y-1.5">
              <Label htmlFor="cs-setting">Setting</Label>
              <Textarea id="cs-setting" rows={3} value={form.setting} onChange={(e) => set('setting', e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="cs-tone">Tone</Label>
                <Textarea id="cs-tone" rows={2} value={form.tone} onChange={(e) => set('tone', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cs-rules">House rules</Label>
                <Textarea id="cs-rules" rows={2} value={form.house_rules} onChange={(e) => set('house_rules', e.target.value)} />
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!form || busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Save />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
