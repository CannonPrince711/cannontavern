import { useEffect, useState } from 'react'
import { ChevronRight, Copy, Loader2, RefreshCw, Shield } from 'lucide-react'
import type { PromptPreview } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/controls'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { invoke } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { useChat } from '@/stores/chat'
import { toast } from '@/stores/toasts'
import { useUi } from '@/stores/ui'

function BlockRow({ label, tokens, content, total }: { label: string; tokens: number; content: string; total: number }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const pct = total ? Math.max(1, Math.round((tokens / total) * 100)) : 0
  return (
    <li className="rounded-lg border bg-card/60">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-3 px-3 py-2 text-left">
        <ChevronRight className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-90')} />
        <span className="flex-1 text-sm font-medium">{label}</span>
        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted" aria-hidden>
          <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </span>
        <span className="w-16 text-right text-xs tabular-nums text-muted-foreground">{tokens.toLocaleString()} tok</span>
      </button>
      {open && (
        <pre className="selectable max-h-80 overflow-auto border-t px-4 py-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-muted-foreground">{content}</pre>
      )}
    </li>
  )
}

const MODE_LABEL: Record<PromptPreview['stats']['mode'], string> = { 'ai-dm': 'AI is the DM', 'user-dm': 'You are the DM', 'ai-only': 'AI only' }

/** The numbers at a glance: model, context, what fits. */
function Stats({ preview }: { preview: PromptPreview }): React.JSX.Element {
  const s = preview.stats
  const free = Math.max(0, preview.budget - preview.totalTokens - s.replyTokens)
  const items: [string, string][] = [
    ['Play mode', MODE_LABEL[s.mode]],
    ['Model', s.model || preview.backendName],
    ['Context window', `${s.window.toLocaleString()} tok`],
    ['Prompt budget', `${preview.budget.toLocaleString()} tok`],
    ['Instructions & lore', `${s.systemTokens.toLocaleString()} tok`],
    ['Chat history', `${s.historyTokens.toLocaleString()} tok`],
    ['Messages included', s.messagesKept < s.messagesTotal ? `${s.messagesKept} of ${s.messagesTotal} (older ones dropped)` : `${s.messagesKept} of ${s.messagesTotal}`],
    ['Reserved for the reply', `${s.replyTokens.toLocaleString()} tok`],
    ['Room left', `${free.toLocaleString()} tok`]
  ]
  return (
    <dl className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-lg border bg-card/60 p-3 text-xs sm:grid-cols-3">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className={cn('truncate font-medium tabular-nums', k === 'Messages included' && s.messagesKept < s.messagesTotal && 'text-gold')}>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function PromptInspector(): React.JSX.Element | null {
  const open = useUi((s) => s.inspectorOpen)
  const session = useChat((s) => s.session)
  const [preview, setPreview] = useState<PromptPreview | null>(null)
  const [busy, setBusy] = useState(false)
  // Whose prompt to show; null means whoever writes next.
  const [viewKey, setViewKey] = useState<string | null>(null)

  const load = async (key: string | null = viewKey): Promise<void> => {
    if (!session) return
    setBusy(true)
    try {
      const view = key ? preview?.views.find((v) => v.key === key) : undefined
      setPreview(await invoke('chat:inspectPrompt', { sessionPath: session.path, ...(view ? { speaker: view.speaker, ...(view.as ? { as: view.as } : {}) } : {}) }))
    } catch (err) {
      toast.error(err, 'Could not build the prompt')
      useUi.setState({ inspectorOpen: false })
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (open) void load()
    else {
      setPreview(null)
      setViewKey(null)
    }
  }, [open, session?.path, session?.messages.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (key: string): void => {
    setViewKey(key)
    void load(key)
  }

  if (!open) return null
  const payload = preview ? JSON.stringify({ url: preview.url, headers: preview.headers, body: preview.body }, null, 2) : ''
  const usedPct = preview ? Math.min(100, Math.round((preview.totalTokens / preview.budget) * 100)) : 0

  return (
    <Dialog open onOpenChange={(o) => !o && useUi.setState({ inspectorOpen: false })}>
      <DialogContent className="h-[min(760px,calc(100vh-80px))] w-[min(900px,calc(100vw-48px))]">
        <DialogHeader className="border-b">
          <DialogTitle>Prompt inspector</DialogTitle>
          <DialogDescription>
            Exactly what the next request sends{preview ? ` to ${preview.backendName}` : ''}. Keys and secret headers are masked.
          </DialogDescription>
          {preview && preview.views.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-2" role="radiogroup" aria-label="Whose prompt">
              <span className="mr-1 text-xs text-muted-foreground">Prompt for</span>
              {preview.views.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  role="radio"
                  aria-checked={preview.view === v.key}
                  disabled={busy}
                  onClick={() => pick(v.key)}
                  className={cn('rounded-full border px-3 py-0.5 text-xs transition-colors hover:bg-accent', preview.view === v.key && 'border-primary bg-primary/15 ring-1 ring-primary')}
                >
                  {v.label}
                  {viewKey === null && preview.view === v.key && <span className="ml-1 text-muted-foreground">(next)</span>}
                </button>
              ))}
            </div>
          )}
          {preview && (
            <div className="flex items-center gap-3 pt-2">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted" role="meter" aria-valuenow={preview.totalTokens} aria-valuemax={preview.budget} aria-label="Context used">
                <div className={cn('h-full rounded-full', usedPct > 90 ? 'bg-crimson' : usedPct > 70 ? 'bg-gold' : 'bg-emerald')} style={{ width: `${usedPct}%` }} />
              </div>
              <span className="text-xs tabular-nums text-muted-foreground">
                ~{preview.totalTokens.toLocaleString()} / {preview.budget.toLocaleString()} tokens
              </span>
              <Button variant="ghost" size="icon-sm" aria-label="Refresh" onClick={() => void load(viewKey)} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              </Button>
            </div>
          )}
        </DialogHeader>
        {!preview ? (
          <div className="grid flex-1 place-items-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Tabs defaultValue="blocks" className="flex min-h-0 flex-1 flex-col">
            <div className="px-6 pt-3">
              <TabsList>
                <TabsTrigger value="blocks" className="px-4">Blocks</TabsTrigger>
                <TabsTrigger value="payload" className="px-4">Request payload</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="blocks" className="min-h-0 overflow-y-auto px-6 py-4">
              <Stats preview={preview} />
              <ul className="space-y-2">
                {preview.blocks.map((b, i) => (
                  <BlockRow key={`${b.id}-${i}`} label={b.label} tokens={b.tokens} content={b.content} total={preview.totalTokens} />
                ))}
              </ul>
              <p className="mt-4 text-xs text-muted-foreground">Token counts are estimates (characters ÷ 4 or ÷ 3.5, set per backend). Reorder or switch blocks off in Settings → Prompt.</p>
            </TabsContent>
            <TabsContent value="payload" className="relative min-h-0 overflow-hidden px-6 py-4">
              <div className="absolute top-6 right-9 z-10 flex gap-2">
                <Badge tone="emerald">
                  <Shield className="size-3" /> secrets masked
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void navigator.clipboard.writeText(payload).then(() => toast.success('Payload copied'))}
                >
                  <Copy /> Copy
                </Button>
              </div>
              <pre className="selectable h-full overflow-auto rounded-lg border bg-background/60 p-4 font-mono text-[12px] leading-relaxed">{payload}</pre>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}
