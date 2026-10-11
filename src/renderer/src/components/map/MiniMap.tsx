import { useMemo, useState } from 'react'
import { Minus, Plus, Skull, Star, StickyNote, X } from 'lucide-react'
import { niceScaleBar, type MapPin } from '@shared/map'
import { useApp } from '@/stores/app'
import { useMap } from './MapView'

const SIZE = 256
const GRID = 32
const COLORS = {
  bg: '#16151a',
  grid: 'rgba(255,255,255,0.045)',
  ring: '#8d877b',
  ringFill: '#1d1c22',
  label: '#c6a465',
  here: '#ebe5da',
  hereDot: '#9cc48a'
}

function truncate(s: string, n = 17): string {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s
}

function KindIcon({ pin, x, y }: { pin: MapPin; x: number; y: number }): React.JSX.Element | null {
  const Icon = pin.kind === 'danger' ? Skull : pin.kind === 'poi' ? Star : pin.kind === 'note' ? StickyNote : null
  return Icon ? <Icon x={x - 5} y={y - 5} width={10} height={10} color={pin.kind === 'danger' ? '#e5484d' : COLORS.label} strokeWidth={2.2} /> : null
}

/**
 * Game-style mini-map: the campaign's pins on a dark grid, centred on the
 * party ("HERE"), with a compass and (when the map's width is set) a scale
 * bar. Click to open the full map.
 */
