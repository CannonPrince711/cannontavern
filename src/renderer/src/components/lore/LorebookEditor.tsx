import { useCallback, useEffect, useState } from 'react'
import { askConfirm } from '@/components/AskDialog'
import { AlertTriangle, ChevronRight, ExternalLink, Loader2, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import type { LoreEntry, Lorebook } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Callout, Field, Switch } from '@/components/ui/controls'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input, Textarea } from '@/components/ui/input'
import { invoke, IpcError } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { toast } from '@/stores/toasts'
import { useUi } from '@/stores/ui'
import { useLorebookFile } from './LorePanel'

function EntryEditor({ entry, onChange, onDelete, defaultOpen }: { entry: LoreEntry; onChange: (e: LoreEntry) => void; onDelete: () => void; defaultOpen?: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(!!defaultOpen)
  const [keys, setKeys] = useState(entry.keys.join(', '))
  useEffect(() => setKeys(entry.keys.join(', ')), [entry.keys])
  return (
    <li className={cn('rounded-lg border bg-card/70', !entry.enabled && 'opacity-60')}>
      <div className="flex items-center gap-2 px-3 py-2">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
          <span className="truncate text-sm font-medium">{entry.title || 'Untitled entry'}</span>
          <span className="truncate text-xs text-muted-foreground">{entry.always_on ? 'always on' : entry.keys.join(', ')}</span>
        </button>
        <Switch aria-label={`Enable ${entry.title}`} checked={entry.enabled} onCheckedChange={(v) => onChange({ ...entry, enabled: v })} />
        <Button variant="ghost" size="icon-sm" aria-label={`Delete ${entry.title}`} onClick={onDelete}>
          <Trash2 />
        </Button>
      </div>
      {open && (
        <div className="space-y-1 border-t px-4 py-3">
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <Field label="Title (## heading)">
              <Input value={entry.title} onChange={(e) => onChange({ ...entry, title: e.target.value })} />
            </Field>
            <Field label="Priority">
              <Input type="number" value={entry.priority} onChange={(e) => onChange({ ...entry, priority: Number(e.target.value) || 0 })} />
            </Field>
          </div>
          <Field label="Trigger words" description="Comma separated. Matched as whole words, ignoring case, in the last messages.">
            <Input
              value={keys}
              onChange={(e) => setKeys(e.target.value)}
              onBlur={() => onChange({ ...entry, keys: keys.split(',').map((k) => k.trim()).filter(Boolean) })}
              placeholder="dragon, wyrm"
            />
          </Field>
          <Field inline label="Always on" description="Include in every prompt, regardless of trigger words.">
            <Switch aria-label="Always on" checked={entry.always_on} onCheckedChange={(v) => onChange({ ...entry, always_on: v })} />
          </Field>
          <Field label="Content">
            <Textarea rows={5} value={entry.content} onChange={(e) => onChange({ ...entry, content: e.target.value })} className="font-serif text-[15px]" />
          </Field>
        </div>
      )}
    </li>
  )
}

export function LorebookEditor(): React.JSX.Element | null {
  const path = useUi((s) => s.editingLorebook)
  const close = (): void => useUi.setState({ editingLorebook: null })
  const [book, setBook] = useState<Lorebook | null>(null)
  const [draft, setDraft] = useState<Lorebook | null>(null)
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [newIndex, setNewIndex] = useState<number | null>(null)
  const dirty = !!book && !!draft && JSON.stringify(book) !== JSON.stringify(draft)

  const load = useCallback(async () => {
    if (!path) return
    try {
      const b = await invoke('lorebooks:get', path)
      setBook(b)
      setDraft(b)
      setConflict(false)
    } catch (err) {
      toast.error(err)
      close()
    }
  }, [path])

  useEffect(() => {
    setBook(null)
    setDraft(null)
    void load()
  }, [load])

  useLorebookFile(
    path,
    useCallback(() => {
      if (!dirty) void load()
      else setConflict(true)
    }, [dirty, load])
  )

  if (!path) return null

  const save = async (force = false): Promise<void> => {
    if (!draft) return
    setSaving(true)
    try {
      const saved = await invoke('lorebooks:save', draft, force)
      setBook(saved)
      setDraft(saved)
      setConflict(false)
      toast.success(`Saved ${saved.name}`)
    } catch (err) {
      if (err instanceof IpcError && err.code === 'VAULT_CONFLICT') setConflict(true)
      else toast.error(err, 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const setEntry = (i: number, e: LoreEntry): void => setDraft((d) => (d ? { ...d, entries: d.entries.map((x, j) => (j === i ? e : x)) } : d))
  const requestClose = async (): Promise<void> => {
    if (dirty && !(await askConfirm({ title: 'Discard unsaved changes?', confirmLabel: 'Discard', danger: true }))) return
    close()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && void requestClose()}>
      <DialogContent className="h-[min(780px,calc(100vh-80px))] w-[min(760px,calc(100vw-48px))]">
        <DialogHeader className="border-b">
          <DialogTitle>{draft?.name ?? 'Lorebook'}</DialogTitle>
          <DialogDescription>Each entry is a “## Heading” in the note, with its trigger words after keys::.</DialogDescription>
        </DialogHeader>
        {conflict && (
          <div className="px-6 pt-4">
            <Callout tone="gold" icon={<AlertTriangle />}>
              <div className="flex items-center gap-3">
                <span className="flex-1">This lorebook changed in Obsidian. Reload to see those changes, or overwrite them with yours.</span>
                <Button size="sm" variant="outline" onClick={() => void load()}>
                  <RefreshCw /> Reload
                </Button>
                <Button size="sm" onClick={() => void save(true)}>
                  Overwrite
                </Button>
              </div>
            </Callout>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {!draft ? (
            <div className="grid h-40 place-items-center">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ul className="space-y-2">
              {draft.entries.map((e, i) => (
                <EntryEditor
                  key={i}
                  entry={e}
                  defaultOpen={i === newIndex}
                  onChange={(x) => setEntry(i, x)}
                  onDelete={() => setDraft({ ...draft, entries: draft.entries.filter((_, j) => j !== i) })}
                />
              ))}
              <li>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setNewIndex(draft.entries.length)
                    setDraft({ ...draft, entries: [...draft.entries, { title: 'New entry', keys: [], content: '', always_on: false, priority: 0, enabled: true }] })
                  }}
                >
                  <Plus /> Add entry
                </Button>
              </li>
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" className="mr-auto" onClick={() => void invoke('vault:openInObsidian', path)}>
            <ExternalLink /> Open in Obsidian
          </Button>
          <Button variant="ghost" onClick={() => void requestClose()}>
            Close
          </Button>
          <Button onClick={() => void save()} disabled={!dirty || saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
