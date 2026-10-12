/**
 * The player page: served by the host's game server and opened in any
 * browser. Players join with the code, claim a character, read the story as
 * it's written, act, and roll their checks. "?view=screen" is the read-only
 * table display (second monitor or TV).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Dices, Heart, Loader2, LogOut, SendHorizontal, Shield, Users, Wifi, WifiOff } from 'lucide-react'
import { CHECK_RE } from '@shared/play'
import type { ClientMessage, ServerMessage, TableCharacter, TableMessage, TablePlayer, TableState } from '@shared/table'

type Phase = 'join' | 'connecting' | 'open' | 'closed' | 'kicked'

const params = new URLSearchParams(location.search)
const VIEW: 'player' | 'screen' = params.get('view') === 'screen' ? 'screen' : 'player'
const WS_URL = params.get('ws') || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`

function storage(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? localStorage : sessionStorage
  } catch {
    return null
  }
}

function hpColor(ratio: number): string {
  return ratio > 0.6 ? '#34c38f' : ratio > 0.3 ? '#d4a843' : '#e5484d'
}

function signed(n: number): string {
  return n >= 0 ? `+${n}` : String(n)
}

// ── Connection ──────────────────────────────────────────────────────────────

function useTable(code: string, name: string | null) {
  const [phase, setPhase] = useState<Phase>(name ? 'connecting' : 'join')
  const [state, setState] = useState<TableState | null>(null)
  const [you, setYou] = useState<TablePlayer | null>(null)
  const [stream, setStream] = useState<{ text: string; speaker: 'dm' | 'player'; speakerName?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ws = useRef<WebSocket | null>(null)
  const retry = useRef(0)
  const kicked = useRef(false)

  useEffect(() => {
    if (!name || !code) return
    let closed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tokenKey = `dnd-tavern-token:${code.toUpperCase()}`
    const connect = (): void => {
      setPhase((p) => (p === 'open' ? 'closed' : 'connecting'))
      const socket = new WebSocket(WS_URL)
      ws.current = socket
      socket.onopen = () => {
        retry.current = 0
        const token = storage('local')?.getItem(tokenKey) ?? undefined
        socket.send(JSON.stringify({ type: 'hello', code, name, token, view: VIEW } satisfies ClientMessage))
      }
      socket.onmessage = (ev) => {
        const msg = JSON.parse(String(ev.data)) as ServerMessage
        switch (msg.type) {
          case 'welcome':
            storage('local')?.setItem(tokenKey, msg.token)
            setYou(msg.you)
            setState(msg.state)
            setPhase('open')
            setError(null)
            break
          case 'state':
            setState(msg.state)
            setYou((y) => (y ? { ...y, characterPath: msg.state.players.find((p) => p.id === y.id)?.characterPath } : y))
            break
          case 'stream':
            setStream({ text: msg.text, speaker: msg.speaker, speakerName: msg.speakerName })
            break
          case 'stream-end':
            setStream(null)
            break
          case 'error':
            setError(msg.message)
            setTimeout(() => setError((e) => (e === msg.message ? null : e)), 5000)
            break
          case 'kicked':
            kicked.current = true
            storage('local')?.removeItem(tokenKey)
            setError(msg.reason)
            setPhase('kicked')
            break
        }
      }
      socket.onclose = () => {
        if (closed || kicked.current) return
        setPhase('closed')
        // Reconnect with backoff; the token keeps your seat and character.
        const delay = Math.min(10_000, 1000 * 2 ** retry.current++)
        timer = setTimeout(connect, delay)
      }
    }
    connect()
    return () => {
      closed = true
      clearTimeout(timer)
      ws.current?.close()
    }
  }, [code, name])

  const send = useCallback((msg: ClientMessage) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(msg))
  }, [])

  return { phase, state, you, stream, error, send }
}

// ── Story ───────────────────────────────────────────────────────────────────

/** Markdown for story text; wikilinks become plain text and [CHECK …] becomes a roll button. */
function StoryText({ text, onCheck }: { text: string; onCheck?: (target: string, dc: number) => void }): React.JSX.Element {
  const parts = useMemo(() => {
    const plain = text.replace(/!\[\[[^\]]*\]\]/g, '').replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a: string, b?: string) => b ?? a.split('/').pop()!)
    const out: ({ kind: 'md'; text: string } | { kind: 'check'; target: string; dc: number })[] = []
    let last = 0
    for (const m of plain.matchAll(new RegExp(CHECK_RE.source, 'gi'))) {
      out.push({ kind: 'md', text: plain.slice(last, m.index) })
      out.push({ kind: 'check', target: m[1]!.trim(), dc: Number(m[2]) })
      last = m.index! + m[0].length
    }
    out.push({ kind: 'md', text: plain.slice(last) })
    return out
  }, [text])
  return (
    <div className="chat-prose">
      {parts.map((p, i) =>
        p.kind === 'md' ? (
          p.text.trim() && (
            <ReactMarkdown key={i} remarkPlugins={[remarkGfm]} components={{ img: () => null, a: ({ children }) => <span>{children}</span> }}>
              {p.text}
            </ReactMarkdown>
          )
        ) : (
          <button
            key={i}
            type="button"
            disabled={!onCheck}
            onClick={() => onCheck?.(p.target, p.dc)}
            className="mx-1 inline-flex items-center gap-1 rounded-full border border-gold/50 bg-gold/10 px-2 py-0.5 align-baseline font-sans text-[0.75em] font-semibold tracking-wide text-gold uppercase enabled:hover:bg-gold/20"
          >
            <Dices className="size-3.5" /> {p.target} DC {p.dc}
            {onCheck ? ' · Roll it' : ''}
          </button>
        )
      )}
    </div>
  )
}