export function MiniMap(): React.JSX.Element | null {
  const map = useMap((s) => s.map)
  const show = useApp((s) => s.settings?.behavior.miniMap ?? true)
  const [zoom, setZoom] = useState(1)

  const view = useMemo(() => {
    if (!map) return null
    const placed = map.pins.filter((p) => p.x !== null && p.y !== null)
    if (!placed.length && !map.party) return null
    const a = map.aspect
    // World units: 1 = the map's height; x is stretched by the aspect ratio.
    const cx = map.party ? map.party.x * a : placed.reduce((s, p) => s + p.x! * a, 0) / placed.length
    const cy = map.party ? map.party.y : placed.reduce((s, p) => s + p.y!, 0) / placed.length
    // Show about the five nearest places around the party, like a game mini-map; farther ones fall off the edge.
    const dists = placed.map((p) => Math.hypot(p.x! * a - cx, p.y! - cy)).sort((x, y) => x - y)
    const reach = Math.max(0.08, dists[Math.min(4, dists.length - 1)] ?? 0.3)
    const scale = Math.min(1600, Math.max(120, 105 / reach)) * zoom
    const project = (x: number, y: number): [number, number] => [SIZE / 2 + (x * a - cx) * scale, SIZE / 2 + (y - cy) * scale]

    // Labels: nearest first; skip any that would overlap one already placed.
    // The compass and scale bar corners are kept clear.
    const boxes: { x: number; y: number; w: number; h: number }[] = [
      { x: SIZE - 34, y: 4, w: 30, h: 30 },
      ...(map.scale ? [{ x: 6, y: SIZE - 28, w: 90, h: 24 }] : [])
    ]
    const labels = new Map<string, { x: number; y: number }>()
    const order = [...placed].sort((p, q) => Math.hypot(p.x! * a - cx, p.y! - cy) - Math.hypot(q.x! * a - cx, q.y! - cy))
    const hereId = map.party?.at
    for (const p of order) {
      const [px, py] = project(p.x!, p.y!)
      if (px < -20 || px > SIZE + 20 || py < -20 || py > SIZE + 20) continue
      const text = truncate(p.name)
      const w = text.length * 5.3
      const lx = Math.min(SIZE - w / 2 - 4, Math.max(w / 2 + 4, px))
      const ly = py + (p.id === hereId ? 34 : 21)
      const box = { x: lx - w / 2, y: ly - 9, w, h: 11 }
      if (boxes.some((b) => box.x < b.x + b.w + 3 && b.x < box.x + box.w + 3 && box.y < b.y + b.h && b.y < box.y + box.h)) continue
      boxes.push(box)
      labels.set(p.id, { x: lx, y: ly })
    }
    return { placed, scale, project, labels, ox: (((-cx * scale) % GRID) + GRID) % GRID, oy: (((-cy * scale) % GRID) + GRID) % GRID }
  }, [map, zoom])

  if (!map || !view || !show) return null
  const { placed, scale, project, labels } = view
  const here = map.party ? project(map.party.x, map.party.y) : null
  const herePin = map.party?.at ? map.pins.find((p) => p.id === map.party!.at) : undefined
  const bar = map.scale ? niceScaleBar((scale * map.aspect) / map.scale.width) : null
  const visible = (x: number, y: number): boolean => x > -40 && x < SIZE + 40 && y > -40 && y < SIZE + 40

  return (
    <div role="region" aria-label="Mini-map" className="group absolute top-3 right-4 z-10 w-64 overflow-hidden rounded-lg border border-white/10 shadow-card" style={{ background: COLORS.bg }}>
      <button type="button" onClick={() => useMap.setState({ open: true })} aria-label={`Open the map${herePin ? `: the party is at ${herePin.name}` : ''}`} className="block w-full">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="block w-full" role="img" aria-hidden>
          <defs>
            <pattern id="mm-grid" width={GRID} height={GRID} patternUnits="userSpaceOnUse" patternTransform={`translate(${view.ox} ${view.oy})`}>
              <path d={`M ${GRID} 0 L 0 0 0 ${GRID}`} fill="none" stroke={COLORS.grid} strokeWidth={1} />
            </pattern>
            <radialGradient id="mm-vignette" cx="50%" cy="50%" r="70%">
              <stop offset="60%" stopColor="#000" stopOpacity={0} />
              <stop offset="100%" stopColor="#000" stopOpacity={0.45} />
            </radialGradient>
          </defs>
          <rect width={SIZE} height={SIZE} fill="url(#mm-grid)" />

          {placed.map((p) => {
            const [x, y] = project(p.x!, p.y!)
            if (!visible(x, y)) return null
            const isHere = p.id === herePin?.id
            const label = labels.get(p.id)
            return (
              <g key={p.id}>
                <title>{p.name}</title>
                {!isHere && <circle cx={x} cy={y} r={9} fill={COLORS.ringFill} stroke={p.kind === 'danger' ? '#b54145' : COLORS.ring} strokeWidth={1.5} />}
                {!isHere && <KindIcon pin={p} x={x} y={y} />}
                {label && (
                  <text x={label.x} y={label.y} textAnchor="middle" fontSize={9.5} fill={COLORS.label} fillOpacity={0.9} style={{ fontFamily: 'Inter Variable, Segoe UI, sans-serif' }}>
                    {truncate(p.name)}
                  </text>
                )}
              </g>
            )
          })}

          {here && (
            <g>
              <circle cx={here[0]} cy={here[1]} r={17} fill={COLORS.here} fillOpacity={0.07} />
              <circle cx={here[0]} cy={here[1]} r={12} fill="none" stroke={COLORS.here} strokeWidth={2} />
              <circle cx={here[0]} cy={here[1]} r={6} fill={COLORS.hereDot} stroke="#111" strokeWidth={1.5} />
              <text x={here[0]} y={here[1] + 24} textAnchor="middle" fontSize={7.5} fontWeight={700} letterSpacing={1.6} fill={COLORS.here} style={{ fontFamily: 'Inter Variable, Segoe UI, sans-serif' }}>
                HERE
              </text>
            </g>
          )}

          {/* Compass */}
          <path d={`M ${SIZE - 20} 9 l 5 9 h -10 z`} fill={COLORS.ring} />
          <text x={SIZE - 20} y={29} textAnchor="middle" fontSize={8.5} fill={COLORS.ring} style={{ fontFamily: 'Inter Variable, Segoe UI, sans-serif' }}>
            N
          </text>

          {/* Scale bar */}
          {bar && bar.px > 8 && bar.px < SIZE - 30 && (
            <g>
              <line x1={12} y1={SIZE - 12} x2={12 + bar.px} y2={SIZE - 12} stroke={COLORS.ring} strokeWidth={2} />
              <text x={12} y={SIZE - 18} fontSize={8.5} fill={COLORS.ring} style={{ fontFamily: 'Inter Variable, Segoe UI, sans-serif' }}>
                {bar.units.toLocaleString()} {map.scale!.unit}
              </text>
            </g>
          )}
          <rect width={SIZE} height={SIZE} fill="url(#mm-vignette)" pointerEvents="none" />
        </svg>
      </button>
      <div className="absolute right-1.5 bottom-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        {[
          { label: 'Zoom in', icon: Plus, run: () => setZoom((z) => Math.min(4, z * 1.5)) },
          { label: 'Zoom out', icon: Minus, run: () => setZoom((z) => Math.max(0.35, z / 1.5)) },
          { label: 'Hide the mini-map', icon: X, run: () => void useApp.getState().updateSettings({ behavior: { miniMap: false } }) }
        ].map(({ label, icon: Icon, run }) => (
          <button key={label} type="button" aria-label={label} onClick={run} className="grid size-6 place-items-center rounded bg-black/60 text-white/80 hover:bg-black/80 hover:text-white">
            <Icon className="size-3.5" />
          </button>
        ))}
      </div>
    </div>
  )
}
