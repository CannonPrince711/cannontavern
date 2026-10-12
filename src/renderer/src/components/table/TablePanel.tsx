import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { Check, Copy, Globe, Loader2, MonitorPlay, Radio, Square, UserX, Users, Wifi } from 'lucide-react'
import { AUTO_RESPOND_INFO, TABLE_DEFAULT_PORT, type AutoRespond, type TableStatus } from '@shared/table'
import { playModeOf } from '@shared/play'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/controls'
import { Input, Label } from '@/components/ui/input'
import { Switch } from '@/components/ui/controls'
import { Tip } from '@/components/ui/tooltip'
import { invoke, on } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { useChat } from '@/stores/chat'
import { toast } from '@/stores/toasts'
import { useVault } from '@/stores/vault'
import { useUi } from '@/stores/ui'

export const useTable = create<{ status: TableStatus | null }>(() => ({ status: null }))

/** Keeps the host's status in sync and tells it which session is open. */
export function useTableSync(): void {
  const sessionPath = useChat((s) => s.session?.path ?? null)
  const hosting = useTable((s) => s.status?.hosting ?? false)
  useEffect(() => {
    void invoke('table:status')
      .then((status) => useTable.setState({ status }))
      .catch(() => {})
    return on('table:changed', (status) => useTable.setState({ status }))
  }, [])
  useEffect(() => {
    if (hosting) void invoke('table:setSession', sessionPath).catch(() => {})
  }, [hosting, sessionPath])
}

