import { useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import { ExternalLink, Loader2, Maximize2, RefreshCw, Search, X } from 'lucide-react'
import { neighbourhood, type GraphKind, type GraphNode, type VaultGraph } from '@shared/graph'
import { CAMPAIGN_FILE } from '@shared/layout'
import { joinVaultPath } from '@shared/names'
import { EmptyState } from '@/components/EmptyState'
import { RuneArt } from '@/components/illustrations'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/controls'
import { Tip } from '@/components/ui/tooltip'
import { invoke, on } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { useChat } from '@/stores/chat'
import { toast } from '@/stores/toasts'
import { useUi } from '@/stores/ui'
import { useVault } from '@/stores/vault'
import { GraphCanvas, KIND_COLORS, KIND_LABELS } from './GraphCanvas'

interface GraphStore {
  graph: VaultGraph | null
  loading: boolean
  error: string | null
  open: boolean
  load: () => Promise<void>
}

let refreshTimer: ReturnType<typeof setTimeout> | undefined
let subscribed = false

export const useGraph = create<GraphStore>((set, get) => ({
  graph: null,
  loading: false,
  error: null,
  open: false,
  async load() {
    if (get().loading) return
    set({ loading: true, error: null })
    try {
      set({ graph: await invoke('vault:graph') })
    } catch (err) {
      set({ error: (err as Error).message })
    } finally {
      set({ loading: false })
    }
    // Keep it fresh while the vault changes (debounced).
    if (!subscribed) {
      subscribed = true
      on('vault:index', () => {
        clearTimeout(refreshTimer)
        refreshTimer = setTimeout(() => void get().load(), 800)
      })
    }
  }
}))

/** Opens a note from the graph the way the rest of the app would. */
function openNode(n: GraphNode): void {
  const vault = useVault.getState()
  switch (n.kind) {
    case 'session':
      if (n.campaignPath) vault.setActiveCampaign(n.campaignPath)
      useUi.setState({ creatingCampaign: false })
      vault.selectSession(n.id)
      useGraph.setState({ open: false })
      break
    case 'character':
    case 'npc':
      useUi.setState({ editingCharacter: n.id })
      break
    case 'lorebook':
      useUi.setState({ editingLorebook: n.id })
      break
    case 'campaign':
      if (n.campaignPath) vault.setActiveCampaign(n.campaignPath)
      vault.selectSession(null)
      useGraph.setState({ open: false })
      break
    default:
      void invoke('vault:openInObsidian', n.id).catch((err) => toast.error(err, 'Could not open Obsidian'))
  }
}

function Legend({ kinds, hidden, toggle }: { kinds: GraphKind[]; hidden?: Set<GraphKind>; toggle?: (k: GraphKind) => void }): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {kinds.map((k) => (
        <button
          key={k}
          type="button"
          disabled={!toggle}
          onClick={() => toggle?.(k)}
          aria-pressed={!hidden?.has(k)}
          className={cn('flex items-center gap-1.5 text-[11px] text-muted-foreground', toggle && 'hover:text-foreground', hidden?.has(k) && 'line-through opacity-50')}
        >
          <span className="size-2.5 rounded-full" style={{ background: KIND_COLORS[k] }} />
          {KIND_LABELS[k]}
        </button>
      ))}
    </div>
  )
}

