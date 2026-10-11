import { useEffect, useMemo, useRef, useState } from 'react'
import type { GraphKind, GraphLink, GraphNode, VaultGraph } from '@shared/graph'

/** Node colours by kind (matching the app's palette). */
export const KIND_COLORS: Record<GraphKind, string> = {
  campaign: '#d4a843',
  party: '#a8862f',
  session: '#6ea8fe',
  character: '#34c38f',
  npc: '#c084fc',
  lorebook: '#f59e0b',
  preset: '#94a3b8',
  note: '#7c7486'
}

export const KIND_LABELS: Record<GraphKind, string> = {
  campaign: 'Campaigns',
  party: 'Party sheets',
  session: 'Sessions',
  character: 'Characters',
  npc: 'NPCs',
  lorebook: 'Lorebooks',
  preset: 'Presets',
  note: 'Other notes'
}

interface Body {
  x: number
  y: number
  vx: number
  vy: number
  fixed?: boolean
}

interface Props {
  graph: VaultGraph
  /** Only these nodes are shown (all when undefined). */
  visible?: Set<string>
  showMentions: boolean
  /** Highlighted node (the current session in the local graph). */
  focusId?: string
  /** Nodes whose names match the search box. */
  matches?: Set<string>
  onOpen: (node: GraphNode) => void
  className?: string
  /** Always show labels (small local graphs). */
  labels?: boolean
}

/**
 * Force-directed note graph on a canvas, in the spirit of Obsidian's graph
 * view: drag nodes, drag the background to pan, scroll to zoom, hover to
 * highlight neighbours, click to open.
 */