function CopyLink({ url }: { url: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-1.5 rounded-md border bg-background/60 px-2 py-1">
      <code className="min-w-0 flex-1 truncate font-mono text-xs select-all">{url}</code>
      <Tip label="Copy link">
        <button
          type="button"
          aria-label="Copy join link"
          onClick={() => {
            void navigator.clipboard.writeText(url)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {copied ? <Check className="size-3.5 text-emerald" /> : <Copy className="size-3.5" />}
        </button>
      </Tip>
    </div>
  )
}

/**
 * The DM screen's table controls: host a game, share the join link, open the
 * player screen, choose when the AI DM answers, and manage players.
 */
export function TablePanel(): React.JSX.Element {
  const status = useTable((s) => s.status)
  const session = useChat((s) => s.session)
  const characters = useVault((s) => s.index?.characters)
  const [scope, setScope] = useState<'local' | 'network'>('network')
  const [port, setPort] = useState(TABLE_DEFAULT_PORT)
  const [busy, setBusy] = useState(false)
  const [funnel, setFunnelState] = useState(() => {
    try {
      return localStorage.getItem('table.funnel') === '1'
    } catch {
      return false
    }
  })
  const setFunnel = (on: boolean): void => {
    setFunnelState(on)
    // Funnel brings players in through this PC, so "This PC only" is enough and safest.
    if (on) setScope('local')
    try {
      localStorage.setItem('table.funnel', on ? '1' : '0')
    } catch {
      /* not remembered */
    }
  }

  const run = async (fn: () => Promise<TableStatus | void>, error: string): Promise<void> => {
    setBusy(true)
    try {
      const s = await fn()
      if (s) useTable.setState({ status: s })
    } catch (err) {
      toast.error(err, error)
    } finally {
      setBusy(false)
    }
  }

  if (!status?.hosting) {
    return (
      <div className="space-y-4 p-3 text-sm">
        <div className="rounded-lg border bg-card/70 p-3">
          <h3 className="mb-1 flex items-center gap-2 font-display font-semibold tracking-wide">
            <Users className="size-4 text-gold" /> Play together
          </h3>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Host this session: players join from any browser (phone, tablet or laptop) with a link and code, claim a character and act as it. You keep the DM screen; they get a player screen. Rolls happen here.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>Who can join</Label>
          <div className="grid grid-cols-2 gap-1.5">
            {(
              [
                ['network', 'Local network & online', 'Phones and laptops on your Wi-Fi, or anyone you share it with (port forwarding or Tailscale).'],
                ['local', 'This PC only', 'For a player screen on a second monitor or TV, and players on this computer.']
              ] as const
            ).map(([value, label, hint]) => (
              <button
                key={value}
                type="button"
                aria-pressed={scope === value}
                onClick={() => setScope(value)}
                className={cn('rounded-lg border px-2.5 py-2 text-left hover:bg-accent', scope === value && 'border-primary ring-1 ring-primary')}
              >
                <span className="block text-xs font-medium">{label}</span>
                <span className="block text-[11px] leading-snug text-muted-foreground">{hint}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="tbl-port">Port</Label>
            <Input id="tbl-port" type="number" min={1024} max={65535} value={port} onChange={(e) => setPort(Number(e.target.value) || TABLE_DEFAULT_PORT)} className="h-8 w-24" />
          </div>
          <Button className="flex-1" disabled={busy || !session} onClick={() => void run(() => invoke('table:start', { scope, port, sessionPath: session?.path ?? null, funnel }), 'Could not start hosting')}>
            {busy ? <Loader2 className="animate-spin" /> : <Radio />} Start hosting
          </Button>
        </div>
        <label className="flex items-start gap-2 rounded-lg border p-2.5">
          <Switch checked={funnel} onCheckedChange={setFunnel} aria-label="Share online with Tailscale Funnel" className="mt-0.5" />
          <span className="text-xs leading-relaxed">
            <span className="font-medium">Share online with Tailscale Funnel</span>
            <span className="block text-muted-foreground">
              Players join from anywhere with an https:// link, no port forwarding and nothing to install. Needs Tailscale signed in on this PC; turned off again when you stop hosting.
            </span>
          </span>
        </label>
        {!session && <p className="text-xs text-muted-foreground">Open a session first.</p>}
        {scope === 'network' && <p className="text-[11px] text-muted-foreground">Windows may ask whether DND Tavern can use the network; allow it for private networks.</p>}
      </div>
    )
  }

  const mode = playModeOf(session?.frontmatter)
  const nameOf = (path?: string): string | undefined => characters?.find((c) => c.path === path)?.displayName
  const players = status.players

  return (
    <div className="space-y-4 p-3 text-sm">
      <div className="rounded-lg border border-emerald/40 bg-emerald/10 p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="relative flex size-2.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald opacity-60" />
            <span className="relative inline-flex size-2.5 rounded-full bg-emerald" />
          </span>
          <span className="font-medium">Hosting{status.scope === 'local' ? ' on this PC' : ''}</span>
          <span className="ml-auto font-mono text-base font-semibold tracking-widest">{status.code}</span>
        </div>
        {status.publicUrl && (
          <div className="mb-2 space-y-1">
            <p className="flex items-center gap-1 text-[11px] font-medium text-gold">
              <Globe className="size-3" /> Online link (Tailscale Funnel): anyone with the link can reach the join page
            </p>
            <CopyLink url={status.publicUrl} />
          </div>
        )}
        <div className="space-y-1.5">
          {status.urls.map((u) => (
            <CopyLink key={u} url={u} />
          ))}
          {status.urls.length === 0 && <p className="text-xs text-muted-foreground">No network connection found.</p>}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {status.scope === 'network' ? <Wifi className="mr-1 inline size-3" /> : null}
          Players open the link (the code is in it) and pick a character.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={() => void run(() => invoke('table:openScreen'), 'Could not open the player screen')}>
          <MonitorPlay /> Player screen
        </Button>
        <Button variant="outline" className="text-crimson" disabled={busy} onClick={() => void run(() => invoke('table:stop'), 'Could not stop')}>
          <Square /> Stop hosting
        </Button>
      </div>

      {mode === 'ai-dm' && (
        <div className="space-y-1.5">
          <Label htmlFor="tbl-respond">When players act</Label>
          <NativeSelect id="tbl-respond" value={status.autoRespond} onChange={(e) => void run(() => invoke('table:setAutoRespond', e.target.value as AutoRespond), 'Could not change')}>
            {(Object.keys(AUTO_RESPOND_INFO) as AutoRespond[]).map((k) => (
              <option key={k} value={k}>
                {AUTO_RESPOND_INFO[k]}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
      {mode === 'user-dm' && <p className="text-xs text-muted-foreground">You are the DM: players act, you narrate from this screen.</p>}
      {mode === 'ai-only' && <p className="text-xs text-muted-foreground">AI only: players watch the story unfold.</p>}

      {status.requests.some((r) => r.status === 'writing' || r.status === 'ready' || r.status === 'failed') && (
        <section className="space-y-1">
          <h3 className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">New characters</h3>
          {status.requests
            .filter((r) => r.status === 'writing' || r.status === 'ready' || r.status === 'failed')
            .map((r) => (
              <div key={r.id} className={cn('space-y-1.5 rounded-md border px-2.5 py-2', r.status === 'ready' ? 'border-gold/50 bg-gold/5' : 'bg-card/60')}>
                <p className="text-xs">
                  <span className="font-medium">{r.playerName}</span>
                  {r.status === 'writing' && <span className="text-muted-foreground"> is making a character…</span>}
                  {r.status === 'ready' && (
                    <span>
                      ’s character: <span className="font-medium">{r.name}</span>
                      {r.summary && <span className="text-muted-foreground"> ({r.summary})</span>}
                    </span>
                  )}
                  {r.status === 'failed' && <span className="text-crimson"> couldn’t get a character: {r.error}</span>}
                </p>
                <p className="line-clamp-2 text-[11px] text-muted-foreground italic">“{r.concept}”</p>
                {r.status === 'writing' && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
                {r.status !== 'writing' && (
                  <div className="flex gap-1.5">
                    {r.status === 'ready' && r.characterPath && (
                      <>
                        <Button size="sm" variant="outline" className="h-7" onClick={() => useUi.setState({ editingCharacter: r.characterPath! })}>
                          Review
                        </Button>
                        <Button size="sm" className="h-7" disabled={busy} onClick={() => void run(() => invoke('table:approveCharacter', r.id), 'Could not approve')}>
                          Approve
                        </Button>
                      </>
                    )}
                    <Button size="sm" variant="ghost" className="h-7 text-crimson" disabled={busy} onClick={() => void run(() => invoke('table:declineCharacter', r.id), 'Could not decline')}>
                      {r.status === 'failed' ? 'Dismiss' : 'Decline'}
                    </Button>
                  </div>
                )}
              </div>
            ))}
        </section>
      )}

      <section className="space-y-1">
        <h3 className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">Players ({players.length})</h3>
        {players.length === 0 && <p className="text-xs text-muted-foreground">Waiting for players…</p>}
        {players.map((p) => (
          <div key={p.id} className="flex items-center gap-2 rounded-md border bg-card/60 px-2.5 py-1.5">
            <span className={cn('size-2 shrink-0 rounded-full', p.connected ? 'bg-emerald' : 'bg-muted-foreground/40')} title={p.connected ? 'Connected' : 'Disconnected'} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{p.name}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{nameOf(p.characterPath) ?? 'No character yet'}</span>
            </span>
            <Tip label="Remove from the table">
              <Button variant="ghost" size="icon-sm" aria-label={`Remove ${p.name}`} onClick={() => void run(() => invoke('table:kick', p.id), 'Could not remove')}>
                <UserX />
              </Button>
            </Tip>
          </div>
        ))}
      </section>
    </div>
  )
}
