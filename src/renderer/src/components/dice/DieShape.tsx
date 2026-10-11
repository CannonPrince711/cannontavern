import { cn } from '@/lib/utils'

/** Flat silhouettes for each die type (also used for the tray buttons). */
const PATHS: Record<number, string> = {
  4: 'M50 6 94 88H6Z',
  6: 'M14 14h72v72H14Z',
  8: 'M50 4 92 50 50 96 8 50Z',
  10: 'M50 4 92 40 50 96 8 40Z',
  12: 'M50 4 90 32 78 84H22L10 32Z',
  20: 'M50 4 90 27v46L50 96 10 73V27Z',
  100: 'M50 4 92 40 50 96 8 40Z'
}

export function DieShape({
  sides,
  value,
  className,
  tone = 'default',
  label
}: {
  sides: number
  value?: number | string
  className?: string
  tone?: 'default' | 'crit' | 'fumble' | 'dropped'
  label?: string
}): React.JSX.Element {
  const path = PATHS[sides] ?? PATHS[6]!
  const fill = tone === 'crit' ? 'var(--gold)' : tone === 'fumble' ? 'var(--crimson)' : 'var(--surface-2)'
  const text = tone === 'crit' || tone === 'fumble' ? 'var(--primary-foreground)' : 'var(--foreground)'
  return (
    <svg viewBox="0 0 100 100" className={cn('size-10', tone === 'dropped' && 'opacity-35', className)} role="img" aria-label={label ?? `d${sides}${value !== undefined ? ` showing ${value}` : ''}`}>
      <path d={path} fill={fill} stroke={tone === 'default' || tone === 'dropped' ? 'var(--gold)' : 'none'} strokeWidth="3" strokeLinejoin="round" />
      {sides === 20 && <path d="M50 26 28 64h44Z" fill="none" stroke={tone === 'default' ? 'color-mix(in srgb, var(--gold) 45%, transparent)' : 'rgb(0 0 0 / 0.2)'} strokeWidth="2" />}
      {value !== undefined && (
        <text x="50" y={sides === 4 ? 70 : 57} textAnchor="middle" dominantBaseline="middle" fontFamily="var(--font-display)" fontWeight="700" fontSize={String(value).length > 2 ? 26 : 32} fill={text}>
          {value}
        </text>
      )}
    </svg>
  )
}
