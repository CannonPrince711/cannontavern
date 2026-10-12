import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { Loader2, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
import { rulesBody, type Ruleset } from '@shared/rulesets'
import { askConfirm } from '@/components/AskDialog'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/controls'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input, Label, Textarea } from '@/components/ui/input'
import { invoke } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { toast } from '@/stores/toasts'
import { useActiveCampaign } from '@/stores/vault'

const useRulesetStore = create<{ list: Ruleset[] | null; load: () => Promise<Ruleset[]> }>((set) => ({
  list: null,
  load: async () => {
    const list = await invoke('rulesets:list')
    set({ list })
    return list
  }
}))

const NONE: Ruleset[] = []

/** Built-in and custom rulesets, loaded once and refreshed after a save. */
export function useRulesets(): Ruleset[] {
  const list = useRulesetStore((s) => s.list)
  useEffect(() => {
    if (!list) void useRulesetStore.getState().load().catch(() => {})
  }, [list])
  return list ?? NONE
}

/** The ruleset a campaign uses: its `ruleset`, else its D&D edition. */
export function findRuleset(list: Ruleset[], value: string | undefined, edition?: string): Ruleset | undefined {
  if (value) {
    const target = value.replace(/^\[\[|\]\]$/g, '').split('|')[0]!.replace(/\.md$/i, '').toLowerCase()
    const hit = list.find((r) => r.id.toLowerCase() === value.toLowerCase() || r.id.replace(/\.md$/i, '').toLowerCase() === target || (r.custom && r.id.replace(/\.md$/i, '').toLowerCase().endsWith(`/${target}`)))
    if (hit) return hit
  }
  return list.find((r) => r.id === (edition === '3.5e' ? 'dnd35' : 'dnd5e'))
}

/** The open campaign's ruleset (D&D 5e when none is open). */
export function useCampaignRuleset(): Ruleset | undefined {
  const list = useRulesets()
  const campaign = useActiveCampaign()
  return findRuleset(list, campaign?.ruleset, campaign?.edition)
}

/** Chips (campaign builder) or a select (campaign settings), plus New / Edit for custom rulesets. */
export function RulesetPicker({ value, onChange, variant = 'chips' }: { value: string; onChange: (r: Ruleset) => void; variant?: 'chips' | 'select' }): React.JSX.Element {
  const list = useRulesets()
  const [dialog, setDialog] = useState<{ ruleset?: Ruleset } | null>(null)
  const current = list.find((r) => r.id === value)

  return (
    <div className="space-y-1.5">
      {variant === 'chips' ? (
        <div className="flex flex-wrap gap-1.5">
          {list.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={value === r.id}
              title={r.blurb}
              onClick={() => onChange(r)}
              className={cn('rounded-full border px-3 py-1 text-xs transition-colors hover:bg-accent', value === r.id && 'border-primary bg-primary/15 text-foreground ring-1 ring-primary', r.custom && 'border-dashed')}
            >
              {r.name}
            </button>
          ))}
          <button type="button" onClick={() => setDialog({})} className="flex items-center gap-1 rounded-full border border-dashed px-3 py-1 text-xs text-muted-foreground hover:bg-accent">
            <Plus className="size-3" /> New ruleset…
          </button>
        </div>
      ) : (
        <div className="flex gap-1.5">
          <NativeSelect value={value} onChange={(e) => { const r = list.find((x) => x.id === e.target.value); if (r) onChange(r) }} aria-label="Ruleset" className="flex-1">
            {!current && value && <option value={value}>{value}</option>}
            <optgroup label="Built in">
              {list.filter((r) => !r.custom).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </optgroup>
            {list.some((r) => r.custom) && (
              <optgroup label="Your rulesets">
                {list.filter((r) => r.custom).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </optgroup>
            )}
          </NativeSelect>
          <Button variant="outline" size="icon" aria-label="New ruleset" title="New ruleset" onClick={() => setDialog({})}>
            <Plus />
          </Button>
        </div>
      )}
      {current && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <span className="flex-1">{current.blurb}</span>
          {current.custom && (
            <button type="button" className="flex items-center gap-1 underline-offset-2 hover:underline" onClick={() => setDialog({ ruleset: current })}>
              <Pencil className="size-3" /> Edit
            </button>
          )}
        </p>
      )}
      {dialog && <RulesetDialog ruleset={dialog.ruleset} onClose={() => setDialog(null)} onSaved={(r) => onChange(r)} />}
    </div>
  )
}

type Draft = Omit<Ruleset, 'id'> & { id?: string }

const BLANK: Draft = {
  name: '',
  short: '',
  engine: '5e',
  math: false,
  sourcebooks: false,
  rules: '',
  classes: [],
  ancestries: [],
  terms: { race: 'Race', class: 'Class', level: 'Level', spells: 'Spells' },
  blurb: '',
  custom: true
}

const stripRules = rulesBody