export function GraphCanvas({ graph, visible, showMentions, focusId, matches, onOpen, className, labels = false }: Props): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const bodies = useRef(new Map<string, Body>())
  const view = useRef({ scale: 1, tx: 0, ty: 0 })
  const alpha = useRef(1)
  const hover = useRef<string | null>(null)
  const [, redraw] = useState(0)
  const draw = useRef<() => void>(() => {})

  const nodes = useMemo(() => graph.nodes.filter((n) => !visible || visible.has(n.id)), [graph, visible])
  const links = useMemo(() => {
    const ids = new Set(nodes.map((n) => n.id))
    return graph.links.filter((l) => ids.has(l.source) && ids.has(l.target) && (showMentions || l.kind === 'link'))
  }, [graph, nodes, showMentions])
  const degree = useMemo(() => {
    const d = new Map<string, number>()
    for (const l of links) {
      d.set(l.source, (d.get(l.source) ?? 0) + 1)
      d.set(l.target, (d.get(l.target) ?? 0) + 1)
    }
    return d
  }, [links])
  const neighbours = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const l of links) {
      if (!m.has(l.source)) m.set(l.source, new Set())
      if (!m.has(l.target)) m.set(l.target, new Set())
      m.get(l.source)!.add(l.target)
      m.get(l.target)!.add(l.source)
    }
    return m
  }, [links])

  // Place new nodes near a linked node (or randomly), then reheat.
  useEffect(() => {
    const b = bodies.current
    for (const n of nodes) {
      if (b.has(n.id)) continue
      const near = [...(neighbours.get(n.id) ?? [])].map((id) => b.get(id)).find(Boolean)
      const r = 40 + Math.random() * 60
      const a = Math.random() * Math.PI * 2
      b.set(n.id, { x: (near?.x ?? 0) + Math.cos(a) * r, y: (near?.y ?? 0) + Math.sin(a) * r, vx: 0, vy: 0 })
    }
    alpha.current = 1
    redraw((x) => x + 1)
  }, [nodes, neighbours])

  const radius = (id: string): number => 4 + Math.sqrt(degree.get(id) ?? 0) * 1.8

  // Simulation + drawing loop.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let frame = 0
    const ctx = canvas.getContext('2d')!
    const css = getComputedStyle(document.documentElement)
    const fg = css.getPropertyValue('--foreground').trim() || '#ece6dc'
    const muted = css.getPropertyValue('--muted-foreground').trim() || '#a99f92'
    const byId = new Map(nodes.map((n) => [n.id, n]))

    const tick = (): void => {
      const b = bodies.current
      const list = nodes.map((n) => [n.id, b.get(n.id)!] as const).filter(([, x]) => x)
      // Repulsion between every pair (fine for a few hundred notes).
      for (let i = 0; i < list.length; i++) {
        const [, p] = list[i]!
        for (let j = i + 1; j < list.length; j++) {
          const [, q] = list[j]!
          let dx = p.x - q.x
          let dy = p.y - q.y
          let d2 = dx * dx + dy * dy
          if (d2 < 1) {
            dx = Math.random() - 0.5
            dy = Math.random() - 0.5
            d2 = 1
          }
          const f = (1400 / d2) * alpha.current
          const d = Math.sqrt(d2)
          p.vx += (dx / d) * f
          p.vy += (dy / d) * f
          q.vx -= (dx / d) * f
          q.vy -= (dy / d) * f
        }
      }
      // Springs along links.
      for (const l of links) {
        const p = b.get(l.source)
        const q = b.get(l.target)
        if (!p || !q) continue
        const dx = q.x - p.x
        const dy = q.y - p.y
        const d = Math.max(1, Math.sqrt(dx * dx + dy * dy))
        const rest = l.kind === 'mention' ? 110 : 75
        const f = (d - rest) * 0.03 * alpha.current
        p.vx += (dx / d) * f
        p.vy += (dy / d) * f
        q.vx -= (dx / d) * f
        q.vy -= (dy / d) * f
      }
      for (const [, p] of list) {
        // Gentle pull to the centre keeps islands on screen.
        p.vx -= p.x * 0.004 * alpha.current
        p.vy -= p.y * 0.004 * alpha.current
        if (p.fixed) {
          p.vx = 0
          p.vy = 0
          continue
        }
        p.vx *= 0.82
        p.vy *= 0.82
        p.x += Math.max(-30, Math.min(30, p.vx))
        p.y += Math.max(-30, Math.min(30, p.vy))
      }
      alpha.current = Math.max(0, alpha.current * 0.985)
    }

    const paint = (): void => {
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
      }
      const { scale, tx, ty } = view.current
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.translate(w / 2 + tx, h / 2 + ty)
      ctx.scale(scale, scale)
      const b = bodies.current
      const hot = hover.current
      const lit = hot ? new Set([hot, ...(neighbours.get(hot) ?? [])]) : null

      for (const l of links) {
        const p = b.get(l.source)
        const q = b.get(l.target)
        if (!p || !q) continue
        const on = !lit || (lit.has(l.source) && lit.has(l.target) && (l.source === hot || l.target === hot))
        ctx.strokeStyle = on && lit ? KIND_COLORS[byId.get(hot!)?.kind ?? 'note'] : muted
        ctx.globalAlpha = on ? (lit ? 0.9 : 0.35) : 0.08
        ctx.lineWidth = (on && lit ? 1.6 : 1) / scale
        ctx.setLineDash(l.kind === 'mention' ? [4 / scale, 4 / scale] : [])
        ctx.beginPath()
        ctx.moveTo(p.x, p.y)
        ctx.lineTo(q.x, q.y)
        ctx.stroke()
      }
      ctx.setLineDash([])
      for (const n of nodes) {
        const p = b.get(n.id)
        if (!p) continue
        const r = radius(n.id)
        const dim = (lit && !lit.has(n.id)) || (matches && matches.size > 0 && !matches.has(n.id))
        ctx.globalAlpha = dim ? 0.15 : 1
        ctx.fillStyle = KIND_COLORS[n.kind]
        ctx.beginPath()
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
        ctx.fill()
        if (n.id === focusId || matches?.has(n.id)) {
          ctx.strokeStyle = fg
          ctx.lineWidth = 2 / scale
          ctx.beginPath()
          ctx.arc(p.x, p.y, r + 3 / scale, 0, Math.PI * 2)
          ctx.stroke()
        }
        const showLabel = labels || scale > 1.1 || n.id === hot || lit?.has(n.id) || n.id === focusId || matches?.has(n.id) || (degree.get(n.id) ?? 0) >= 6
        if (showLabel && !dim) {
          ctx.globalAlpha = n.id === hot ? 1 : 0.85
          ctx.fillStyle = fg
          ctx.font = `${(n.id === hot ? 12.5 : 11) / scale}px Inter Variable, Segoe UI, sans-serif`
          ctx.textAlign = 'center'
          ctx.fillText(n.name.length > 28 ? `${n.name.slice(0, 27)}…` : n.name, p.x, p.y + r + 12 / scale)
        }
      }
      ctx.globalAlpha = 1
    }

    draw.current = paint
    const loop = (): void => {
      if (alpha.current > 0.005) tick()
      paint()
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [nodes, links, neighbours, degree, focusId, matches, labels]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fit the view to the nodes once the layout has settled a little.
  useEffect(() => {
    const timers = [setTimeout(() => fit(), 700), setTimeout(() => fit(), 1800)]
    return () => timers.forEach(clearTimeout)
  }, [nodes.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const fit = (): void => {
    const canvas = canvasRef.current
    const list = nodes.map((n) => bodies.current.get(n.id)).filter((b): b is Body => !!b)
    if (!canvas || !list.length) return
    const xs = list.map((b) => b.x)
    const ys = list.map((b) => b.y)
    const w = Math.max(...xs) - Math.min(...xs) + 120
    const h = Math.max(...ys) - Math.min(...ys) + 120
    const scale = Math.max(0.2, Math.min(2, Math.min(canvas.clientWidth / w, canvas.clientHeight / h)))
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2
    const cy = (Math.max(...ys) + Math.min(...ys)) / 2
    view.current = { scale, tx: -cx * scale, ty: -cy * scale }
  }

  // Pointer interaction.
  const toWorld = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const { scale, tx, ty } = view.current
    return { x: (e.clientX - rect.left - rect.width / 2 - tx) / scale, y: (e.clientY - rect.top - rect.height / 2 - ty) / scale }
  }
  const hit = (e: { clientX: number; clientY: number }): GraphNode | null => {
    const w = toWorld(e)
    let best: GraphNode | null = null
    let bestD = Infinity
    for (const n of nodes) {
      const b = bodies.current.get(n.id)
      if (!b) continue
      const d = Math.hypot(b.x - w.x, b.y - w.y)
      const r = radius(n.id) + 4 / view.current.scale
      if (d < r && d < bestD) {
        best = n
        bestD = d
      }
    }
    return best
  }
  const drag = useRef<{ kind: 'node' | 'pan'; id?: string; startX: number; startY: number; moved: boolean; tx: number; ty: number } | null>(null)

  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    ;(e.target as Element).setPointerCapture(e.pointerId)
    const n = hit(e)
    drag.current = { kind: n ? 'node' : 'pan', id: n?.id, startX: e.clientX, startY: e.clientY, moved: false, tx: view.current.tx, ty: view.current.ty }
    if (n) {
      const b = bodies.current.get(n.id)!
      b.fixed = true
      alpha.current = Math.max(alpha.current, 0.3)
    }
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    const d = drag.current
    if (!d) {
      const n = hit(e)
      if ((n?.id ?? null) !== hover.current) {
        hover.current = n?.id ?? null
        if (canvasRef.current) canvasRef.current.style.cursor = n ? 'pointer' : 'grab'
      }
      return
    }
    if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 3) d.moved = true
    if (d.kind === 'node' && d.id) {
      const w = toWorld(e)
      const b = bodies.current.get(d.id)!
      b.x = w.x
      b.y = w.y
      alpha.current = Math.max(alpha.current, 0.3)
    } else {
      view.current.tx = d.tx + (e.clientX - d.startX)
      view.current.ty = d.ty + (e.clientY - d.startY)
    }
  }
  const onPointerUp = (e: React.PointerEvent): void => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.id) bodies.current.get(d.id)!.fixed = false
    if (!d.moved && d.id) {
      const n = nodes.find((x) => x.id === d.id)
      if (n) onOpen(n)
    }
    void e
  }
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const v = view.current
      const k = Math.exp(-e.deltaY * 0.0015)
      const scale = Math.max(0.15, Math.min(4, v.scale * k))
      // Zoom around the cursor.
      const mx = e.clientX - rect.left - rect.width / 2
      const my = e.clientY - rect.top - rect.height / 2
      v.tx = mx - ((mx - v.tx) * scale) / v.scale
      v.ty = my - ((my - v.ty) * scale) / v.scale
      v.scale = scale
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  return (
    <div ref={wrapRef} className={className}>
      <canvas
        ref={canvasRef}
        className="h-full w-full touch-none"
        style={{ cursor: 'grab' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => (hover.current = null)}
        onDoubleClick={() => fit()}
        role="img"
        aria-label={`Note graph: ${nodes.length} notes, ${links.length} links`}
      />
    </div>
  )
}

export type { GraphLink }