function Message({ m, big, onCheck }: { m: TableMessage; big: boolean; onCheck?: (target: string, dc: number) => void }): React.JSX.Element | null {
  if (m.role === 'dm') {
    return (
      <article className="paper rounded-xl rounded-tl-sm border bg-page px-5 py-4 shadow-card">
        <div className={big ? 'font-chat text-[1.45rem] leading-relaxed text-parchment' : 'font-chat text-parchment'}>
          <StoryText text={m.text} onCheck={onCheck} />
        </div>
      </article>
    )
  }
  if (m.role === 'player') {
    return (
      <article className="ml-auto flex max-w-[85%] flex-col items-end">
        {m.name && <span className="mr-1 mb-1 text-[11px] font-medium text-muted-foreground">{m.name}</span>}
        <div className={`rounded-2xl rounded-br-md border border-primary/30 bg-primary/12 px-4 py-2.5 ${big ? 'text-xl' : ''}`}>
          <div className="font-chat whitespace-pre-wrap">{m.text}</div>
        </div>
      </article>
    )
  }
  if (m.role === 'roll') {
    const r = m.roll
    return (
      <div className="mx-auto flex max-w-full items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-sm shadow-sm">
        {m.name && <span className="font-semibold text-gold">{m.name}</span>}
        {r ? (
          <>
            <span className="font-mono text-xs text-muted-foreground">{r.expression.split(' ')[0]}</span>
            <span className="font-display text-base font-bold">{r.total}</span>
            {r.dc !== undefined && <span className={`rounded px-1.5 text-xs ${r.success ? 'bg-emerald/15 text-emerald' : 'bg-crimson/15 text-crimson'}`}>DC {r.dc} {r.success ? '✓' : '✗'}</span>}
            {r.crit && <span className="text-xs text-gold">natural 20!</span>}
          </>
        ) : (
          <span className="text-xs">{m.text.replace(/\*\*/g, '')}</span>
        )}
      </div>
    )
  }
  if (m.role === 'image') {
    return m.imageUrl ? (
      <figure className="mx-auto max-w-2xl">
        <img src={m.imageUrl} alt={m.name ?? ''} className="w-full rounded-xl border shadow-card" loading="lazy" />
        {m.name && <figcaption className="mt-1 text-center text-xs text-muted-foreground italic">{m.name}</figcaption>}
      </figure>
    ) : null
  }
  return <p className="mx-auto max-w-2xl px-6 text-center text-xs text-muted-foreground italic">{m.name ? `${m.name}: ` : ''}{m.text.replace(/\*\*/g, '')}</p>
}

