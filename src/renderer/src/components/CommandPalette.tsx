import { useEffect, useMemo, useRef, useState } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { BookOpen, CornerDownLeft, Dices, FileText, FolderOpen, Hash, MessageSquare, Plus, ScrollText, Search, Settings, SquareTerminal, User } from 'lucide-react'
import { listCommands, runCommand } from '@/lib/commands'
import { invoke } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { useChat } from '@/stores/chat'
import { useDiceFx } from '@/stores/dice'
import { useLayout } from '@/stores/layout'
import { toast } from '@/stores/toasts'
import { useUi, type SettingsSection } from '@/stores/ui'
import { useVault } from '@/stores/vault'

interface Item {
  id: string
  group: 'Actions' | 'Commands' | 'Sessions' | 'Characters' | 'Lorebooks' | 'Notes'
  label: string
  hint?: string
  icon: React.ComponentType<{ className?: string }>
  /** Extra words that match the query but aren't shown. */
  keywords?: string
  run: () => void
}

const GROUP_ORDER: Item['group'][] = ['Actions', 'Sessions', 'Characters', 'Commands', 'Lorebooks', 'Notes']

/** Lower is better; null hides the item. Prefix > word start > substring > subsequence. */
function score(item: Item, q: string): number | null {
  if (!q) return 0
  const label = item.label.toLowerCase()
  const hay = `${label} ${item.hint ?? ''} ${item.keywords ?? ''}`.toLowerCase()
  if (label.startsWith(q)) return 0
  if (label.split(/[\s/:–-]+/).some((w) => w.startsWith(q))) return 1
  if (hay.includes(q)) return 2
  let i = 0
  for (const ch of label) if (ch === q[i]) i++
  return i === q.length ? 3 : null
}

function close(): void {
  useUi.setState({ paletteOpen: false })
}

function settingsItem(section: SettingsSection, label: string, keywords?: string): Item {
  return { id: `settings:${section}`, group: 'Actions', label: `Settings: ${label}`, icon: Settings, keywords, run: () => useUi.getState().openSettings(section) }
}

