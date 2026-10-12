import { useEffect, useState } from 'react'
import { askConfirm } from '@/components/AskDialog'
import { AlertTriangle, Camera, Download, ExternalLink, ImagePlus, Loader2, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react'
import type { CharacterCard, CharacterNote } from '@shared/types'
import { CharacterAvatar } from '@/components/CharacterAvatar'
import { Button } from '@/components/ui/button'
import { Callout, Field } from '@/components/ui/controls'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input, Textarea } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tip } from '@/components/ui/tooltip'
import { invoke, IpcError, on } from '@/lib/ipc'
import { VoiceOptions } from '@/lib/speech'
import { TagsDialog } from '@/components/images/TagsDialog'
import { useApp } from '@/stores/app'
import { toast } from '@/stores/toasts'
import { useUi } from '@/stores/ui'
import { useVault } from '@/stores/vault'
import { FOLDERS } from '@shared/layout'

function avatarPath(rootFolder: string, avatar?: string): string | undefined {
  if (!avatar) return undefined
  return avatar.includes('/') ? avatar : `${rootFolder}/Characters/avatars/${avatar}`
}

function TextField({
  label,
  value,
  onChange,
  rows = 4,
  description,
  placeholder
}: {
  label: string
  value: string
  onChange: (v: string) => void
  rows?: number
  description?: string
  placeholder?: string
}): React.JSX.Element {
  const id = `ce-${label.replace(/\W+/g, '-').toLowerCase()}`
  return (
    <Field label={label} htmlFor={id} description={description}>
      <Textarea id={id} rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="font-serif text-[15px] leading-relaxed" />
    </Field>
  )
}