function Story({ state, stream, big, onCheck }: { state: TableState; stream: { text: string; speaker: 'dm' | 'player'; speakerName?: string } | null; big: boolean; onCheck?: (target: string, dc: number) => void }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  useLayoutEffect(() => {
    const el = ref.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [state.messages.length, stream?.text])
  const lastDmId = [...state.messages].reverse().find((m) => m.role === 'dm')?.id
  return (
    <div
      ref={ref}
      onScroll={() => {
        const el = ref.current
        if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
      }}
      className="min-h-0 flex-1 overflow-y-auto px-4 py-5 select-text"
    >
      <div className={`mx-auto flex flex-col gap-4 ${big ? 'max-w-5xl' : 'max-w-3xl'}`}>
        {state.messages.length === 0 && !stream && <p className="py-16 text-center font-serif text-lg text-muted-foreground italic">The story hasn’t started yet.</p>}
        {state.messages.map((m) => (
          <Message key={m.id} m={m} big={big} onCheck={m.id === lastDmId ? onCheck : undefined} />
        ))}
        {stream && stream.text.trim() && (
          <Message m={{ id: 'stream', role: stream.speaker, name: stream.speakerName, text: stream.text, createdAt: '' }} big={big} />
        )}
        {state.busy && (!stream || !stream.text.trim()) && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" /> The DM is writing…
          </p>
        )}
      </div>
    </div>
  )
}

// ── Characters ──────────────────────────────────────────────────────────────

