import { useEffect, useState } from 'react'
import { ChevronDown, History } from 'lucide-react'
import type { SessionRecap } from '@shared/recap'
import { invoke, on } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { Markdown } from './Markdown'

/**
 * "Previously…": the recap of the session before this one (written when that
 * session was compressed), shown at the top of the chat.
 */
export function PreviouslyCard({ sessionPath, campaignPath }: { sessionPath: string; campaignPath: string }): React.JSX.Element | null {
  const [recap, setRecap] = useState<SessionRecap | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let stale = false
    const load = (): void => {
      invoke('sessions:recaps', sessionPath, 1)
        .then((r) => !stale && setRecap(r.at(-1) ?? null))
        .catch(() => !stale && setRecap(null))
    }
    load()
    setOpen(false)
    // A sibling session's recap may finish after this one opened.
    const off = on('session:updated', (s) => {
      if (s.path !== sessionPath && s.campaignPath === campaignPath && s.frontmatter.recap) load()
    })
    return () => {
      stale = true
      off()
    }
  }, [sessionPath, campaignPath])

  if (!recap) return null
  return (
    <section className="rounded-xl border border-gold/25 bg-card/60 px-5 py-3.5" aria-label="Previously">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-2 text-left">
        <History className="size-4 shrink-0 text-gold" />
        <span className="font-display text-sm font-semibold tracking-wide">Previously</span>
        <span className="truncate text-xs text-muted-foreground">· {recap.title}</span>
        <ChevronDown className={cn('ml-auto size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      <div className={cn('chat-prose mt-2 text-sm text-muted-foreground', !open && 'line-clamp-3')}>
        <Markdown text={recap.recap} />
      </div>
    </section>
  )
}
