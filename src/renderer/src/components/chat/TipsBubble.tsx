import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronRight, Lightbulb, Loader2, RefreshCw, Sparkles, X } from 'lucide-react'
import { playModeOf } from '@shared/play'
import { tipsFor } from '@shared/tips'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'
import { invoke, on } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { useApp } from '@/stores/app'
import { useChat } from '@/stores/chat'
import { useUi } from '@/stores/ui'

interface Ideas {
  key: string
  list: string[]
}

/**
 * Tips & tricks: AI ideas for your next move (as the player, the DM, or the
 * director in AI-only play) plus rotating static tips. Clicking an idea puts
 * it in the message box.
 */
export function TipsBubble(): React.JSX.Element | null {
  const session = useChat((s) => s.session)
  const streaming = useChat((s) => !!s.streaming)
  const play = useApp((s) => s.settings?.play)
  const [open, setOpen] = useState(false)
  const [ideas, setIdeas] = useState<Ideas | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tipIndex, setTipIndex] = useState(() => Math.floor(Math.random() * 100))

  const mode = playModeOf(session?.frontmatter)
  const tips = useMemo(() => tipsFor(mode), [mode])
  const last = session?.messages.at(-1)
  const storyKey = session ? `${session.path}|${last?.id ?? ''}|${last?.swipeIndex ?? 0}` : ''
  const fresh = ideas?.key === storyKey

  const fetchIdeas = async (): Promise<void> => {
    if (!session || loading) return
    setLoading(true)
    setError(null)
    try {
      setIdeas({ key: storyKey, list: await invoke('chat:ideas', session.path) })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  // Optionally refresh the ideas after every AI reply.
  useEffect(() => {
    if (!play?.ideasAuto) return
    return on('chat:done', () => setTimeout(() => void fetchIdeas(), 300))
  }, [play?.ideasAuto, session?.path]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open && !fresh && !loading && !streaming) void fetchIdeas()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!session || play?.tipsBubble === false) return null

  const title = mode === 'user-dm' ? 'Ideas for the DM' : mode === 'ai-only' ? 'Director’s ideas' : 'What could you do?'
  const use = (text: string): void => {
    useUi.getState().prefillComposer(text)
    setOpen(false)
  }

  return (
    <div className="pointer-events-none absolute right-4 bottom-full mb-3 flex flex-col items-end">
      <AnimatePresence>
        {open && (
          <motion.section
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            className="pointer-events-auto mb-2 w-[340px] rounded-xl border bg-popover p-3 shadow-card"
            aria-label="Tips and ideas"
          >
            <header className="mb-2 flex items-center gap-2">
              <Sparkles className="size-4 text-gold" />
              <h3 className="font-display text-sm font-semibold tracking-wide">{title}</h3>
              <Tip label="New ideas">
                <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="New ideas" onClick={() => void fetchIdeas()} disabled={loading || streaming}>
                  <RefreshCw className={cn(loading && 'animate-spin')} />
                </Button>
              </Tip>
              <Button variant="ghost" size="icon-sm" aria-label="Close tips" onClick={() => setOpen(false)}>
                <X />
              </Button>
            </header>
            {loading && !fresh && (
              <p className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Thinking of ideas…
              </p>
            )}
            {error && <p className="py-2 text-xs text-crimson">{error}</p>}
            {ideas && (
              <ul className={cn('space-y-1.5', !fresh && 'opacity-60')}>
                {ideas.list.map((idea) => (
                  <li key={idea}>
                    <button
                      type="button"
                      onClick={() => use(idea)}
                      className="group flex w-full items-start gap-2 rounded-lg border bg-card px-3 py-2 text-left text-sm leading-snug hover:border-primary/50 hover:bg-accent"
                    >
                      <span className="flex-1">{idea}</span>
                      <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {ideas && !fresh && !loading && <p className="mt-1.5 text-[11px] text-muted-foreground">The story moved on; refresh for new ideas.</p>}
            <div className="mt-3 flex items-start gap-2 border-t pt-2.5 text-xs text-muted-foreground">
              <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-gold" />
              <p className="flex-1 leading-relaxed">{tips[tipIndex % tips.length]}</p>
              <button type="button" aria-label="Next tip" onClick={() => setTipIndex((i) => i + 1)} className="rounded p-0.5 hover:bg-accent hover:text-foreground">
                <ChevronRight className="size-3.5" />
              </button>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
      <Tip label={open ? 'Hide tips' : 'Tips & ideas'}>
        <button
          type="button"
          aria-label="Tips and ideas"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className={cn(
            'pointer-events-auto relative grid size-9 place-items-center rounded-full border bg-popover text-gold shadow-card transition-colors hover:bg-accent',
            open && 'border-gold/60'
          )}
        >
          <Lightbulb className="size-4" />
          {play?.ideasAuto && fresh && !open && <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-gold" aria-hidden />}
        </button>
      </Tip>
    </div>
  )
}
