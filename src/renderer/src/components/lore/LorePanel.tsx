import { useEffect, useMemo, useState } from 'react'
import { askText } from '@/components/AskDialog'
import { BookPlus, Pencil, Sparkles } from 'lucide-react'
import { selectLore } from '@shared/prompt'
import type { LoreEntry, Lorebook } from '@shared/types'
import { EmptyState } from '@/components/EmptyState'
import { BookArt } from '@/components/illustrations'
import { Button } from '@/components/ui/button'
import { Badge, Switch } from '@/components/ui/controls'
import { Tip } from '@/components/ui/tooltip'
import { useCampaign } from '@/hooks/useCampaign'
import { invoke, on } from '@/lib/ipc'
import { useApp } from '@/stores/app'
import { useChat } from '@/stores/chat'
import { toast } from '@/stores/toasts'
import { useUi } from '@/stores/ui'
import { useVault } from '@/stores/vault'

/** "[[DND Tavern/Lorebooks/World|World]]" or "[[World]]" → matches a lorebook path? */
function linkMatches(link: string, path: string): boolean {
  const target = link.replace(/^\[\[|\]\]$/g, '').split('|')[0]!.replace(/\.md$/i, '').toLowerCase()
  const p = path.replace(/\.md$/i, '').toLowerCase()
  return p === target || p.endsWith(`/${target}`)
}

export function LorePanel(): React.JSX.Element {
  const index = useVault((s) => s.index)
  const activeCampaign = useVault((s) => s.activeCampaign)
  const campaignSummary = index?.campaigns.find((c) => c.path === activeCampaign)
  const { campaign, setCampaign } = useCampaign(activeCampaign)
  const messages = useChat((s) => s.session?.messages)
  const prompt = useApp((s) => s.settings?.prompt)
  const [books, setBooks] = useState<Record<string, Lorebook>>({})

  const lorebooks = index?.lorebooks ?? []
  const linked = lorebooks.filter((b) => campaign?.lorebooks.some((l) => linkMatches(l, b.path)))
  const linkedKey = linked.map((b) => `${b.path}:${b.mtimeMs}`).join('|')

  // Load the entries of linked books (refreshing when they change).
  useEffect(() => {
    let stale = false
    Promise.all(linked.map((b) => invoke('lorebooks:get', b.path).catch(() => null))).then((list) => {
      if (stale) return
      setBooks(Object.fromEntries(list.filter((b): b is Lorebook => !!b).map((b) => [b.path, b])))
    })
    return () => {
      stale = true
    }
  }, [linkedKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const triggered = useMemo<(LoreEntry & { book: string })[]>(() => {
    if (!messages || !prompt) return []
    const all = Object.values(books).flatMap((b) => b.entries.map((e) => ({ ...e, book: b.name })))
    return selectLore(all, messages, prompt.lorebookScanDepth, prompt.lorebookTokenBudget) as (LoreEntry & { book: string })[]
  }, [books, messages, prompt])

  const toggleLink = async (path: string, on: boolean): Promise<void> => {
    if (!activeCampaign) return
    const next = on ? [...linked.map((b) => b.path), path] : linked.map((b) => b.path).filter((p) => p !== path)
    try {
      setCampaign(await invoke('campaigns:setLorebooks', activeCampaign, next))
    } catch (err) {
      toast.error(err)
    }
  }

  const create = async (): Promise<void> => {
    const name = await askText({ title: 'New lorebook', description: 'Creates a note in Lorebooks/.', initial: campaignSummary ? `${campaignSummary.displayName} Lore` : 'World Lore' })
    if (!name?.trim()) return
    try {
      const book = await invoke('lorebooks:create', name.trim())
      if (activeCampaign) await toggleLink(book.path, true)
      useUi.setState({ editingLorebook: book.path })
    } catch (err) {
      toast.error(err)
    }
  }

  if (!index) {
    return <EmptyState illustration={<BookArt />} title="No vault" description="Connect a vault to use lorebooks." className="pt-16" />
  }

  return (
    <div className="space-y-5 p-3">
      <section>
        <h3 className="mb-2 flex items-center gap-1.5 px-1 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          <Sparkles className="size-3.5 text-gold" /> In the prompt now
        </h3>
        {!messages ? (
          <p className="px-1 text-xs text-muted-foreground">Open a session to see which entries the conversation triggers.</p>
        ) : triggered.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">No entries triggered by the last {prompt?.lorebookScanDepth} messages.</p>
        ) : (
          <ul className="space-y-1.5">
            {triggered.map((e) => (
              <li key={`${e.book}/${e.title}`} className="rounded-lg border bg-card px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="flex-1 truncate text-sm font-medium">{e.title}</span>
                  {e.always_on ? <Badge tone="gold">always</Badge> : <Badge>{e.keys.slice(0, 2).join(', ')}</Badge>}
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{e.content}</p>
                <p className="mt-1 text-[10px] text-muted-foreground/80">{e.book}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between px-1">
          <h3 className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">Lorebooks</h3>
          <Button variant="ghost" size="sm" onClick={() => void create()}>
            <BookPlus /> New
          </Button>
        </div>
        {lorebooks.length === 0 ? (
          <EmptyState illustration={<BookArt />} title="No lorebooks" description="A lorebook is a note with one ## section per entry and trigger words after keys::." />
        ) : (
          <ul className="space-y-1">
            {lorebooks.map((b) => {
              const isLinked = linked.some((l) => l.path === b.path)
              return (
                <li key={b.path} className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent">
                  <Tip label={isLinked ? `Used in ${campaignSummary?.displayName ?? 'this campaign'}` : 'Not used in this campaign'}>
                    <Switch aria-label={`Use ${b.name} in this campaign`} checked={isLinked} onCheckedChange={(v) => void toggleLink(b.path, v)} disabled={!activeCampaign} />
                  </Tip>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{b.name}</span>
                    <span className="text-[11px] text-muted-foreground">{b.entryCount} entries</span>
                  </span>
                  <Button variant="ghost" size="icon-sm" aria-label={`Edit ${b.name}`} onClick={() => useUi.setState({ editingLorebook: b.path })}>
                    <Pencil />
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

/** Keeps a lorebook editor in sync with the file (used by LorebookEditor). */
export function useLorebookFile(path: string | null, onExternal: () => void): void {
  useEffect(() => {
    if (!path) return
    return on('vault:changed', (e) => e.path === path && e.event !== 'unlink' && onExternal())
  }, [path, onExternal])
}
