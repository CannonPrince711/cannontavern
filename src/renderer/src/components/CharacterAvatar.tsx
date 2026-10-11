import { useState } from 'react'
import { cn } from '@/lib/utils'
import { vaultUrl } from '@/stores/vault'

interface Props {
  name: string
  avatar?: string
  /** Bumps the image URL so an edited avatar refreshes. */
  version?: number
  hp?: number
  maxHp?: number
  size?: number
  className?: string
}

export function hpColor(ratio: number): string {
  if (ratio > 0.5) return 'var(--emerald)'
  if (ratio > 0.25) return 'var(--gold)'
  return 'var(--crimson)'
}

/** Round portrait with an optional HP ring. Falls back to initials. */
export function CharacterAvatar({ name, avatar, version, hp, maxHp, size = 36, className }: Props): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  const showRing = typeof hp === 'number' && typeof maxHp === 'number' && maxHp > 0
  const ratio = showRing ? Math.max(0, Math.min(1, hp! / maxHp!)) : 0
  const stroke = 2.5
  const r = size / 2 - stroke / 2
  const c = 2 * Math.PI * r
  const inner = showRing ? size - stroke * 2 - 2 : size
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')

  return (
    <span className={cn('relative inline-grid shrink-0 place-items-center', className)} style={{ width: size, height: size }}>
      {showRing && (
        <svg width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={hpColor(ratio)}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - ratio)}
            className="transition-[stroke-dashoffset] duration-500"
          />
        </svg>
      )}
      {avatar && !failed ? (
        <img
          src={vaultUrl(avatar, version)}
          alt=""
          onError={() => setFailed(true)}
          className="rounded-full object-cover"
          style={{ width: inner, height: inner }}
          draggable={false}
        />
      ) : (
        <span
          className="grid place-items-center rounded-full bg-surface-2 font-display text-gold"
          style={{ width: inner, height: inner, fontSize: inner * 0.38 }}
          aria-hidden
        >
          {initials || '?'}
        </span>
      )}
      {showRing && <span className="sr-only">{`HP ${hp} of ${maxHp}`}</span>}
    </span>
  )
}