/** Right-panel tab: the local graph around the open session (or the active campaign). */
export function GraphPanel(): React.JSX.Element {
  const { graph, loading, error, load } = useGraph()
  const session = useChat((s) => s.session)
  const activeCampaign = useVault((s) => s.activeCampaign)
  const [depth, setDepth] = useState(2)
  const [mentions, setMentions] = useState(true)

  useEffect(() => {
    if (!graph && !loading) void load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const focus = session?.path ?? (activeCampaign ? joinVaultPath(activeCampaign, CAMPAIGN_FILE) : undefined)
  const visible = useMemo(
    () => (graph && focus && graph.nodes.some((n) => n.id === focus) ? neighbourhood(graph, focus, depth, new Set(mentions ? ['link', 'mention'] : ['link'])) : undefined),
    [graph, focus, depth, mentions]
  )
  const kinds = useMemo(() => [...new Set(graph?.nodes.filter((n) => !visible || visible.has(n.id)).map((n) => n.kind))], [graph, visible])

  if (error) return <EmptyState illustration={<RuneArt />} title="Couldn’t build the graph" description={error} className="pt-16" />
  if (!graph) return <div className="grid place-items-center pt-20 text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-xs">
        <span className="font-medium">Local graph</span>
        <div className="ml-auto flex items-center gap-1 rounded-md border p-0.5" role="radiogroup" aria-label="Depth">
          {[1, 2, 3].map((d) => (
            <button key={d} type="button" role="radio" aria-checked={depth === d} onClick={() => setDepth(d)} className={cn('rounded px-1.5 py-0.5', depth === d ? 'bg-accent text-foreground' : 'text-muted-foreground')}>
              {d}
            </button>
          ))}
        </div>
        <Tip label="Show name mentions (dashed)">
          <span className="flex items-center">
            <Switch aria-label="Show mentions" checked={mentions} onCheckedChange={setMentions} />
          </span>
        </Tip>
        <Tip label="Refresh">
          <Button variant="ghost" size="icon-sm" aria-label="Refresh graph" onClick={() => void load()}>
            <RefreshCw className={cn(loading && 'animate-spin')} />
          </Button>
        </Tip>
        <Tip label="Open the full graph">
          <Button variant="ghost" size="icon-sm" aria-label="Open full graph" onClick={() => useGraph.setState({ open: true })}>
            <Maximize2 />
          </Button>
        </Tip>
      </div>
      <GraphCanvas graph={graph} visible={visible} showMentions={mentions} focusId={focus} onOpen={openNode} labels className="min-h-[280px] flex-1" />
      <div className="border-t px-3 py-2">
        <Legend kinds={kinds} />
      </div>
    </div>
  )
}

const ALL_KINDS: GraphKind[] = ['campaign', 'session', 'character', 'npc', 'lorebook', 'party', 'preset', 'note']

/** Full-screen graph of every note, with filters and search. */
export function GraphOverlay(): React.JSX.Element | null {
  const open = useGraph((s) => s.open)
  const { graph, loading, load } = useGraph()
  const index = useVault((s) => s.index)
  const activeCampaign = useVault((s) => s.activeCampaign)
  const session = useChat((s) => s.session)
  const [query, setQuery] = useState('')
  const [hidden, setHidden] = useState<Set<GraphKind>>(new Set(['preset']))
  const [mentions, setMentions] = useState(true)
  const [onlyCampaign, setOnlyCampaign] = useState(false)

  useEffect(() => {
    if (open && !graph && !loading) void load()
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') useGraph.setState({ open: false })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo(() => {
    if (!graph) return undefined
    let ids = graph.nodes.filter((n) => !hidden.has(n.kind)).map((n) => n.id)
    if (onlyCampaign && activeCampaign) {
      const near = neighbourhood(graph, joinVaultPath(activeCampaign, CAMPAIGN_FILE), 2)
      ids = ids.filter((id) => near.has(id))
    }
    return new Set(ids)
  }, [graph, hidden, onlyCampaign, activeCampaign])
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q && graph ? new Set(graph.nodes.filter((n) => n.name.toLowerCase().includes(q)).map((n) => n.id)) : undefined
  }, [graph, query])

  if (!open) return null
  const toggle = (k: GraphKind): void => setHidden((h) => {
    const next = new Set(h)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    return next
  })
  const stats = graph ? `${visible?.size ?? graph.nodes.length} notes · ${graph.links.filter((l) => mentions || l.kind === 'link').length} links` : ''
  return (
    <div className="fixed inset-x-0 top-10 bottom-0 z-40 flex flex-col bg-background" role="dialog" aria-modal aria-label="Graph view">
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5">
        <h2 className="font-display text-base font-semibold tracking-wide">Graph view</h2>
        <span className="text-xs text-muted-foreground">{stats}</span>
        <label className="relative ml-4">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a note" aria-label="Find a note" className="h-8 w-56 rounded-md border bg-background/60 pr-2 pl-7 text-sm" />
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch aria-label="Show mentions" checked={mentions} onCheckedChange={setMentions} /> Mentions
        </label>
        {activeCampaign && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch aria-label="Only this campaign" checked={onlyCampaign} onCheckedChange={setOnlyCampaign} /> Only {index?.campaigns.find((c) => c.path === activeCampaign)?.displayName ?? 'this campaign'}
          </label>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Tip label="Obsidian’s own graph view (needs the Advanced URI community plugin)">
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                index && void invoke('app:openExternal', `obsidian://advanced-uri?vault=${encodeURIComponent(index.vaultName)}&commandid=${encodeURIComponent('graph:open')}`).catch((err) => toast.error(err))
              }
            >
              <ExternalLink /> Obsidian graph
            </Button>
          </Tip>
          <Button variant="ghost" size="icon-sm" aria-label="Refresh graph" onClick={() => void load()}>
            <RefreshCw className={cn(loading && 'animate-spin')} />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Close graph" onClick={() => useGraph.setState({ open: false })}>
            <X />
          </Button>
        </div>
      </div>
      {graph ? (
        <GraphCanvas graph={graph} visible={visible} showMentions={mentions} focusId={session?.path} matches={matches} onOpen={openNode} className="min-h-0 flex-1" />
      ) : (
        <div className="grid flex-1 place-items-center text-muted-foreground"><Loader2 className="size-6 animate-spin" /></div>
      )}
      <div className="flex items-center gap-4 border-t px-4 py-2">
        <Legend kinds={ALL_KINDS} hidden={hidden} toggle={toggle} />
        <span className="ml-auto text-[11px] text-muted-foreground">Drag to move · scroll to zoom · double-click to fit · click a note to open it</span>
      </div>
    </div>
  )
}
