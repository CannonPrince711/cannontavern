import { useEffect, useMemo, useState } from 'react'
import { Cpu, ImageIcon, Loader2, PencilLine, RefreshCw, Search, Settings2 } from 'lucide-react'
import type { ImageModelList } from '@shared/types'
import { askText } from '@/components/AskDialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tip } from '@/components/ui/tooltip'
import { invoke } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { useApp } from '@/stores/app'
import { toast } from '@/stores/toasts'
import { useUi } from '@/stores/ui'

// Model lists are fetched when a menu opens and kept for a few minutes.
const TTL = 5 * 60_000
type Entry<T> = { at: number; data?: T; error?: string; loading?: boolean }
const textCache = new Map<string, Entry<string[]>>()
const imageCache = new Map<string, Entry<ImageModelList>>()

function useCached<T>(cache: Map<string, Entry<T>>, id: string | undefined, enabled: boolean, load: (id: string) => Promise<T>): Entry<T> & { refresh: () => void } {
  const [, force] = useState(0)
  const fetchNow = (key: string): void => {
    cache.set(key, { ...cache.get(key), at: Date.now(), loading: true })
    force((n) => n + 1)
    load(key)
      .then((data) => cache.set(key, { at: Date.now(), data }))
      .catch((err: Error) => cache.set(key, { at: Date.now(), error: err.message }))
      .finally(() => force((n) => n + 1))
  }
  useEffect(() => {
    if (!enabled || !id) return
    const hit = cache.get(id)
    if (!hit || (!hit.loading && Date.now() - hit.at > TTL)) fetchNow(id)
  }, [enabled, id]) // eslint-disable-line react-hooks/exhaustive-deps
  return { at: 0, ...(id ? cache.get(id) : undefined), refresh: () => id && fetchNow(id) }
}

/** Typing in a menu would trigger Radix typeahead; keep keys in the box (except navigation). */
function FilterBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }): React.JSX.Element {
  return (
    <div className="relative mx-1 mb-1">
      <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Escape') e.stopPropagation()
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-7 w-full rounded-md border bg-background pr-2 pl-7 text-xs outline-none focus:border-ring"
      />
    </div>
  )
}

