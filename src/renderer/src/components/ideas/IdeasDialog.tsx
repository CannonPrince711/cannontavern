import { useState } from 'react'
import { BookmarkPlus, Dices, Lightbulb, Loader2, Wand2 } from 'lucide-react'
import { IDEA_COUNT_MAX, IDEA_KINDS, IDEA_VIBES, type Idea, type IdeaKind } from '@shared/ideas'
import { NewCharacterDialog } from '@/components/characters/CharacterEditor'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input, Label } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/controls'
import { invoke } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { useApp } from '@/stores/app'
import { toast } from '@/stores/toasts'
import { useUi } from '@/stores/ui'

const USE_LABEL: Record<IdeaKind, string> = {
  campaign: 'Build this campaign',
  oneshot: 'Build this one-shot',
  character: 'Make this character',
  universe: 'Make this world'
}

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

function IdeaCard({ idea, onUse }: { idea: Idea; onUse: (idea: Idea) => void }): React.JSX.Element {
  const [saved, setSaved] = useState(false)
  const save = async (): Promise<void> => {
    try {
      await invoke('ideas:save', idea)
      setSaved(true)
      toast.success(`Saved “${idea.title}”`, 'It’s in Ideas.md at the top of your vault.')
    } catch (err) {
      toast.error(err, 'Couldn’t save the idea')
    }
  }
  return (
    <article className="space-y-2 rounded-lg border bg-card/60 p-4">
      <h3 className="font-display text-lg leading-tight tracking-wide">{idea.title}</h3>
      <p className="font-serif text-[15px] leading-relaxed">{idea.pitch}</p>
      {idea.details.length > 0 && (
        <ul className="space-y-1 text-sm text-muted-foreground">
          {idea.details.map((d, i) => (
            <li key={i}>• {d}</li>
          ))}
          {(idea.race || idea.cls) && <li>• {[idea.race, idea.cls].filter(Boolean).join(' ')}</li>}
        </ul>
      )}
      {idea.tones.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {idea.tones.map((t) => (
            <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              {t}
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button size="sm" onClick={() => onUse(idea)}>
          <Wand2 /> {USE_LABEL[idea.kind]}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void save()} disabled={saved}>
          <BookmarkPlus /> {saved ? 'Saved' : 'Save idea'}
        </Button>
      </div>
    </article>
  )
}

/** Random pitches for campaigns, one-shots, characters and worlds; "use" hands one to its creator already filled in. */
export function IdeasDialog(): React.JSX.Element | null {
  const open = useUi((s) => s.generatingIdeas)
  const hasBackend = useApp((s) => (s.settings?.textBackends.length ?? 0) > 0)
  const [kind, setKind] = useState<IdeaKind>('campaign')
  const [vibes, setVibes] = useState<string[]>([])
  const [theme, setTheme] = useState('')
  const [count, setCount] = useState(4)
  const [ideas, setIdeas] = useState<Idea[]>([])
  const [busy, setBusy] = useState(false)
  const [character, setCharacter] = useState<{ concept: string; race?: string; cls?: string } | null>(null)

  const close = (): void => useUi.setState({ generatingIdeas: false })

  const roll = async (): Promise<void> => {
    setBusy(true)
    try {
      const list = await invoke('ideas:generate', { kind, count, vibes, theme: theme.trim() })
      // Ignore ideas that arrive after the dialog closed.
      if (useUi.getState().generatingIdeas) setIdeas(list)
    } catch (err) {
      toast.error(err, 'Couldn’t come up with ideas')
    } finally {
      setBusy(false)
    }
  }

  const use = (idea: Idea): void => {
    if (idea.kind === 'character') {
      setCharacter({
        concept: `${idea.title}. ${idea.pitch}\n\n${idea.premise}\n\n${idea.details.join('\n')}`.slice(0, 2000),
        ...(idea.race ? { race: idea.race } : {}),
        ...(idea.cls ? { cls: idea.cls } : {})
      })
      return
    }
    useUi.setState({
      ideaHandoff: idea,
      generatingIdeas: false,
      ...(idea.kind === 'universe' ? { managingUniverses: true } : { buildingCampaign: true })
    })
  }

  if (!open) return null
  return (
    <>
      <Dialog open={!character} onOpenChange={(o) => !o && !busy && close()}>
        <DialogContent className="w-[min(860px,calc(100vw-48px))]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lightbulb className="size-5 text-gold" /> Idea generator
            </DialogTitle>
            <DialogDescription>Rolls random ingredients and has the AI turn them into pitches. Pick one to build it, or save it for later.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-6">
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="What to pitch">
              {IDEA_KINDS.map((k) => (
                <Chip
                  key={k.id}
                  active={kind === k.id}
                  onClick={() => {
                    setKind(k.id)
                    setIdeas([])
                  }}
                >
                  {k.label}
                </Chip>
              ))}
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Vibe (optional)</p>
              <div className="flex flex-wrap gap-1.5">
                {IDEA_VIBES.map((v) => (
                  <Chip key={v} active={vibes.includes(v)} onClick={() => setVibes((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v].slice(-6)))}>
                    {v}
                  </Chip>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[240px] flex-1 space-y-1.5">
                <Label htmlFor="ideas-theme">Anything it should include? (optional)</Label>
                <Input
                  id="ideas-theme"
                  value={theme}
                  maxLength={500}
                  placeholder="pirates, a heist, set in my Drowned Crown world…"
                  onChange={(e) => setTheme(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !busy && hasBackend && void roll()}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ideas-count">How many</Label>
                <NativeSelect id="ideas-count" value={String(count)} onChange={(e) => setCount(Number(e.target.value))} className="w-20">
                  {Array.from({ length: IDEA_COUNT_MAX }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <Button onClick={() => void roll()} disabled={busy || !hasBackend}>
                {busy ? <Loader2 className="animate-spin" /> : <Dices />} {ideas.length ? 'Roll again' : 'Roll ideas'}
              </Button>
            </div>
            {!hasBackend && <p className="text-sm text-muted-foreground">Add a text backend in Settings first: it writes the ideas.</p>}
            {busy && !ideas.length && (
              <p className="py-10 text-center text-sm text-muted-foreground" role="status">
                Rolling the dice and writing pitches…
              </p>
            )}
            <div className={cn('grid gap-3 md:grid-cols-2', busy && 'opacity-60')}>
              {ideas.map((idea, i) => (
                <IdeaCard key={`${idea.title}-${i}`} idea={idea} onUse={use} />
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <NewCharacterDialog
        open={!!character}
        initial={character ?? undefined}
        onOpenChange={(o) => {
          if (o) return
          setCharacter(null)
        }}
      />
    </>
  )
}
