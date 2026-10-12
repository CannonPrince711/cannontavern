import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, ChevronsUpDown, ExternalLink, FileUp, Pencil, Plus, ScrollText, Search, Settings2, UserPlus, Wand2 } from 'lucide-react'
import type { SessionSummary } from '@shared/types'
import { NewCharacterDialog } from '@/components/characters/CharacterEditor'
import { CharacterAvatar } from '@/components/CharacterAvatar'
import { EmptyState } from '@/components/EmptyState'
import { HoodArt, ScrollArt } from '@/components/illustrations'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuItem,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tip } from '@/components/ui/tooltip'
import { ListSkeleton } from '@/components/ui/skeleton'
import { mouseShortcutsOn, separator, showMenu } from '@/lib/mouse'
import { invoke } from '@/lib/ipc'
import { askConfirm } from '@/components/AskDialog'
import { useChat } from '@/stores/chat'
import { toast } from '@/stores/toasts'
import { useUi } from '@/stores/ui'
import { cn } from '@/lib/utils'
import { useActiveCampaign, useVault } from '@/stores/vault'

function SectionHeader({
  title,
  onAdd,
  addLabel,
  menu
}: {
  title: string
  onAdd?: () => void
  addLabel: string
  menu?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between px-3 pt-4 pb-1">
      <h2 className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">{title}</h2>
      {menu ?? (
        <Tip label={addLabel}>
          <Button variant="ghost" size="icon-sm" aria-label={addLabel} onClick={onAdd} disabled={!onAdd}>
            <Plus />
          </Button>
        </Tip>
      )}
    </div>
  )
}

function EditButton({ path }: { path: string }): React.JSX.Element {
  return (
    <Tip label="Edit card">
      <button
        type="button"
        aria-label="Edit character card"
        onClick={(e) => {
          e.stopPropagation()
          useUi.setState({ editingCharacter: path })
        }}
        className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100"
      >
        <Pencil className="size-3.5" />
      </button>
    </Tip>
  )
}

async function importCards(): Promise<void> {
  try {
    const notes = await invoke('characters:import')
    if (notes.length) {
      toast.success(`Imported ${notes.length} character${notes.length > 1 ? 's' : ''}`, notes.map((n) => n.card.name).join(', '))
      useVault.getState().selectCharacter(notes[0]!.path)
    }
  } catch (err) {
    toast.error(err, 'Import failed')
  }
}

function OpenInObsidian({ path }: { path: string }): React.JSX.Element {
  return (
    <Tip label="Open in Obsidian">
      <button
        type="button"
        aria-label="Open in Obsidian"
        onClick={(e) => {
          e.stopPropagation()
          void invoke('vault:openInObsidian', path)
        }}
        className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100"
      >
        <ExternalLink className="size-3.5" />
      </button>
    </Tip>
  )
}