/** New or edit a custom ruleset: the AI drafts it from a concept, then you review and save. */
export function RulesetDialog({ ruleset, onClose, onSaved }: { ruleset?: Ruleset; onClose: () => void; onSaved?: (r: Ruleset) => void }): React.JSX.Element {
  const [draft, setDraft] = useState<Draft | null>(ruleset ? { ...ruleset, rules: stripRules(ruleset.rules) } : null)
  const [concept, setConcept] = useState('')
  const [busy, setBusy] = useState<'gen' | 'save' | null>(null)
  const d = draft ?? BLANK
  const set = <K extends keyof Draft>(k: K, v: Draft[K]): void => setDraft((x) => ({ ...(x ?? BLANK), [k]: v }))
  const setTerm = (k: keyof Draft['terms'], v: string): void => setDraft((x) => ({ ...(x ?? BLANK), terms: { ...(x ?? BLANK).terms, [k]: v } }))
  const listText = (l: string[]): string => l.join(', ')
  const parseList = (s: string): string[] => s.split(',').map((x) => x.trim()).filter(Boolean)

  const generate = async (): Promise<void> => {
    setBusy('gen')
    try {
      const r = await invoke('rulesets:generate', concept)
      setDraft({ ...r, ...(ruleset ? { id: ruleset.id } : {}), rules: stripRules(r.rules) })
    } catch (err) {
      toast.error(err, 'Couldn’t write the ruleset')
    } finally {
      setBusy(null)
    }
  }

  const save = async (): Promise<void> => {
    if (!d.name.trim()) return toast.error(new Error('Give the ruleset a name.'))
    setBusy('save')
    try {
      const saved = await invoke('rulesets:save', { ...d, name: d.name.trim(), short: (d.short.trim() || d.name.trim()).slice(0, 14), rules: `Rules: ${d.name.trim()}. ${d.rules.trim()}`, custom: true })
      await useRulesetStore.getState().load()
      toast.success(`${saved.name} saved`, 'It’s a note in Rulesets/, so you can also edit it in Obsidian.')
      onSaved?.(saved)
      onClose()
    } catch (err) {
      toast.error(err, 'Couldn’t save the ruleset')
    } finally {
      setBusy(null)
    }
  }

  const remove = async (): Promise<void> => {
    if (!ruleset) return
    if (!(await askConfirm({ title: `Delete ${ruleset.name}?`, description: 'The note goes to the Recycle Bin. Campaigns using it go back to their D&D edition.', confirmLabel: 'Delete', danger: true }))) return
    try {
      await invoke('rulesets:delete', ruleset.id)
      await useRulesetStore.getState().load()
      onClose()
    } catch (err) {
      toast.error(err, 'Couldn’t delete the ruleset')
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(760px,calc(100vw-48px))]">
        <DialogHeader>
          <DialogTitle>{ruleset ? `Edit ${ruleset.name}` : 'New ruleset'}</DialogTitle>
          <DialogDescription>Describe a game and the AI writes its rules, or write them yourself. Review everything before saving.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-y-auto px-6 pb-2">
          <div className="space-y-1.5">
            <Label htmlFor="rs-concept">Have the AI make it</Label>
            <div className="flex gap-2">
              <Textarea
                id="rs-concept"
                rows={2}
                value={concept}
                onChange={(e) => setConcept(e.target.value)}
                placeholder="e.g. gritty cyberpunk with hacking and street cred · cosmic horror with sanity · Shadowrun · a cozy magic-school game"
                className="flex-1"
              />
              <Button onClick={() => void generate()} disabled={!concept.trim() || busy !== null} className="self-end">
                {busy === 'gen' ? <Loader2 className="animate-spin" /> : <Sparkles />}
                {draft ? 'Rewrite' : 'Write it'}
              </Button>
            </div>
            {busy === 'gen' && <p className="text-xs text-muted-foreground">Writing the rules… this can take a minute.</p>}
          </div>

          <div className="grid grid-cols-[2fr_1fr_1fr] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rs-name">Name</Label>
              <Input id="rs-name" value={d.name} onChange={(e) => set('name', e.target.value)} maxLength={80} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rs-short">Short label</Label>
              <Input id="rs-short" value={d.short} onChange={(e) => set('short', e.target.value)} maxLength={14} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rs-engine">Character sheet</Label>
              <NativeSelect id="rs-engine" value={d.engine} onChange={(e) => set('engine', e.target.value as Draft['engine'])}>
                <option value="5e">5e-style</option>
                <option value="3.5e">3.5e-style</option>
              </NativeSelect>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rs-blurb">One-line pitch</Label>
            <Input id="rs-blurb" value={d.blurb} onChange={(e) => set('blurb', e.target.value)} maxLength={300} />
          </div>
          <div className="grid grid-cols-4 gap-3">
            {(['race', 'class', 'level', 'spells'] as const).map((k) => (
              <div key={k} className="space-y-1.5">
                <Label htmlFor={`rs-term-${k}`}>“{k[0]!.toUpperCase() + k.slice(1)}” is called</Label>
                <Input id={`rs-term-${k}`} value={d.terms[k]} onChange={(e) => setTerm(k, e.target.value)} maxLength={30} />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rs-classes">{d.terms.class || 'Class'} options (comma-separated)</Label>
              <Textarea id="rs-classes" rows={2} defaultValue={listText(d.classes)} key={`c${listText(d.classes)}`} onBlur={(e) => set('classes', parseList(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rs-anc">{d.terms.race || 'Race'} options (comma-separated)</Label>
              <Textarea id="rs-anc" rows={2} defaultValue={listText(d.ancestries)} key={`a${listText(d.ancestries)}`} onBlur={(e) => set('ancestries', parseList(e.target.value))} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rs-rules">Rules for the DM</Label>
            <Textarea id="rs-rules" rows={10} value={d.rules} onChange={(e) => set('rules', e.target.value)} placeholder="The core roll, checks and DCs, combat and damage, healing and death, growth, special resources… and how to ask for checks, e.g. [CHECK hacking DC 15]." />
            <p className="text-xs text-muted-foreground">Sent to the DM with every reply, so keep it to about a page.</p>
          </div>
        </div>
        <DialogFooter>
          {ruleset?.custom && (
            <Button variant="ghost" className="mr-auto text-destructive" onClick={() => void remove()}>
              <Trash2 /> Delete
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy !== null || !d.name.trim() || !d.rules.trim()}>
            {busy === 'save' && <Loader2 className="animate-spin" />}
            Save ruleset
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
