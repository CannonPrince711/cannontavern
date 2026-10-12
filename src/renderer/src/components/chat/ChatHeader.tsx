import { useState } from 'react'
import { Check, ExternalLink, ImagePlus, Map as MapIcon, Pencil, ScanSearch, UserRound, Users } from 'lucide-react'
import { useMap } from '@/components/map/MapView'
import type { InvokeArgs } from '@shared/ipc'
import type { CharacterSummary } from '@shared/types'
import { inCampaign } from '@shared/membership'
import { PARTY_LIMITS, PLAY_MODE_INFO, PLAY_MODES, playModeOf, type PlayMode } from '@shared/play'
import { CharacterAvatar } from '@/components/CharacterAvatar'
import { ImageModelSwitcher, TextModelSwitcher } from '@/components/ModelSwitcher'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { NativeSelect } from '@/components/ui/controls'
import { Input } from '@/components/ui/input'
import { Tip } from '@/components/ui/tooltip'
import { invoke, on } from '@/lib/ipc'
import { useApp } from '@/stores/app'
import { useChat } from '@/stores/chat'
import { toast } from '@/stores/toasts'
import { useVault } from '@/stores/vault'

export function ChatHeader({ character, onInspect }: { character: CharacterSummary | null; onInspect?: () => void }): React.JSX.Element {
  const session = useChat((s) => s.session)!
  const settings = useApp((s) => s.settings)!
  const characters = useVault((s) => s.index?.characters)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(session.frontmatter.title)

  const mode = playModeOf(session.frontmatter)
  const persona = session.frontmatter.persona || character?.displayName || settings.general.playerName
  const personas = [...new Set([settings.general.playerName, ...(characters ?? []).map((c) => c.displayName), persona])]

  const meta = async (patch: InvokeArgs<'sessions:updateMeta'>[1]): Promise<void> => {
    try {
      useChat.setState({ session: await invoke('sessions:updateMeta', session.path, patch) })
    } catch (err) {
      toast.error(err)
    }
  }

  return (
    <header className="@container flex items-center gap-2 border-b px-4 py-2">
      {character ? (
        <CharacterAvatar name={character.displayName} avatar={character.avatar} version={character.mtimeMs} hp={character.hp} maxHp={character.max_hp} size={32} />
      ) : (
        <span className="grid size-8 place-items-center rounded-full bg-surface-2 text-muted-foreground">
          <UserRound className="size-4" />
        </span>
      )}
      <div className="min-w-[120px] flex-1">
        {editing ? (
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault()
              setEditing(false)
              if (title.trim() && title !== session.frontmatter.title) void meta({ title })
            }}
          >
            <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus className="h-7 text-sm" aria-label="Session title" onBlur={() => setEditing(false)} />
            <Button type="submit" size="icon-sm" variant="ghost" aria-label="Save title">
              <Check />
            </Button>
          </form>
        ) : (
          <button type="button" onClick={() => (setTitle(session.frontmatter.title), setEditing(true))} className="group flex max-w-full items-center gap-1.5 text-left">
            <h2 className="truncate font-display text-sm font-semibold tracking-wide">{session.frontmatter.title}</h2>
            <Pencil className="size-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
          </button>
        )}
        <p className="truncate text-[11px] text-muted-foreground">
          {character ? `${character.displayName}${character.class ? ` · ${character.class} ${character.level ?? ''}` : ''}` : 'No character'} · {session.messages.length} {session.messages.length === 1 ? 'message' : 'messages'}
        </p>
      </div>

      <Tip label={PLAY_MODE_INFO[mode].description}>
        <NativeSelect value={mode} onChange={(e) => void meta({ mode: e.target.value as PlayMode })} className="w-[7.5rem] shrink-0 @min-[760px]:w-36" aria-label="Play mode">
          {PLAY_MODES.map((m) => (
            <option key={m} value={m}>
              {PLAY_MODE_INFO[m].short}
            </option>
          ))}
        </NativeSelect>
      </Tip>

      {mode === 'ai-dm' && (
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="hidden @min-[960px]:inline">Playing as</span>
          <NativeSelect value={persona} onChange={(e) => void meta({ persona: e.target.value })} className="w-28 @min-[760px]:w-40" aria-label="Persona">
            {personas.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </NativeSelect>
        </label>
      )}

      {mode === 'ai-only' ? <PartyButton /> : mode === 'ai-dm' && <CompanionsMenu mode={mode} />}

      <TextModelSwitcher className="w-32 @min-[760px]:w-48" />
      <ImageModelSwitcher compact className="w-28 @min-[760px]:w-40" />

      <Tip label="Campaign map">
        <Button variant="ghost" size="icon-sm" aria-label="Open the map" onClick={() => useMap.setState({ open: true })}>
          <MapIcon />
        </Button>
      </Tip>
      {onInspect && (
        <Tip label="Prompt inspector">
          <Button variant="ghost" size="icon-sm" aria-label="Open prompt inspector" onClick={onInspect}>
            <ScanSearch />
          </Button>
        </Tip>
      )}
      <Tip label="Open in Obsidian">
        <Button variant="ghost" size="icon-sm" aria-label="Open session in Obsidian" onClick={() => void invoke('vault:openInObsidian', session.path).catch((e) => toast.error(e))}>
          <ExternalLink />
        </Button>
      </Tip>
    </header>
  )
}