function CampaignSwitcher(): React.JSX.Element {
  const index = useVault((s) => s.index)
  const active = useActiveCampaign()
  const setActiveCampaign = useVault((s) => s.setActiveCampaign)
  const campaigns = index?.campaigns ?? []

  const trigger = (
    <button
      type="button"
      disabled={campaigns.length === 0}
      className="flex w-full items-center gap-2.5 rounded-lg border bg-card px-2.5 py-2 text-left transition-colors hover:bg-accent disabled:cursor-default disabled:hover:bg-card"
      aria-label="Switch campaign"
    >
      <span className="grid size-8 place-items-center rounded-md bg-surface-2 font-display text-sm text-gold">
        {active ? active.displayName[0]?.toUpperCase() : '?'}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] text-muted-foreground">Campaign</span>
        <span className="block truncate text-sm font-medium">{active?.displayName ?? 'None yet'}</span>
      </span>
      <ChevronsUpDown className="size-4 text-muted-foreground" />
    </button>
  )

  if (campaigns.length === 0) return trigger
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
        <DropdownMenuLabel>Campaigns</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={active?.path ?? ''}
          onValueChange={(p) => {
            setActiveCampaign(p)
            useVault.getState().selectSession(null)
          }}
        >
          {campaigns.map((c) => (
            <DropdownMenuRadioItem key={c.path} value={c.path}>
              <span className="min-w-0 flex-1 truncate">{c.displayName}</span>
              <span className="text-[11px] text-muted-foreground">{c.sessionCount}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => useUi.setState({ creatingCampaign: true })}>
          <Plus /> New campaign…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => useUi.setState({ buildingCampaign: true })}>
          <Wand2 /> Campaign builder…
        </DropdownMenuItem>
        {active && (
          <DropdownMenuItem onSelect={() => useUi.setState({ campaignSettings: active.path })}>
            <Settings2 /> Campaign settings…
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Asks first, then moves the session note to the Recycle Bin (closing it if it's open). */
async function deleteSession(s: SessionSummary): Promise<void> {
  const ok = await askConfirm({
    title: `Delete “${s.title}”?`,
    description: `The session and its ${s.messageCount} ${s.messageCount === 1 ? 'message' : 'messages'} move to the Recycle Bin, where you can restore them. Pictures in the campaign’s Images folder stay.`,
    confirmLabel: 'Delete',
    danger: true
  })
  if (!ok) return
  try {
    await invoke('sessions:delete', s.path)
    if (useChat.getState().session?.path === s.path) useChat.setState({ session: null })
    toast.success(`Deleted “${s.title}”`, 'It’s in the Recycle Bin if you need it back.')
  } catch (err) {
    toast.error(err, 'Couldn’t delete the session')
  }
}

function openInObsidian(path: string): void {
  void invoke('vault:openInObsidian', path).catch((err) => toast.error(err, 'Could not open Obsidian'))
}

export function LeftSidebar(): React.JSX.Element {
  const index = useVault((s) => s.index)
  const loaded = useVault((s) => s.loaded)
  const activeCampaign = useVault((s) => s.activeCampaign)
  const selectedCharacter = useVault((s) => s.selectedCharacter)
  const selectedSession = useVault((s) => s.selectedSession)
  const selectCharacter = useVault((s) => s.selectCharacter)
  const selectSession = useVault((s) => s.selectSession)
  const [query, setQuery] = useState('')
  const [newCharacter, setNewCharacter] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  // Opening a session also makes its campaign the active one.
  const openSession = (s: SessionSummary): void => {
    if (s.campaignPath !== activeCampaign) useVault.getState().setActiveCampaign(s.campaignPath)
    selectSession(s.path)
  }

  const q = query.trim().toLowerCase()
  const characters = useMemo(
    () => (index?.characters ?? []).filter((c) => !q || c.displayName.toLowerCase().includes(q)),
    [index, q]
  )
  const groups = useMemo(() => {
    const sessions = (index?.sessions ?? []).filter((s) => !q || s.title.toLowerCase().includes(q))
    const byCampaign = new Map<string, SessionSummary[]>()
    for (const s of sessions) byCampaign.set(s.campaignPath, [...(byCampaign.get(s.campaignPath) ?? []), s])
    return (index?.campaigns ?? [])
      .filter((c) => byCampaign.has(c.path))
      .map((c) => ({ campaign: c, sessions: byCampaign.get(c.path)! }))
      .sort((a, b) => Number(b.campaign.path === activeCampaign) - Number(a.campaign.path === activeCampaign))
  }, [index, q, activeCampaign])

  return (
    <aside className="flex h-full min-w-0 flex-col" aria-label="Characters and sessions">
      <div className="space-y-2 border-b p-3">
        <CampaignSwitcher />
        <label className="relative block">
          <span className="sr-only">Search characters and sessions</span>
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="h-8 w-full rounded-md border bg-background/60 pr-2 pl-8 text-sm placeholder:text-muted-foreground"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        <SectionHeader
          title="Characters"
          addLabel="New character"
          menu={
            <DropdownMenu>
              <Tip label="Add character">
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="Add character" disabled={!index}>
                    <Plus />
                  </Button>
                </DropdownMenuTrigger>
              </Tip>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setNewCharacter(true)}>
                  <UserPlus /> New character…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void importCards()}>
                  <FileUp /> Import SillyTavern cards…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />
        <NewCharacterDialog open={newCharacter} onOpenChange={setNewCharacter} />
        {!loaded ? (
          <ListSkeleton rows={3} avatar />
        ) : characters.length === 0 ? (
          <EmptyState
            illustration={<HoodArt />}
            title={q ? 'No matches' : 'No characters yet'}
            description={
              q ? undefined : index ? 'Create a character or import a SillyTavern card.' : 'Connect a vault to see your characters.'
            }
          />
        ) : (
          <ul className="space-y-0.5 px-2" role="listbox" aria-label="Characters">
            {characters.map((c) => (
              <li key={c.path}>
                <div
                  role="option"
                  tabIndex={0}
                  aria-selected={selectedCharacter === c.path}
                  onClick={() => selectCharacter(c.path)}
                  onDoubleClick={() => useUi.setState({ editingCharacter: c.path })}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && selectCharacter(c.path)}
                  onAuxClick={(e) => e.button === 1 && mouseShortcutsOn() && openInObsidian(c.path)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    void showMenu([
                      { label: 'Edit card…', run: () => useUi.setState({ editingCharacter: c.path }) },
                      { label: 'Select', run: () => selectCharacter(c.path) },
                      {
                        label: 'New session with this character',
                        run: () => {
                          selectCharacter(c.path)
                          selectSession(null)
                          useUi.setState({ creatingCampaign: false })
                        }
                      },
                      separator,
                      { label: 'Open in Obsidian', run: () => openInObsidian(c.path) }
                    ])
                  }}
                  className={cn(
                    'group flex cursor-default items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent',
                    selectedCharacter === c.path && 'bg-accent'
                  )}
                >
                  <CharacterAvatar name={c.displayName} avatar={c.avatar} version={c.mtimeMs} hp={c.hp} maxHp={c.max_hp} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{c.displayName}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {[c.race, c.class, c.level ? `Lv ${c.level}` : null].filter(Boolean).join(' · ') || 'No sheet'}
                    </span>
                  </span>
                  <EditButton path={c.path} />
                  <OpenInObsidian path={c.path} />
                </div>
              </li>
            ))}
          </ul>
        )}

        <SectionHeader
          title="Sessions"
          addLabel="New session"
          onAdd={index && index.campaigns.length ? () => (selectSession(null), useUi.setState({ creatingCampaign: false })) : undefined}
        />
        {!loaded ? (
          <ListSkeleton rows={4} />
        ) : groups.length === 0 ? (
          <EmptyState
            illustration={<ScrollArt />}
            title={q ? 'No matches' : 'No sessions'}
            description={q ? undefined : 'Sessions are saved as notes in your vault, grouped by campaign.'}
          />
        ) : (
          <div className="space-y-1 px-2">
            {groups.map(({ campaign, sessions }) => {
              const isCollapsed = collapsed[campaign.path] ?? campaign.path !== activeCampaign
              return (
                <section key={campaign.path} aria-label={campaign.displayName}>
                  <button
                    type="button"
                    onClick={() => setCollapsed((s) => ({ ...s, [campaign.path]: !isCollapsed }))}
                    aria-expanded={!isCollapsed}
                    className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    {isCollapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                    <span className="truncate">{campaign.displayName}</span>
                    <span className="ml-auto text-[11px]">{sessions.length}</span>
                  </button>
                  {!isCollapsed && (
                    <ul className="space-y-0.5" role="listbox" aria-label={`${campaign.displayName} sessions`}>
                      {sessions.map((s) => (
                        <li key={s.path}>
                          <div
                            role="option"
                            tabIndex={0}
                            aria-selected={selectedSession === s.path}
                            onClick={() => openSession(s)}
                            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && openSession(s)}
                            onAuxClick={(e) => e.button === 1 && mouseShortcutsOn() && openInObsidian(s.path)}
                            onContextMenu={(e) => {
                              e.preventDefault()
                              void showMenu([
                                { label: 'Open', run: () => openSession(s) },
                                { label: 'Open in Obsidian', run: () => openInObsidian(s.path) },
                                separator,
                                {
                                  label: 'Compress into a recap now',
                                  run: () =>
                                    void invoke('sessions:compress', s.path, true)
                                      .then(() => toast.success(`Compressed “${s.title}”`))
                                      .catch((err) => toast.error(err, 'Could not compress'))
                                },
                                { label: 'Copy title', run: () => void navigator.clipboard.writeText(s.title) },
                                separator,
                                { label: 'Delete session…', run: () => void deleteSession(s) }
                              ])
                            }}
                            className={cn(
                              'group flex cursor-default items-center gap-2 rounded-md py-1.5 pr-1 pl-6 text-sm transition-colors hover:bg-accent',
                              selectedSession === s.path && 'bg-accent text-foreground'
                            )}
                          >
                            <ScrollText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                            <span className="min-w-0 flex-1 truncate">{s.title}</span>
                            <span className="text-[11px] text-muted-foreground group-hover:hidden">{s.messageCount}</span>
                            <OpenInObsidian path={s.path} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )
            })}
          </div>
        )}
      </div>
    </aside>
  )
}