function useItems(query: string): Item[] {
  const index = useVault((s) => s.index)
  const session = useChat((s) => s.session)
  const [notes, setNotes] = useState<{ path: string; name: string }[]>([])

  // Notes come from the whole vault, so search them in the main process.
  useEffect(() => {
    if (!index || query.trim().length < 2) {
      setNotes([])
      return
    }
    let stale = false
    const t = setTimeout(() => {
      invoke('vault:searchNotes', query)
        .then((r) => !stale && setNotes(r))
        .catch(() => !stale && setNotes([]))
    }, 120)
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [query, index])

  return useMemo(() => {
    const items: Item[] = [
      {
        id: 'new-session',
        group: 'Actions',
        label: 'New session',
        icon: Plus,
        keywords: 'start chat',
        run: () => {
          useVault.getState().selectSession(null)
          useUi.setState({ creatingCampaign: false })
        }
      },
      { id: 'new-campaign', group: 'Actions', label: 'New campaign', icon: FolderOpen, run: () => useUi.setState({ creatingCampaign: true }) },
      { id: 'dice', group: 'Actions', label: 'Dice tray', icon: Dices, keywords: 'roll', run: () => useDiceFx.getState().setTrayOpen(!useDiceFx.getState().trayOpen) },
      { id: 'inspector', group: 'Actions', label: 'Prompt inspector', icon: SquareTerminal, keywords: 'tokens context debug', run: () => useUi.setState({ inspectorOpen: true }) },
      { id: 'left', group: 'Actions', label: 'Toggle left sidebar', icon: MessageSquare, run: () => useLayout.getState().toggleLeft() },
      { id: 'right', group: 'Actions', label: 'Toggle right panel', icon: ScrollText, keywords: 'sheet combat lore images', run: () => useLayout.getState().toggleRight() },
      settingsItem('general', 'General', 'vault behaviour tray startup'),
      settingsItem('appearance', 'Appearance', 'theme font dark light'),
      settingsItem('text', 'Text backends', 'model llm openai anthropic ollama'),
      settingsItem('images', 'Image backends', 'comfyui a1111 workflow'),
      settingsItem('prompt', 'Prompt', 'system dm lore summary'),
      settingsItem('security', 'Security', 'proxy keys'),
      settingsItem('extensions', 'Extensions', 'plugins')
    ]
    if (session) {
      for (const c of listCommands()) {
        // Anything beyond the bare name in the usage line means the command takes arguments.
        const needsArgs = c.usage.trim().toLowerCase() !== `/${c.name.toLowerCase()}`
        items.push({
          id: `cmd:${c.name}`,
          group: 'Commands',
          label: `/${c.name}`,
          hint: c.description,
          icon: Hash,
          keywords: c.usage,
          run: () => {
            const current = useChat.getState().session
            // Commands that take arguments go to the composer to be finished there.
            if (needsArgs || !current) useUi.getState().prefillComposer(`/${c.name} `)
            else void runCommand(`/${c.name}`, current)
          }
        })
      }
    }
    if (index) {
      const campaignName = new Map(index.campaigns.map((c) => [c.path, c.displayName]))
      for (const s of [...index.sessions].sort((a, b) => b.created.localeCompare(a.created))) {
        items.push({
          id: `session:${s.path}`,
          group: 'Sessions',
          label: s.title,
          hint: campaignName.get(s.campaignPath),
          icon: MessageSquare,
          run: () => {
            useVault.getState().setActiveCampaign(s.campaignPath)
            useUi.setState({ creatingCampaign: false })
            useVault.getState().selectSession(s.path)
          }
        })
      }
      for (const c of index.characters.concat(index.npcs)) {
        items.push({
          id: `char:${c.path}`,
          group: 'Characters',
          label: c.displayName,
          hint: [c.race, c.class, c.level ? `lv ${c.level}` : ''].filter(Boolean).join(' ') || undefined,
          icon: User,
          keywords: c.tags.join(' '),
          run: () => useUi.setState({ editingCharacter: c.path })
        })
      }
      for (const b of index.lorebooks) {
        items.push({ id: `lore:${b.path}`, group: 'Lorebooks', label: b.name, hint: `${b.entryCount} entries`, icon: BookOpen, run: () => useUi.setState({ editingLorebook: b.path }) })
      }
    }
    const known = new Set(items.map((i) => i.id.split(':').slice(1).join(':')))
    for (const n of notes) {
      if (known.has(n.path)) continue
      items.push({
        id: `note:${n.path}`,
        group: 'Notes',
        label: n.name,
        hint: n.path,
        icon: FileText,
        run: () => void invoke('vault:openInObsidian', n.path).catch((err: unknown) => toast.error(err, 'Could not open Obsidian'))
      })
    }
    return items
  }, [index, session, notes])
}

/** Ctrl+K: jump to anything (actions, commands, sessions, characters, lore, any vault note). */
export function CommandPalette(): React.JSX.Element {
  const open = useUi((s) => s.paletteOpen)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const all = useItems(open ? query : '')

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        useUi.setState((s) => ({ paletteOpen: !s.paletteOpen }))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
    }
  }, [open])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const scored = all.flatMap((item) => {
      const s = score(item, q)
      return s === null ? [] : [{ item, s }]
    })
    const out: Item[] = []
    for (const group of GROUP_ORDER) {
      const inGroup = scored.filter((x) => x.item.group === group).sort((a, b) => a.s - b.s)
      // Without a query, keep the list short: a few of each.
      out.push(...inGroup.slice(0, q ? 8 : group === 'Actions' ? 6 : 4).map((x) => x.item))
    }
    return out
  }, [all, query])

  useEffect(() => setActive(0), [query])
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const choose = (item: Item | undefined): void => {
    if (!item) return
    close()
    // Let the dialog close (and return focus) before the action opens anything else.
    requestAnimationFrame(() => item.run())
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(results.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(results[active])
    }
  }

  let lastGroup = ''
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => useUi.setState({ paletteOpen: o })}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-x-0 top-10 bottom-0 z-50 bg-black/40 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          className="fixed top-[18%] left-1/2 z-50 flex max-h-[min(520px,70vh)] w-[min(600px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-card outline-none"
          aria-describedby={undefined}
          onKeyDown={onKeyDown}
        >
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <div className="flex items-center gap-2 border-b px-4">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search commands, sessions, characters, notes…"
              aria-label="Search"
              role="combobox"
              aria-expanded
              aria-controls="palette-list"
              aria-activedescendant={results[active] ? `palette-${active}` : undefined}
              className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">Esc</kbd>
          </div>
          <div ref={listRef} id="palette-list" role="listbox" className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {results.length === 0 && <p className="px-3 py-8 text-center text-sm text-muted-foreground">Nothing matches “{query}”.</p>}
            {results.map((item, i) => {
              const header = item.group !== lastGroup ? item.group : null
              lastGroup = item.group
              const Icon = item.icon
              return (
                <div key={item.id}>
                  {header && <div className="px-2.5 pt-2.5 pb-1 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">{header}</div>}
                  <div
                    id={`palette-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={i === active}
                    onMouseMove={() => i !== active && setActive(i)}
                    onClick={() => choose(item)}
                    className={cn('flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-sm', i === active && 'bg-accent text-accent-foreground')}
                  >
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{item.label}</span>
                    {item.hint && <span className="ml-auto truncate pl-3 text-xs text-muted-foreground">{item.hint}</span>}
                    {i === active && <CornerDownLeft className={cn('size-3.5 shrink-0 text-muted-foreground', !item.hint && 'ml-auto')} />}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="flex items-center gap-3 border-t bg-card/50 px-4 py-2 text-[11px] text-muted-foreground">
            <span>↑↓ to move</span>
            <span>Enter to open</span>
            <span className="ml-auto">Notes open in Obsidian</span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