export function CharacterEditor(): React.JSX.Element | null {
  const path = useUi((s) => s.editingCharacter)
  const close = (): void => useUi.setState({ editingCharacter: null })
  const rootFolder = useVault((s) => s.index?.rootFolder ?? 'DND Tavern')
  const [note, setNote] = useState<CharacterNote | null>(null)
  const [draft, setDraft] = useState<CharacterNote | null>(null)
  const [tags, setTags] = useState('')
  const [aliases, setAliases] = useState('')
  const [saving, setSaving] = useState(false)
  const [painting, setPainting] = useState(false)
  const hasImageBackend = useApp((s) => (s.settings?.imageBackends.length ?? 0) > 0)
  const [conflict, setConflict] = useState(false)
  const [externalChange, setExternalChange] = useState(false)

  const dirty =
    !!note && !!draft && (JSON.stringify(note) !== JSON.stringify(draft) || tags !== note.card.tags.join(', ') || aliases !== (note.card.aliases ?? []).join(', '))
  // NPC notes become lore for the AI; their aliases are extra trigger words.
  const isNpc = !!path && path.toLowerCase().startsWith(`${rootFolder}/${FOLDERS.npcs}/`.toLowerCase())

  const load = async (p: string): Promise<void> => {
    try {
      const n = await invoke('characters:get', p)
      setNote(n)
      setDraft(n)
      setTags(n.card.tags.join(', '))
      setAliases((n.card.aliases ?? []).join(', '))
      setExternalChange(false)
      setConflict(false)
    } catch (err) {
      toast.error(err, 'Could not open the character')
      close()
    }
  }

  useEffect(() => {
    setNote(null)
    setDraft(null)
    if (path) void load(path)
  }, [path]) // eslint-disable-line react-hooks/exhaustive-deps

  // Edits made in Obsidian while the editor is open.
  useEffect(() => {
    if (!path) return
    return on('vault:changed', (e) => {
      if (e.path !== path || e.event === 'unlink') return
      if (!dirty) return void load(path)
      // A new portrait (e.g. painted in the background) is the only change: keep editing on top of it.
      void invoke('characters:get', path)
        .then((fresh) => {
          const same = (a: CharacterNote): string => JSON.stringify({ ...a.card, avatar: undefined, body: a.body })
          if (!note || same(fresh) !== same(note)) return setExternalChange(true)
          setNote(fresh)
          setDraft((d) => (d ? { ...d, hash: fresh.hash, mtimeMs: fresh.mtimeMs, card: { ...d.card, avatar: fresh.card.avatar } } : d))
        })
        .catch(() => setExternalChange(true))
    })
  }, [path, dirty, note]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!path) return null

  const card = <K extends keyof CharacterCard>(k: K, v: CharacterCard[K]): void =>
    setDraft((d) => (d ? { ...d, card: { ...d.card, [k]: v } } : d))

  const save = async (force = false): Promise<void> => {
    if (!draft) return
    setSaving(true)
    try {
      const list = (s: string): string[] => s.split(',').map((t) => t.trim()).filter(Boolean)
      const next = { ...draft, card: { ...draft.card, tags: list(tags), aliases: list(aliases) } }
      const saved = await invoke('characters:save', next, force)
      setNote(saved)
      setDraft(saved)
      setTags(saved.card.tags.join(', '))
      setAliases((saved.card.aliases ?? []).join(', '))
      setConflict(false)
      setExternalChange(false)
      toast.success(`Saved ${saved.card.name}`)
    } catch (err) {
      if (err instanceof IpcError && err.code === 'VAULT_CONFLICT') setConflict(true)
      else toast.error(err, 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const changeAvatar = async (): Promise<void> => {
    try {
      const updated = await invoke('characters:setAvatar', path)
      if (updated) {
        setNote(updated)
        setDraft((d) => (d ? { ...d, card: { ...d.card, avatar: updated.card.avatar }, hash: updated.hash, mtimeMs: updated.mtimeMs } : updated))
      }
    } catch (err) {
      toast.error(err, 'Could not set the portrait')
    }
  }

  const exportCard = async (format: 'json' | 'png'): Promise<void> => {
    try {
      const r = await invoke('characters:export', path, format)
      if (r) toast.success('Card exported', r.path)
    } catch (err) {
      toast.error(err, 'Export failed')
    }
  }

  const remove = async (): Promise<void> => {
    if (!note || !(await askConfirm({ title: `Delete ${note.card.name}?`, description: 'The note and its sheet move to the Recycle Bin.', confirmLabel: 'Delete', danger: true }))) return
    try {
      await invoke('characters:delete', path)
      useVault.getState().selectCharacter(null)
      close()
    } catch (err) {
      toast.error(err)
    }
  }

  const requestClose = async (): Promise<void> => {
    if (dirty && !(await askConfirm({ title: 'Discard unsaved changes?', confirmLabel: 'Discard', danger: true }))) return
    close()
  }

  const greetings = draft?.card.alternate_greetings ?? []

  return (
    <Dialog open onOpenChange={(open) => !open && void requestClose()}>
      <DialogContent className="w-[min(920px,calc(100vw-48px))]" hideClose onEscapeKeyDown={(e) => dirty && (e.preventDefault(), void requestClose())}>
        {!draft ? (
          <div className="grid h-64 place-items-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="flex items-start gap-4 border-b px-6 py-5">
              <button type="button" onClick={() => void changeAvatar()} className="group relative shrink-0 rounded-full" aria-label="Change portrait">
                <CharacterAvatar name={draft.card.name} avatar={avatarPath(rootFolder, draft.card.avatar)} version={draft.mtimeMs} size={72} />
                <span className="absolute inset-0 grid place-items-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                  <Camera className="size-5 text-white" />
                </span>
              </button>
              <div className="min-w-0 flex-1 space-y-2">
                <DialogTitle className="sr-only">Edit {draft.card.name}</DialogTitle>
                <DialogDescription className="sr-only">Character card fields, saved to the character’s note in your vault.</DialogDescription>
                <Input value={draft.card.name} onChange={(e) => card('name', e.target.value)} aria-label="Name" className="h-10 font-display text-lg font-semibold tracking-wide" />
                <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags, comma separated" aria-label="Tags" className="h-8 text-xs" />
                {isNpc && (
                  <Tip label="The AI is reminded who this is when their name or one of these comes up in the story.">
                    <label className="flex items-center gap-2">
                      <span className="shrink-0 text-xs text-muted-foreground">Also known as</span>
                      <Input value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="Nicknames or titles, comma separated" aria-label="Also known as" className="h-8 text-xs" />
                    </label>
                  </Tip>
                )}
              </div>
              <div className="flex items-center gap-1">
                {hasImageBackend && (
                  <Tip label="New portrait: paint a fresh one, with your own tags">
                    <Button variant="ghost" size="icon" aria-label="New portrait" onClick={() => setPainting(true)}>
                      <ImagePlus />
                    </Button>
                  </Tip>
                )}
                <DropdownMenu>
                  <Tip label="Export card">
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label="Export card">
                        <Download />
                      </Button>
                    </DropdownMenuTrigger>
                  </Tip>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => void exportCard('png')}>SillyTavern PNG card</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void exportCard('json')}>SillyTavern JSON (V2)</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                {painting && (
                  <TagsDialog
                    title={`New portrait of ${draft.card.name}`}
                    description="The portrait is written from their description. Add tags to steer it (pose, expression, outfit, background); remove any you don’t want. It replaces their current picture."
                    initial=""
                    submitLabel="Paint portrait"
                    onSubmit={(extra) => {
                      toast.info(`Painting ${draft.card.name}…`, 'The new portrait appears here when it’s done.')
                      void invoke('images:generate', { kind: 'portrait', characterPath: path, ...(extra.trim() ? { prompt: extra } : {}) }).catch((err) => toast.error(err, 'Couldn’t paint the portrait'))
                    }}
                    onClose={() => setPainting(false)}
                  />
                )}
                <Tip label="Open in Obsidian">
                  <Button variant="ghost" size="icon" aria-label="Open in Obsidian" onClick={() => void invoke('vault:openInObsidian', path)}>
                    <ExternalLink />
                  </Button>
                </Tip>
                <Tip label="Delete">
                  <Button variant="ghost" size="icon" aria-label="Delete character" className="text-crimson hover:text-crimson" onClick={() => void remove()}>
                    <Trash2 />
                  </Button>
                </Tip>
                <Button variant="ghost" size="icon" aria-label="Close" onClick={() => void requestClose()}>
                  <X />
                </Button>
              </div>
            </div>

            {(conflict || externalChange) && (
              <div className="px-6 pt-4">
                <Callout tone="gold" icon={<AlertTriangle />}>
                  <div className="flex items-center gap-3">
                    <span className="flex-1">
                      {conflict ? 'This note was changed in Obsidian after you opened it.' : 'This note just changed in Obsidian.'} Reload to see those changes (yours are lost), or overwrite them with yours.
                    </span>
                    <Button size="sm" variant="outline" onClick={() => void load(path)}>
                      <RefreshCw /> Reload
                    </Button>
                    <Button size="sm" onClick={() => void save(true)}>
                      Overwrite
                    </Button>
                  </div>
                </Callout>
              </div>
            )}

            <Tabs defaultValue="card" className="flex min-h-0 flex-1 flex-col">
              <div className="px-6 pt-4">
                <TabsList>
                  <TabsTrigger value="card" className="px-4">Card</TabsTrigger>
                  <TabsTrigger value="greetings" className="px-4">Greetings ({1 + greetings.length})</TabsTrigger>
                  <TabsTrigger value="advanced" className="px-4">Advanced</TabsTrigger>
                  <TabsTrigger value="notes" className="px-4">Notes</TabsTrigger>
                </TabsList>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
                <TabsContent value="card" className="space-y-1">
                  <TextField label="Description" rows={6} value={draft.card.description} onChange={(v) => card('description', v)} description="Who the character is: appearance, background, abilities. Use {{char}} and {{user}}." />
                  <TextField label="Personality" rows={2} value={draft.card.personality} onChange={(v) => card('personality', v)} />
                  <Field label="Voice" htmlFor="char-voice" description="Read-aloud voice on your speech server (Settings → Speech). Empty: the narrator’s voice.">
                    <Input id="char-voice" list="char-voice-options" value={draft.card.voice ?? ''} onChange={(e) => card('voice', e.target.value.trim() || undefined)} placeholder="e.g. rias" className="w-60" />
                    <VoiceOptions id="char-voice-options" />
                  </Field>
                  <TextField label="Scenario" rows={3} value={draft.card.scenario} onChange={(v) => card('scenario', v)} />
                </TabsContent>
                <TabsContent value="greetings" className="space-y-1">
                  <TextField label="First message" rows={6} value={draft.card.first_mes} onChange={(v) => card('first_mes', v)} description="Opens every new session with this character, written by the DM." />
                  {greetings.map((g, i) => (
                    <div key={i} className="relative">
                      <TextField label={`Alternate greeting ${i + 1}`} rows={4} value={g} onChange={(v) => card('alternate_greetings', greetings.map((x, j) => (j === i ? v : x)))} />
                      <Button variant="ghost" size="icon-sm" className="absolute top-1 right-0" aria-label={`Remove greeting ${i + 1}`} onClick={() => card('alternate_greetings', greetings.filter((_, j) => j !== i))}>
                        <Trash2 />
                      </Button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => card('alternate_greetings', [...greetings, ''])}>
                    <Plus /> Add alternate greeting
                  </Button>
                </TabsContent>
                <TabsContent value="advanced" className="space-y-1">
                  <TextField label="Example dialogue" rows={6} value={draft.card.mes_example} onChange={(v) => card('mes_example', v)} placeholder={'<START>\n{{user}}: …\n{{char}}: …'} />
                  <TextField label="Character system prompt" rows={3} value={draft.card.system_prompt} onChange={(v) => card('system_prompt', v)} description="Extra instructions added to the DM prompt whenever this character plays." />
                  <TextField label="Creator notes" rows={2} value={draft.card.creator_notes ?? ''} onChange={(v) => card('creator_notes', v)} />
                </TabsContent>
                <TabsContent value="notes">
                  <TextField label="Notes (Markdown body of the note)" rows={14} value={draft.body} onChange={(v) => setDraft({ ...draft, body: v })} description="Free-form notes. Link other notes with [[wikilinks]]; Obsidian shows them as usual." />
                </TabsContent>
              </div>
            </Tabs>

            <DialogFooter>
              <span className="mr-auto self-center truncate text-[11px] text-muted-foreground">{path}</span>
              <Button variant="ghost" onClick={() => void requestClose()}>
                Close
              </Button>
              <Button onClick={() => void save()} disabled={!dirty || saving || !draft.card.name.trim()}>
                {saving ? <Loader2 className="animate-spin" /> : <Save />} Save
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Small dialog asking for a new character's name. */
export function NewCharacterDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }): React.JSX.Element {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const create = async (): Promise<void> => {
    setBusy(true)
    try {
      const note = await invoke('characters:create', name.trim())
      onOpenChange(false)
      setName('')
      useVault.getState().selectCharacter(note.path)
      useUi.setState({ editingCharacter: note.path })
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[420px]">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) void create()
          }}
        >
          <DialogHeader>
            <DialogTitle>New character</DialogTitle>
            <DialogDescription>Creates a note in Characters/. You can add a portrait, card and D&D sheet next.</DialogDescription>
          </DialogHeader>
          <div className="px-6 pb-5">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Aria Thornwood" autoFocus aria-label="Character name" />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || busy}>
              {busy && <Loader2 className="animate-spin" />} Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
