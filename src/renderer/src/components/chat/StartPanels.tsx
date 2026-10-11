import { useEffect, useState } from 'react'
import { Loader2, ScrollText, Sparkles } from 'lucide-react'
import { CharacterAvatar } from '@/components/CharacterAvatar'
import { EmptyState } from '@/components/EmptyState'
import { BookArt, ScrollArt } from '@/components/illustrations'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { invoke } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { toast } from '@/stores/toasts'
import { useUi } from '@/stores/ui'
import { useActiveCampaign, useVault } from '@/stores/vault'
import { useApp } from '@/stores/app'
import { PLAY_MODE_INFO, PLAY_MODES, type PlayMode } from '@shared/play'

export function CreateCampaignPanel(): React.JSX.Element {
  const setActiveCampaign = useVault((s) => s.setActiveCampaign)
  const selectSession = useVault((s) => s.selectSession)
  const cancellable = useVault((s) => (s.index?.campaigns.length ?? 0) > 0)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const create = async (): Promise<void> => {
    setBusy(true)
    try {
      const c = await invoke('campaigns:create', name.trim())
      setActiveCampaign(c.path)
      selectSession(null)
      useUi.setState({ creatingCampaign: false })
      toast.success(`Campaign “${c.name}” created`, 'Campaign.md and Party.md are in your vault.')
    } catch (err) {
      toast.error(err, 'Could not create the campaign')
    } finally {
      setBusy(false)
    }
  }
  return (
    <EmptyState
      size="lg"
      illustration={<BookArt />}
      title="Begin a campaign"
      description="A campaign is a folder in your vault with its setting, party sheet, sessions and images."
      action={
        <form
          className="flex w-96 gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) void create()
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="The Sunken Lantern" aria-label="Campaign name" autoFocus />
          <Button type="submit" disabled={!name.trim() || busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} Create
          </Button>
          {cancellable && (
            <Button type="button" variant="ghost" onClick={() => useUi.setState({ creatingCampaign: false })}>
              Cancel
            </Button>
          )}
        </form>
      }
    />
  )
}

export function NewSessionPanel(): React.JSX.Element {
  const campaign = useActiveCampaign()
  const index = useVault((s) => s.index)
  const selectedCharacter = useVault((s) => s.selectedCharacter)
  const selectSession = useVault((s) => s.selectSession)
  const [character, setCharacter] = useState<string | null>(selectedCharacter ?? index?.characters[0]?.path ?? null)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const defaultMode = useApp((s) => s.settings?.play.defaultMode ?? 'ai-dm')
  const [mode, setMode] = useState<PlayMode>(defaultMode)
  const recent = (index?.sessions ?? []).filter((s) => s.campaignPath === campaign?.path).slice(0, 5)

  // A campaign can set its own default mode (Campaign.md: "mode: ai-only").
  useEffect(() => {
    if (!campaign) return
    let stale = false
    invoke('campaigns:get', campaign.path)
      .then((r) => !stale && r.campaign.mode && setMode(r.campaign.mode))
      .catch(() => {})
    return () => {
      stale = true
    }
  }, [campaign?.path]) // eslint-disable-line react-hooks/exhaustive-deps

  const start = async (): Promise<void> => {
    if (!campaign) return
    setBusy(true)
    try {
      const s = await invoke('sessions:create', { campaignPath: campaign.path, characterPath: character ?? undefined, title: title.trim() || undefined, mode })
      if (mode !== defaultMode) void useApp.getState().updateSettings({ play: { defaultMode: mode } })
      selectSession(s.path)
    } catch (err) {
      toast.error(err, 'Could not start the session')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl px-6 py-10">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 w-16 text-muted-foreground">
          <ScrollArt />
        </div>
        <h2 className="font-display text-xl font-semibold tracking-wide">New session</h2>
        <p className="mt-1 text-sm text-muted-foreground">{campaign ? `in ${campaign.displayName}` : 'Choose a campaign first'}</p>
      </div>

      <div className="space-y-4 rounded-xl border bg-card/80 p-5 shadow-card">
        <div className="space-y-2">
          <Label>Character</Label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              aria-pressed={character === null}
              onClick={() => setCharacter(null)}
              className={cn('flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm hover:bg-accent', character === null && 'border-primary ring-1 ring-primary')}
            >
              <span className="grid size-8 place-items-center rounded-full bg-surface-2 text-xs text-muted-foreground">—</span>
              No character
            </button>
            {index?.characters.map((c) => (
              <button
                key={c.path}
                type="button"
                aria-pressed={character === c.path}
                onClick={() => setCharacter(c.path)}
                className={cn('flex items-center gap-2 rounded-lg border px-3 py-2 text-left hover:bg-accent', character === c.path && 'border-primary ring-1 ring-primary')}
              >
                <CharacterAvatar name={c.displayName} avatar={c.avatar} version={c.mtimeMs} size={32} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{c.displayName}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{[c.class, c.level && `Lv ${c.level}`].filter(Boolean).join(' ') || 'No sheet'}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <Label>Who plays</Label>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Who plays">
            {PLAY_MODES.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={cn('rounded-lg border px-3 py-2 text-left hover:bg-accent', mode === m && 'border-primary ring-1 ring-primary')}
              >
                <span className="block text-sm font-medium">{PLAY_MODE_INFO[m].label}</span>
                <span className="block text-[11px] leading-snug text-muted-foreground">{PLAY_MODE_INFO[m].description}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ns-title">Title (optional)</Label>
          <Input id="ns-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Session 01" />
        </div>
        <Button className="w-full" size="lg" onClick={() => void start()} disabled={!campaign || busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} Start session
        </Button>
      </div>

      {recent.length > 0 && (
        <div className="mt-8">
          <h3 className="mb-2 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">Continue</h3>
          <ul className="space-y-1">
            {recent.map((s) => (
              <li key={s.path}>
                <button type="button" onClick={() => selectSession(s.path)} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent">
                  <ScrollText className="size-4 text-muted-foreground" />
                  <span className="flex-1 truncate">{s.title}</span>
                  <span className="text-[11px] text-muted-foreground">{s.messageCount} messages</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
