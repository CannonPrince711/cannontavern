import { useEffect, useRef, useState } from 'react'
import { Tip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/** A short two-note chime (no audio files needed). */
export function chime(): void {
  try {
    const ctx = new AudioContext()
    ;[0, 0.18].forEach((at, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = i ? 660 : 880
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at)
      gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.16)
      osc.connect(gain).connect(ctx.destination)
      osc.start(ctx.currentTime + at)
      osc.stop(ctx.currentTime + at + 0.18)
    })
    setTimeout(() => void ctx.close(), 600)
  } catch {
    /* audio unavailable */
  }
}

/**
 * Counts down from `seconds` whenever `resetKey` changes (null = idle).
 * `onExpire` fires once when it reaches zero. Clicking pauses and resumes.
 */
export function useCountdown(resetKey: string | null, seconds: number, onExpire: () => void): { remaining: number; paused: boolean; toggle: () => void } {
  const [endAt, setEndAt] = useState<number | null>(null)
  const [pausedLeft, setPausedLeft] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const fired = useRef(false)
  const expire = useRef(onExpire)
  expire.current = onExpire

  useEffect(() => {
    fired.current = false
    setPausedLeft(null)
    setEndAt(resetKey ? Date.now() + seconds * 1000 : null)
    setNow(Date.now())
  }, [resetKey, seconds])

  useEffect(() => {
    if (endAt === null || pausedLeft !== null) return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [endAt, pausedLeft])

  const remaining = pausedLeft ?? (endAt === null ? seconds * 1000 : Math.max(0, endAt - now))
  useEffect(() => {
    if (endAt !== null && pausedLeft === null && remaining <= 0 && !fired.current) {
      fired.current = true
      expire.current()
    }
  }, [remaining, endAt, pausedLeft])

  const toggle = (): void => {
    if (endAt === null) return
    if (pausedLeft !== null) {
      setEndAt(Date.now() + pausedLeft)
      setPausedLeft(null)
    } else setPausedLeft(Math.max(0, endAt - Date.now()))
  }
  return { remaining: Math.ceil(remaining / 1000), paused: pausedLeft !== null, toggle }
}

/** Fits the ring: seconds up to 99, then whole minutes. */
function format(s: number): string {
  return s >= 100 ? `${Math.ceil(s / 60)}m` : String(s)
}

/** Ring countdown; amber under 10 s, red under 5 s. Click to pause. */
export function TurnTimerRing({ remaining, total, paused, onToggle, label, size = 34 }: { remaining: number; total: number; paused: boolean; onToggle: () => void; label: string; size?: number }): React.JSX.Element {
  const r = size / 2 - 3
  const c = 2 * Math.PI * r
  const ratio = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0
  const tone = remaining <= 5 ? 'text-crimson' : remaining <= 10 ? 'text-amber-400' : 'text-gold'
  return (
    <Tip label={`${label}: ${paused ? 'paused, click to resume' : 'click to pause'}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-label={`${label}: ${remaining} seconds left${paused ? ', paused' : ''}`}
        className={cn('relative grid shrink-0 place-items-center rounded-full', tone, remaining === 0 && 'animate-pulse', paused && 'opacity-60')}
        style={{ width: size, height: size }}
      >
        <svg width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth={3} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - ratio)}
            style={{ transition: 'stroke-dashoffset 250ms linear' }}
          />
        </svg>
        <span className="text-[10px] font-semibold tabular-nums">{paused ? '❚❚' : format(remaining)}</span>
      </button>
    </Tip>
  )
}