function ModelList({
  entry,
  current,
  onPick,
  emptyNote
}: {
  entry: Entry<string[]> & { refresh: () => void }
  current: string
  onPick: (model: string) => void
  emptyNote?: string
}): React.JSX.Element {
  const [filter, setFilter] = useState('')
  const models = useMemo(() => {
    const list = entry.data ?? []
    const all = current && !list.includes(current) ? [current, ...list] : list
    const q = filter.trim().toLowerCase()
    return q ? all.filter((m) => m.toLowerCase().includes(q)) : all
  }, [entry.data, current, filter])
  return (
    <>
      {(entry.data?.length ?? 0) > 8 && <FilterBox value={filter} onChange={setFilter} placeholder="Filter models" />}
      {entry.loading && !entry.data && (
        <p className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Loading models…
        </p>
      )}
      {entry.error && <p className="max-w-72 px-2 py-1.5 text-xs text-crimson">Couldn’t list models: {entry.error}</p>}
      {!entry.loading && !entry.error && models.length === 0 && (
        <p className="max-w-72 px-2 py-1.5 text-xs text-muted-foreground">{filter ? 'No matches.' : (emptyNote ?? 'No models reported.')}</p>
      )}
      <div className="max-h-72 overflow-y-auto">
        <DropdownMenuRadioGroup value={current} onValueChange={onPick}>
          {models.map((m) => (
            <DropdownMenuRadioItem key={m} value={m} className="font-mono text-xs">
              <span className="truncate">{m}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </div>
    </>
  )
}

function TextBackendModels({ id, current, onPick, active }: { id: string; current: string; onPick: (m: string) => void; active: boolean }): React.JSX.Element {
  const entry = useCached(textCache, id, active, (key) => invoke('textBackends:models', key))
  return <ModelList entry={entry} current={current} onPick={onPick} />
}

/**
 * Text model switcher: the active backend's models inline, other backends in
 * submenus. Picking a model makes that backend and model the one the DM uses.
 */
export function TextModelSwitcher({ variant = 'field', className }: { variant?: 'field' | 'pill'; className?: string }): React.JSX.Element {
  const settings = useApp((s) => s.settings)
  const [open, setOpen] = useState(false)
  const backends = settings?.textBackends ?? []
  const activeId = settings?.roles.chat ?? settings?.defaultTextBackendId ?? backends[0]?.id
  const active = backends.find((b) => b.id === activeId)
  const entry = useCached(textCache, active?.id, open, (key) => invoke('textBackends:models', key))

  const use = async (id: string, model?: string): Promise<void> => {
    try {
      useApp.setState({ settings: await invoke('textBackends:use', id, model) })
    } catch (err) {
      toast.error(err, 'Could not switch the model')
    }
  }
  const custom = async (id: string, current: string): Promise<void> => {
    const model = await askText({ title: 'Model ID', description: 'Exactly as the server names it, e.g. claude-sonnet-5-5 or llama3.1:8b.', initial: current, confirmLabel: 'Use model' })
    if (model?.trim()) await use(id, model.trim())
  }

  const label = active ? active.model || active.name : 'No text model'
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tip label={active ? `Text model: ${active.name}${active.model ? ` · ${active.model}` : ''}` : 'No text backend configured'}>
        <DropdownMenuTrigger asChild>
          {variant === 'pill' ? (
            <button
              type="button"
              aria-label="Text model"
              className={cn('flex h-6 max-w-56 items-center gap-1.5 rounded-full border bg-card/60 px-2.5 text-[11px] font-medium text-muted-foreground hover:text-foreground', className)}
            >
              <span className={cn('size-1.5 shrink-0 rounded-full', active ? 'bg-emerald' : 'bg-muted-foreground/50')} aria-hidden />
              <span className="truncate">{label}</span>
            </button>
          ) : (
            <button
              type="button"
              aria-label="Text model"
              className={cn('flex h-8 min-w-0 items-center gap-1.5 rounded-md border bg-background/60 px-2.5 text-left text-xs hover:bg-accent', className)}
            >
              <Cpu className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-mono">{label}</span>
            </button>
          )}
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" className="w-80">
        {active ? (
          <>
            <DropdownMenuLabel className="flex items-center gap-2">
              <span className="truncate">{active.name}</span>
              <button type="button" aria-label="Refresh models" onClick={(e) => (e.preventDefault(), entry.refresh())} className="ml-auto rounded p-0.5 hover:bg-accent hover:text-foreground">
                <RefreshCw className={cn('size-3.5', entry.loading && 'animate-spin')} />
              </button>
            </DropdownMenuLabel>
            <ModelList entry={entry} current={active.model} onPick={(m) => void use(active.id, m)} />
            <DropdownMenuItem onSelect={() => void custom(active.id, active.model)}>
              <PencilLine /> Enter a model ID…
            </DropdownMenuItem>
          </>
        ) : (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">No text backend yet.</p>
        )}
        {backends.length > 1 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Other backends</DropdownMenuLabel>
            {backends
              .filter((b) => b.id !== active?.id)
              .map((b) => (
                <DropdownMenuSub key={b.id}>
                  <DropdownMenuSubTrigger>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{b.name}</span>
                      {b.model && <span className="block truncate font-mono text-[11px] text-muted-foreground">{b.model}</span>}
                    </span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-72">
                    <DropdownMenuItem onSelect={() => void use(b.id)}>Use {b.model || b.name}</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <TextBackendModels id={b.id} current={b.model} onPick={(m) => void use(b.id, m)} active />
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ))}
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => useUi.getState().openSettings('text')}>
          <Settings2 /> Manage text backends…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Image model switcher: for ComfyUI the workflow and its checkpoint; for
 * Automatic1111 the checkpoint; for OpenAI the image model.
 */
export function ImageModelSwitcher({ className, compact = false }: { className?: string; compact?: boolean }): React.JSX.Element | null {
  const settings = useApp((s) => s.settings)
  const [open, setOpen] = useState(false)
  const backends = settings?.imageBackends ?? []
  const active = backends.find((b) => b.id === settings?.defaultImageBackendId) ?? backends[0]
  const entry = useCached(imageCache, active?.id, open, (key) => invoke('imageBackends:models', key))
  if (!active) return null

  const info = entry.data
  const workflow = active.comfy.workflows.find((w) => w.id === (info?.currentWorkflowId ?? active.comfy.defaultWorkflowId)) ?? active.comfy.workflows[0]
  const current =
    info?.current ?? (active.type === 'comfyui' ? workflow?.checkpoint ?? '' : active.type === 'a1111' ? active.a1111.model : active.type === 'openai' ? active.openai.model : '')

  const use = async (id: string, choice?: { model?: string; workflowId?: string }): Promise<void> => {
    try {
      useApp.setState({ settings: await invoke('imageBackends:use', id, choice) })
      // The model list depends on the workflow's loader node.
      if (choice?.workflowId) {
        imageCache.delete(id)
        entry.refresh()
      } else if (choice?.model !== undefined && imageCache.get(id)?.data) {
        const hit = imageCache.get(id)!
        imageCache.set(id, { ...hit, data: { ...hit.data!, current: choice.model } })
      }
    } catch (err) {
      toast.error(err, 'Could not switch the image model')
    }
  }
  const modelEntry: Entry<string[]> & { refresh: () => void } = { at: entry.at, loading: entry.loading, error: entry.error, data: info?.models, refresh: entry.refresh }
  const summary = [active.name, active.type === 'comfyui' ? workflow?.name : null, current || null].filter(Boolean).join(' · ')

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tip label={`Image model: ${summary}`}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Image model"
            className={cn('flex h-8 min-w-0 items-center gap-1.5 rounded-md border bg-background/60 px-2.5 text-left text-xs hover:bg-accent', className)}
          >
            <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">
              {compact ? (
                current || active.name
              ) : (
                <>
                  <span className="text-muted-foreground">{active.name}</span>
                  {(current || workflow) && <span className="font-mono"> · {current || workflow?.name}</span>}
                </>
              )}
            </span>
          </button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center gap-2">
          <span className="truncate">{active.name}</span>
          <button type="button" aria-label="Refresh models" onClick={(e) => (e.preventDefault(), entry.refresh())} className="ml-auto rounded p-0.5 hover:bg-accent hover:text-foreground">
            <RefreshCw className={cn('size-3.5', entry.loading && 'animate-spin')} />
          </button>
        </DropdownMenuLabel>
        {active.type === 'comfyui' && active.comfy.workflows.length > 0 && (
          <>
            <DropdownMenuLabel className="pt-0 text-[10px] tracking-[0.12em] uppercase">Workflow</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={workflow?.id ?? ''} onValueChange={(workflowId) => void use(active.id, { workflowId })}>
              {active.comfy.workflows.map((w) => (
                <DropdownMenuRadioItem key={w.id} value={w.id}>
                  <span className="truncate">{w.name}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">{w.purpose}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="pt-0 text-[10px] tracking-[0.12em] uppercase">Checkpoint</DropdownMenuLabel>
          </>
        )}
        <ModelList entry={modelEntry} current={current} onPick={(model) => void use(active.id, { model })} emptyNote={info?.note} />
        {active.type !== 'custom' && (active.type !== 'comfyui' || workflow?.mapping.checkpoint) && (
          <DropdownMenuItem
            onSelect={async () => {
              const model = await askText({ title: 'Model name', description: 'Exactly as the server names it.', initial: current, confirmLabel: 'Use model' })
              if (model?.trim()) await use(active.id, { model: model.trim() })
            }}
          >
            <PencilLine /> Enter a model name…
          </DropdownMenuItem>
        )}
        {backends.length > 1 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Other backends</DropdownMenuLabel>
            {backends
              .filter((b) => b.id !== active.id)
              .map((b) => (
                <DropdownMenuItem key={b.id} onSelect={() => void use(b.id)}>
                  <span className="truncate">{b.name}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">{b.type}</span>
                </DropdownMenuItem>
              ))}
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => useUi.getState().openSettings('images')}>
          <Settings2 /> Manage image backends…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