/** Link target of a wikilink: "[[DND Tavern/NPCs/Alpha|Alpha]]" → "dnd tavern/npcs/alpha". */
function linkKey(link: string): string {
  return (/^\[\[([^\]|#]+)/.exec(link)?.[1] ?? link).replace(/\.md$/i, '').trim().toLowerCase()
}

/** AI companions: characters or NPCs the AI plays as party members, each taking a turn after yours. */
function CompanionsMenu({ mode }: { mode: PlayMode }): React.JSX.Element {
  const session = useChat((s) => s.session)!
  const index = useVault((s) => s.index)
  const links = session.frontmatter.companions ?? []
  const own = new Set(session.frontmatter.characters.map(linkKey))
  const chosen = new Set(links.map(linkKey))
  const isChosen = (path: string): boolean => {
    const k = path.replace(/\.md$/i, '').toLowerCase()
    return chosen.has(k) || [...chosen].some((c) => !c.includes('/') && k.endsWith(`/${c}`))
  }
  // Characters from other campaigns stay out unless they're already along (import them first).
  const candidates = [...(index?.characters ?? []).filter((c) => inCampaign(c, session.campaignPath) || isChosen(c.path)), ...(index?.npcs ?? [])].filter((c) => !own.has(c.path.replace(/\.md$/i, '').toLowerCase()))
  const selected = candidates.filter((c) => isChosen(c.path))

  const hasImageBackend = useApp((s) => (s.settings?.imageBackends.length ?? 0) > 0)
  const unpainted = selected.filter((c) => !c.avatar)
  // Portraits for companions who don't have one yet, one after another (each becomes their picture).
  const paintMissing = async (): Promise<void> => {
    toast.info(`Painting ${unpainted.length === 1 ? 'a portrait' : `${unpainted.length} portraits`}…`, 'They appear beside the companions’ messages when done.')
    for (const c of unpainted) {
      try {
        await new Promise<void>((resolve, reject) => {
          void invoke('images:generate', { kind: 'portrait', characterPath: c.path }).then(({ requestId }) => {
            const offs = [
              on('images:done', (e) => e.requestId === requestId && (offs.forEach((o) => o()), resolve())),
              on('images:error', (e) => e.requestId === requestId && (offs.forEach((o) => o()), reject(e.error)))
            ]
          }, reject)
        })
      } catch (err) {
        toast.error(err, `Couldn’t paint ${c.displayName}`)
        return
      }
    }
    toast.success('Portraits done')
  }

  const toggle = async (path: string): Promise<void> => {
    const next = isChosen(path) ? selected.filter((c) => c.path !== path).map((c) => c.path) : [...selected.map((c) => c.path), path]
    if (next.length > 4) return toast.info('Up to 4 companions', 'More than that slows every turn and blurs their voices.')
    try {
      useChat.setState({ session: await invoke('sessions:updateMeta', session.path, { companions: next }) })
    } catch (err) {
      toast.error(err)
    }
  }

  return (
    <DropdownMenu>
      <Tip label="AI companions: party members the AI plays, each taking a turn after yours">
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label="AI companions" className="gap-1.5 px-2">
            <Users />
            {links.length > 0 && <span className="text-xs tabular-nums">{links.length}</span>}
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" className="max-h-80 w-64 overflow-y-auto">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {mode === 'ai-only'
            ? 'More party members for the AI to play. Each character takes a turn, then the DM answers. 2–3 in total works best.'
            : 'The AI plays these as party members. After your message, each one acts, then the DM answers. 2–3 works best.'}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {candidates.length === 0 && <DropdownMenuItem disabled>Create a character or NPC first</DropdownMenuItem>}
        {unpainted.length > 0 && hasImageBackend && (
          <>
            <DropdownMenuItem onSelect={() => void paintMissing()} className="gap-2 text-gold">
              <ImagePlus className="size-4" /> Paint missing portraits ({unpainted.length})
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {candidates.map((c) => (
          <DropdownMenuItem key={c.path} onSelect={(e) => (e.preventDefault(), void toggle(c.path))} className="gap-2">
            <span className="grid size-4 place-items-center">{isChosen(c.path) && <Check className="size-3.5" />}</span>
            <CharacterAvatar name={c.displayName} avatar={c.avatar} version={c.mtimeMs} size={20} />
            <span className="truncate">{c.displayName}</span>
            {c.path.toLowerCase().includes('/npcs/') && <span className="ml-auto text-[10px] text-muted-foreground">NPC</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface GroupDraft {
  lead: string
  companions: string[]
}

/** AI only: up to 3 lead characters, each with up to 2 companions who follow them. */
function PartyButton(): React.JSX.Element {
  const session = useChat((s) => s.session)!
  const index = useVault((s) => s.index)
  const [open, setOpen] = useState(false)
  const [groups, setGroups] = useState<GroupDraft[]>([])
  const [saving, setSaving] = useState(false)
  const candidates = [...(index?.characters ?? []), ...(index?.npcs ?? [])]
  const pathOf = (link: string): string => {
    const k = linkKey(link)
    return candidates.find((c) => c.path.replace(/\.md$/i, '').toLowerCase() === k || c.path.replace(/\.md$/i, '').toLowerCase().endsWith(`/${k}`))?.path ?? ''
  }
  const fm = session.frontmatter
  const count = fm.party?.length ? fm.party.reduce((n, g) => n + 1 + g.companions.length, 0) : fm.characters.length + (fm.companions?.length ?? 0)

  const start = (): void => {
    const from: GroupDraft[] = fm.party?.length
      ? fm.party.map((g) => ({ lead: pathOf(g.lead), companions: g.companions.map(pathOf) }))
      : fm.characters.map((l, i) => ({ lead: pathOf(l), companions: i === 0 ? (fm.companions ?? []).slice(0, PARTY_LIMITS.companions).map(pathOf) : [] }))
    const filled = Array.from({ length: PARTY_LIMITS.leads }, (_, i) => ({ lead: from[i]?.lead ?? '', companions: Array.from({ length: PARTY_LIMITS.companions }, (_, j) => from[i]?.companions[j] ?? '') }))
    setGroups(filled)
    setOpen(true)
  }
  const used = new Set(groups.flatMap((g) => [g.lead, ...g.companions]).filter(Boolean))
  const set = (gi: number, slot: 'lead' | number, value: string): void =>
    setGroups((cur) => cur.map((g, i) => (i !== gi ? g : slot === 'lead' ? { lead: value, companions: value ? g.companions : g.companions.map(() => '') } : { ...g, companions: g.companions.map((c, j) => (j === slot ? value : c)) })))
  const save = async (): Promise<void> => {
    const party = groups.filter((g) => g.lead).map((g) => ({ lead: g.lead, companions: g.companions.filter(Boolean) }))
    if (!party.length) return toast.info('Pick at least one lead character')
    setSaving(true)
    try {
      useChat.setState({ session: await invoke('sessions:updateMeta', session.path, { party }) })
      setOpen(false)
    } catch (err) {
      toast.error(err, 'Couldn’t save the party')
    } finally {
      setSaving(false)
    }
  }
  const picker = (gi: number, slot: 'lead' | number, value: string, label: string, disabled = false): React.JSX.Element => (
    <NativeSelect value={value} disabled={disabled} onChange={(e) => set(gi, slot, e.target.value)} aria-label={label} className="min-w-0 flex-1">
      <option value="">{slot === 'lead' ? 'No character' : 'No companion'}</option>
      {candidates
        .filter((c) => c.path === value || (!used.has(c.path) && (c.path.toLowerCase().includes('/npcs/') || inCampaign(c, session.campaignPath))))
        .map((c) => (
          <option key={c.path} value={c.path}>
            {c.displayName}
            {c.path.toLowerCase().includes('/npcs/') ? ' (NPC)' : ''}
          </option>
        ))}
    </NativeSelect>
  )
  const members = groups.reduce((n, g) => n + (g.lead ? 1 + g.companions.filter(Boolean).length : 0), 0)

  return (
    <>
      <Tip label="Party: the characters the AI plays, each with their companions">
        <Button variant="ghost" size="sm" aria-label="Party" className="gap-1.5 px-2" onClick={start}>
          <Users />
          {count > 0 && <span className="text-xs tabular-nums">{count}</span>}
        </Button>
      </Tip>
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)}>
          <DialogContent className="w-[min(620px,calc(100vw-48px))]">
            <DialogHeader>
              <DialogTitle>Party</DialogTitle>
              <DialogDescription>
                The AI plays up to {PARTY_LIMITS.leads} lead characters, each with up to {PARTY_LIMITS.companions} companions who follow them. Each round, every leader acts, then their companions, then the DM answers.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 px-6 py-2">
              {groups.map((g, gi) => (
                <div key={gi} className="space-y-1.5 rounded-lg border bg-card/60 p-3">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Group {gi + 1}</p>
                  <div className="flex items-center gap-2">
                    <span className="w-24 shrink-0 text-xs">Leader</span>
                    {picker(gi, 'lead', g.lead, `Group ${gi + 1} leader`)}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-24 shrink-0 text-xs text-muted-foreground">Companions</span>
                    {g.companions.map((c, ci) => (
                      <span key={ci} className="flex min-w-0 flex-1">
                        {picker(gi, ci, c, `Group ${gi + 1} companion ${ci + 1}`, !g.lead)}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              {members > 5 && <p className="text-xs text-gold">{members} party members means long rounds: every one of them writes before the DM answers.</p>}
              {candidates.length === 0 && <p className="text-xs text-muted-foreground">Create characters or NPCs first.</p>}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void save()} disabled={saving}>
                Save party
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
