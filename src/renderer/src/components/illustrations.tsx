/**
 * Line illustrations for empty states. They use currentColor for strokes and
 * the gold token for highlights, so they follow the active theme.
 */

const stroke = {
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  fill: 'none'
}

export function LanternArt(): React.JSX.Element {
  return (
    <svg viewBox="0 0 120 140" aria-hidden className="w-full">
      <defs>
        <radialGradient id="lantern-glow" cx="50%" cy="58%" r="50%">
          <stop offset="0%" stopColor="var(--gold)" stopOpacity="0.45" />
          <stop offset="100%" stopColor="var(--gold)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="60" cy="80" r="56" fill="url(#lantern-glow)" />
      <g {...stroke}>
        <path d="M60 6v10" />
        <circle cx="60" cy="22" r="6" />
        <path d="M40 40h40l-6-12H46Z" />
        <path d="M42 40v58M78 40v58" />
        <path d="M36 98h48l-4 10H40Z" />
        <path d="M52 40v58M68 40v58" opacity=".45" />
      </g>
      <path
        d="M60 58c7 9 9 15 9 21a9 9 0 0 1-18 0c0-6 3-12 9-21Z"
        fill="var(--gold)"
        opacity=".9"
      />
      <path d="M60 70c3 4 4 7 4 10a4 4 0 0 1-8 0c0-3 1-6 4-10Z" fill="var(--background)" opacity=".55" />
    </svg>
  )
}

export function HoodArt(): React.JSX.Element {
  return (
    <svg viewBox="0 0 80 80" aria-hidden className="w-full">
      <g {...stroke}>
        <path d="M14 74c0-18 8-28 14-32-4-6-5-14-1-22 4-8 9-12 13-14 4 2 9 6 13 14 4 8 3 16-1 22 6 4 14 14 14 32" />
        <path d="M30 40c2 6 6 9 10 9s8-3 10-9" opacity=".5" />
      </g>
      <circle cx="35" cy="34" r="1.8" fill="var(--gold)" />
      <circle cx="45" cy="34" r="1.8" fill="var(--gold)" />
    </svg>
  )
}

export function ScrollArt(): React.JSX.Element {
  return (
    <svg viewBox="0 0 80 80" aria-hidden className="w-full">
      <g {...stroke}>
        <path d="M20 14h40a6 6 0 0 1 0 12H20a6 6 0 0 1 0-12Z" />
        <path d="M22 26v34a6 6 0 0 0 6 6h34a6 6 0 0 0 0-12H28" />
        <path d="M32 36h22M32 44h16" opacity=".5" />
      </g>
      <circle cx="58" cy="60" r="3" fill="var(--gold)" />
    </svg>
  )
}

export function SwordsArt(): React.JSX.Element {
  return (
    <svg viewBox="0 0 80 80" aria-hidden className="w-full">
      <g {...stroke}>
        <path d="M16 12l34 34M12 16l34 34" />
        <path d="M44 52l8-8M48 56l8-8" />
        <path d="M54 58l10 10" />
        <path d="M64 12L30 46M68 16L34 50" />
        <path d="M36 52l-8-8M32 56l-8-8" />
        <path d="M26 58L16 68" />
      </g>
      <circle cx="65" cy="69" r="3" fill="var(--gold)" />
      <circle cx="15" cy="69" r="3" fill="var(--gold)" />
    </svg>
  )
}

export function BookArt(): React.JSX.Element {
  return (
    <svg viewBox="0 0 80 80" aria-hidden className="w-full">
      <g {...stroke}>
        <path d="M40 20c-8-6-18-6-26-4v46c8-2 18-2 26 4 8-6 18-6 26-4V16c-8-2-18-2-26 4Z" />
        <path d="M40 20v46" />
        <path d="M22 28h10M22 36h10M48 28h10M48 36h10" opacity=".5" />
      </g>
      <path d="M52 14v14l3-2 3 2V14" fill="var(--gold)" />
    </svg>
  )
}

export function FrameArt(): React.JSX.Element {
  return (
    <svg viewBox="0 0 80 80" aria-hidden className="w-full">
      <g {...stroke}>
        <rect x="12" y="16" width="56" height="48" rx="4" />
        <path d="M12 54l16-16 12 12 8-8 20 18" />
      </g>
      <circle cx="54" cy="30" r="5" fill="var(--gold)" />
    </svg>
  )
}

export function RuneArt(): React.JSX.Element {
  return (
    <svg viewBox="0 0 80 80" aria-hidden className="w-full">
      <g {...stroke}>
        <path d="M40 8l28 16v32L40 72 12 56V24Z" />
        <path d="M40 22v36M30 30l10 8 10-8M30 50l10-6 10 6" opacity=".6" />
      </g>
      <circle cx="40" cy="38" r="3" fill="var(--gold)" />
    </svg>
  )
}