function HpBar({ c }: { c: TableCharacter }): React.JSX.Element {
  const ratio = c.max_hp ? c.hp / c.max_hp : 0
  return (
    <div className="h-2 overflow-hidden rounded-full bg-muted" role="meter" aria-label={`${c.name} hit points`} aria-valuenow={c.hp} aria-valuemax={c.max_hp}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(0, Math.min(100, ratio * 100))}%`, background: hpColor(ratio) }} />
    </div>
  )
}

function Avatar({ c, size = 40 }: { c: { name: string; avatarUrl?: string }; size?: number }): React.JSX.Element {
  const initials = c.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
  return c.avatarUrl ? (
    <img src={c.avatarUrl} alt="" className="shrink-0 rounded-full border object-cover" style={{ width: size, height: size }} />
  ) : (
    <span className="grid shrink-0 place-items-center rounded-full border border-gold/40 bg-surface-2 font-display text-gold" style={{ width: size, height: size, fontSize: size * 0.36 }}>
      {initials}
    </span>
  )
}

/** "Create my character": the host's AI writes it, the host approves it, then it's yours. */
function CreateCharacter({ state, you, send }: { state: TableState; you: TablePlayer; send: (m: ClientMessage) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ concept: '', level: 1, race: '', cls: '' })
  const mine = state.requests.filter((r) => r.playerId === you.id).at(-1)
  const waiting = mine && (mine.status === 'writing' || mine.status === 'ready')
  const field = 'w-full rounded-lg border bg-card px-3 py-2 text-sm outline-none focus:border-primary'

  if (waiting) {
    return (
      <div className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2.5 text-sm">
        {mine.status === 'writing' ? (
          <span className="flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" /> Writing your character… (about a minute)
          </span>
        ) : (
          <span>
            <span className="font-medium">{mine.name}</span>
            {mine.summary ? ` (${mine.summary})` : ''} is ready. Waiting for the host to approve…
          </span>
        )}
      </div>
    )
  }
  return (
    <div className="space-y-2 pt-1">
      {mine?.status === 'declined' && <p className="text-xs text-muted-foreground">The host declined {mine.name ?? 'your last character'}. You can try another idea.</p>}
      {mine?.status === 'failed' && <p className="text-xs text-[#e5484d]">That didn’t work: {mine.error}</p>}
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="w-full rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground hover:border-primary hover:text-foreground">
          + Create my character
        </button>
      ) : (
        <form
          className="space-y-2 rounded-lg border bg-card/60 p-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (!form.concept.trim()) return
            send({ type: 'create', concept: form.concept.trim(), level: form.level, ...(form.race.trim() ? { race: form.race.trim() } : {}), ...(form.cls.trim() ? { cls: form.cls.trim() } : {}) })
            setOpen(false)
          }}
        >
          <label className="block space-y-1 text-xs">
            <span className="font-medium">Who are they?</span>
            <textarea
              rows={3}
              maxLength={1000}
              value={form.concept}
              onChange={(e) => setForm({ ...form, concept: e.target.value })}
              placeholder="A grumpy dwarf cannoneer who lost a bet and now owes the Academy ten years of service"
              className={field}
              autoFocus
            />
          </label>
          <div className="grid grid-cols-[4.5rem_1fr_1fr] gap-2 text-xs">
            <label className="space-y-1">
              <span className="font-medium">Level</span>
              <input type="number" min={1} max={20} value={form.level} onChange={(e) => setForm({ ...form, level: Math.min(20, Math.max(1, Number(e.target.value) || 1)) })} className={field} />
            </label>
            <label className="space-y-1">
              <span className="font-medium">Race (optional)</span>
              <input value={form.race} maxLength={60} onChange={(e) => setForm({ ...form, race: e.target.value })} placeholder="Any" className={field} />
            </label>
            <label className="space-y-1">
              <span className="font-medium">Class (optional)</span>
              <input value={form.cls} maxLength={100} onChange={(e) => setForm({ ...form, cls: e.target.value })} placeholder="Any" className={field} />
            </label>
          </div>
          <p className="text-[11px] text-muted-foreground">The host’s AI writes the whole character and sheet for this campaign, then the host approves it.</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
              Cancel
            </button>
            <button type="submit" disabled={!form.concept.trim()} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
              Create
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

function MyCharacter({ state, you, send }: { state: TableState; you: TablePlayer; send: (m: ClientMessage) => void }): React.JSX.Element {
  const mine = state.party.find((c) => c.path === you.characterPath)
  const [expr, setExpr] = useState('1d20')
  const [filter, setFilter] = useState('')
  if (!mine) {
    return (
      <section className="space-y-2">
        <h2 className="font-display text-sm font-semibold tracking-wide">Choose your character</h2>
        {state.available.length === 0 && <p className="text-xs text-muted-foreground">No characters left to claim. Make your own below, or ask the host to add one.</p>}
        {state.available.map((c) => (
          <button key={c.path} type="button" onClick={() => send({ type: 'claim', characterPath: c.path })} className="flex w-full items-center gap-2.5 rounded-lg border bg-card px-3 py-2 text-left hover:border-primary hover:bg-accent">
            <Avatar c={{ name: c.name }} size={32} />
            <span className="text-sm font-medium">Play as {c.name}</span>
          </button>
        ))}
        <CreateCharacter state={state} you={you} send={send} />
      </section>
    )
  }
  const checks = mine.checks.filter((c) => !filter || c.label.toLowerCase().includes(filter.toLowerCase()))
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <Avatar c={mine} size={48} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-base font-semibold tracking-wide">{mine.name}</h2>
          <p className="truncate text-xs text-muted-foreground">
            {[mine.race, mine.class, mine.level ? `level ${mine.level}` : ''].filter(Boolean).join(' · ')} · {mine.edition}
          </p>
        </div>
        <button type="button" onClick={() => send({ type: 'claim', characterPath: null })} className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
          Change
        </button>
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="flex items-center gap-1 text-muted-foreground">
            <Heart className="size-3.5 text-crimson" /> HP
          </span>
          <span className="font-display font-semibold tabular-nums">
            {mine.hp}/{mine.max_hp}
            {mine.temp_hp > 0 && <span className="text-gold"> +{mine.temp_hp}</span>}
          </span>
        </div>
        <HpBar c={mine} />
        <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Shield className="size-3.5" /> AC <b className="text-foreground">{mine.ac}</b>
          </span>
          {mine.conditions.map((c) => (
            <span key={c} className="rounded-full border border-crimson/40 bg-crimson/10 px-2 py-0.5 text-crimson capitalize">
              {c}
            </span>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1 flex items-center gap-2">
          <h3 className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">Checks</h3>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter" aria-label="Filter checks" className="ml-auto h-6 w-24 rounded border bg-background px-1.5 text-xs" />
        </div>
        <div className="grid max-h-56 grid-cols-2 gap-1 overflow-y-auto">
          {checks.map((c) => (
            <button key={c.target} type="button" onClick={() => send({ type: 'check', target: c.target })} className="flex items-center justify-between rounded border bg-card px-2 py-1 text-left text-xs hover:border-primary">
              <span className="truncate">{c.label}</span>
              <span className="ml-1 font-mono tabular-nums text-muted-foreground">{signed(c.bonus)}</span>
            </button>
          ))}
        </div>
      </div>
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          if (expr.trim()) send({ type: 'roll', expr: expr.trim() })
        }}
      >
        <input value={expr} onChange={(e) => setExpr(e.target.value)} aria-label="Dice to roll" className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 font-mono text-sm" />
        <button type="submit" className="flex items-center gap-1 rounded-md border bg-secondary px-3 text-sm hover:bg-accent">
          <Dices className="size-4" /> Roll
        </button>
      </form>
    </section>
  )
}

function Party({ state, compact }: { state: TableState; compact?: boolean }): React.JSX.Element {
  const playerName = (id?: string): string | undefined => state.players.find((p) => p.id === id)?.name
  return (
    <section className={compact ? 'flex flex-wrap gap-3' : 'space-y-2'}>
      {!compact && <h3 className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">Party</h3>}
      {state.party.map((c) => (
        <div key={c.path} className={compact ? 'flex w-56 items-center gap-2.5 rounded-lg border bg-card/80 px-3 py-2' : 'flex items-center gap-2.5 rounded-lg border bg-card/60 px-2.5 py-2'}>
          <Avatar c={c} size={compact ? 40 : 32} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm font-medium">{c.name}</span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {c.hp}/{c.max_hp}
              </span>
            </div>
            <HpBar c={c} />
            {!compact && <span className="text-[11px] text-muted-foreground">{playerName(c.claimedBy) ?? (c.claimedBy ? '' : 'Unclaimed')}</span>}
          </div>
        </div>
      ))}
      {state.party.length === 0 && <p className="text-xs text-muted-foreground">No characters in this session yet.</p>}
    </section>
  )
}

// ── App ─────────────────────────────────────────────────────────────────────

function Join({ code, onJoin }: { code: string; onJoin: (name: string, code: string) => void }): React.JSX.Element {
  const [name, setName] = useState(storage('local')?.getItem('dnd-tavern-player-name') ?? '')
  const [c, setC] = useState(code)
  return (
    <div className="grid min-h-full place-items-center p-6">
      <form
        className="w-full max-w-sm space-y-4 rounded-xl border bg-card p-6 shadow-card"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim() && c.trim()) onJoin(name.trim(), c.trim())
        }}
      >
        <h1 className="text-center font-display text-xl font-semibold tracking-wide">Join the table</h1>
        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">Your name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={40} className="h-10 w-full rounded-md border bg-background px-3" placeholder="e.g. Sam" />
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">Code</span>
          <input value={c} onChange={(e) => setC(e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 font-mono tracking-widest uppercase" placeholder="ABCD-2345" />
        </label>
        <button type="submit" disabled={!name.trim() || !c.trim()} className="h-10 w-full rounded-md bg-primary font-medium text-primary-foreground disabled:opacity-50">
          Join
        </button>
      </form>
    </div>
  )
}

export function PlayerApp(): React.JSX.Element {
  const [code, setCode] = useState(params.get('code') ?? '')
  const [name, setName] = useState<string | null>(() => (VIEW === 'screen' ? 'Player screen' : null))
  const { phase, state, you, stream, error, send } = useTable(code, name)
  const [text, setText] = useState('')
  const [tab, setTab] = useState<'story' | 'me' | 'party'>('story')

  useEffect(() => {
    document.title = state?.campaignName ? `${state.campaignName} · DND Tavern` : 'DND Tavern · Player'
  }, [state?.campaignName])

  if (!name) {
    return (
      <Join
        code={code}
        onJoin={(n, c) => {
          storage('local')?.setItem('dnd-tavern-player-name', n)
          setCode(c)
          setName(n)
        }}
      />
    )
  }
  if (phase === 'kicked') {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div className="space-y-2">
          <LogOut className="mx-auto size-8 text-muted-foreground" />
          <p className="font-display text-lg">You left the table</p>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    )
  }
  if (!state || !you) {
    return (
      <div className="grid h-full place-items-center p-6 text-center text-muted-foreground" role="status">
        <div className="space-y-2">
          <Loader2 className="mx-auto size-6 animate-spin" />
          <p>{error ?? 'Connecting to the table…'}</p>
        </div>
      </div>
    )
  }

  const mine = state.party.find((c) => c.path === you.characterPath)
  const canAct = VIEW === 'player' && !!mine && state.mode !== 'ai-only' && phase === 'open'
  const onCheck = mine && VIEW === 'player' ? (target: string, dc: number) => send({ type: 'check', target, dc }) : undefined
  const submit = (): void => {
    if (!text.trim() || !canAct) return
    send({ type: 'say', text: text.trim() })
    setText('')
  }

  const header = (
    <header className="flex shrink-0 items-center gap-3 border-b bg-titlebar px-4 py-2.5">
      <span className="font-display text-sm font-semibold tracking-[0.12em] text-gold">DND TAVERN</span>
      <span className="min-w-0 truncate text-xs text-muted-foreground">
        {[state.campaignName, state.sessionTitle].filter(Boolean).join(' · ') || 'Waiting for the host'}
      </span>
      <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground" title={phase === 'open' ? 'Connected' : 'Reconnecting'}>
        {phase === 'open' ? <Wifi className="size-3.5 text-emerald" /> : <WifiOff className="size-3.5 text-crimson" />}
        {VIEW === 'player' ? you.name : `${state.players.filter((p) => p.connected).length} players`}
      </span>
    </header>
  )

  if (VIEW === 'screen') {
    return (
      <div className="flex h-full flex-col bg-background">
        {header}
        <Story state={state} stream={stream} big />
        {state.party.length > 0 && (
          <div className="shrink-0 border-t bg-card/40 px-4 py-3">
            <Party state={state} compact />
          </div>
        )}
      </div>
    )
  }

  const composer = (
    <div className="shrink-0 border-t p-3">
      {error && <p className="mx-auto mb-2 max-w-3xl rounded-md border border-crimson/40 bg-crimson/10 px-3 py-1.5 text-xs text-crimson">{error}</p>}
      <form
        className="mx-auto flex max-w-3xl items-end gap-2 rounded-xl border bg-card p-2 shadow-card"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <textarea
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          disabled={!canAct}
          placeholder={state.mode === 'ai-only' ? 'This table is AI only: you’re watching' : mine ? `What does ${mine.name} do?` : 'Choose a character to play'}
          aria-label="Your action"
          className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 font-chat placeholder:text-muted-foreground focus-visible:outline-none disabled:opacity-60"
        />
        <button type="submit" disabled={!canAct || !text.trim()} aria-label="Send" className="grid size-9 place-items-center rounded-md bg-primary text-primary-foreground disabled:opacity-40">
          <SendHorizontal className="size-4" />
        </button>
      </form>
    </div>
  )

  return (
    <div className="flex h-full flex-col bg-background">
      {header}
      <div className="flex min-h-0 flex-1">
        <main className={`min-w-0 flex-1 flex-col md:flex ${tab === 'story' ? 'flex' : 'hidden'}`}>
          <Story state={state} stream={stream} big={false} onCheck={onCheck} />
          {composer}
        </main>
        <aside className={`w-full shrink-0 space-y-5 overflow-y-auto border-l p-4 md:block md:w-80 ${tab === 'story' ? 'hidden' : 'block'}`}>
          <div className={tab === 'party' ? 'hidden md:block' : ''}>
            <MyCharacter state={state} you={you} send={send} />
          </div>
          <div className={tab === 'me' ? 'hidden md:block' : ''}>
            <Party state={state} />
          </div>
        </aside>
      </div>
      {/* Phone tabs */}
      <nav className="grid shrink-0 grid-cols-3 border-t md:hidden" aria-label="Sections">
        {(
          [
            ['story', 'Story', SendHorizontal],
            ['me', mine?.name ?? 'Character', Shield],
            ['party', 'Party', Users]
          ] as const
        ).map(([id, label, Icon]) => (
          <button key={id} type="button" onClick={() => setTab(id)} aria-pressed={tab === id} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${tab === id ? 'text-gold' : 'text-muted-foreground'}`}>
            <Icon className="size-4" />
            <span className="max-w-24 truncate">{label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
