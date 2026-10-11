import { cn } from '@/lib/utils'

/** The d20 mark. Same geometry as build/icon.svg. */
export function Logo({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden className={cn('size-5', className)}>
      <g stroke="currentColor" strokeWidth="3.2" strokeLinejoin="round" strokeLinecap="round">
        <path d="M32 6 54.5 19v26L32 58 9.5 45V19Z" />
        <path d="M32 17 17.5 40h29Z" />
        <path d="M32 6v11M9.5 19 32 17l22.5 2M9.5 19l8 21M54.5 19l-8 21M9.5 45l8-5M54.5 45l-8-5M17.5 40 32 58l14.5-18" />
      </g>
    </svg>
  )
}
