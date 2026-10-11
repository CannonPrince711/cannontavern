/**
 * Campaign maps: an image plus pins and the party's position, stored in a
 * "type: map" note inside the campaign folder. Coordinates are fractions of
 * the image (0–1), so they survive resizing. The note's "## Pins" section is
 * kept as a readable list of wikilinks, which Obsidian's graph picks up.
 */
import type { VaultPath } from './types'

export const PIN_KINDS = ['location', 'poi', 'danger', 'note'] as const
export type PinKind = (typeof PIN_KINDS)[number]

export const PIN_KIND_INFO: Record<PinKind, { label: string; color: string }> = {
  location: { label: 'Location', color: '#d4a843' },
  poi: { label: 'Point of interest', color: '#6ea8fe' },
  danger: { label: 'Danger', color: '#e5484d' },
  note: { label: 'Note', color: '#c084fc' }
}

export interface MapPin {
  id: string
  name: string
  /** Fractions of the image; null while a pin is listed but not placed. */
  x: number | null
  y: number | null
  kind: PinKind
  description: string
  /** Link target for the pin's note (e.g. "Cinderhold"), if any. */
  note?: string
}

export interface PartyMarker {
  x: number
  y: number
  /** The pin the party is at, if it's on one. */
  at?: string
}

export const SCALE_UNITS = ['ft', 'm', 'mi', 'km'] as const
export type ScaleUnit = (typeof SCALE_UNITS)[number]

/** How wide the whole map is in the world, for the scale bar. */
export interface MapScale {
  width: number
  unit: ScaleUnit
}

export interface CampaignMap {
  /** The map note (may not exist yet). */
  path: VaultPath
  exists: boolean
  /** Vault path of the map image, or '' (pins on a blank grid). */
  image: string
  pins: MapPin[]
  party: PartyMarker | null
  /** Image width ÷ height (4:3 when there's no image). */
  aspect: number
  scale: MapScale | null
}

export const DEFAULT_ASPECT = 4 / 3

export function normalizeScale(raw: unknown): MapScale | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const width = typeof r.width === 'number' && r.width > 0 ? r.width : null
  const unit = (SCALE_UNITS as readonly string[]).includes(r.unit as string) ? (r.unit as ScaleUnit) : null
  return width && unit ? { width, unit } : null
}

export function normalizeAspect(raw: unknown): number {
  return typeof raw === 'number' && raw > 0.1 && raw < 10 ? raw : DEFAULT_ASPECT
}

/** A round scale-bar length (1, 2 or 5 × 10ⁿ units) that is about `targetPx` wide. */
export function niceScaleBar(pxPerUnit: number, targetPx = 64): { units: number; px: number } {
  const raw = targetPx / pxPerUnit
  const pow = 10 ** Math.floor(Math.log10(raw))
  const units = [1, 2, 5, 10].map((m) => m * pow).reduce((best, u) => (Math.abs(u - raw) < Math.abs(best - raw) ? u : best))
  return { units, px: units * pxPerUnit }
}

/** Lays out named places on a loose grid (for campaigns made by the builder). */
export function autoLayout(names: string[]): { x: number; y: number }[] {
  const n = names.length
  const cols = Math.max(1, Math.ceil(Math.sqrt(n * DEFAULT_ASPECT)))
  const rows = Math.max(1, Math.ceil(n / cols))
  return names.map((name, i) => {
    // Deterministic jitter from the name, so layouts are stable.
    let h = 0
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
    const jx = ((h % 1000) / 1000 - 0.5) * 0.5
    const jy = ((Math.floor(h / 1000) % 1000) / 1000 - 0.5) * 0.5
    const c = i % cols
    const r = Math.floor(i / cols)
    return { x: Math.round(((c + 0.5 + jx) / cols) * 10000) / 10000, y: Math.round(((r + 0.5 + jy) / rows) * 10000) / 10000 }
  })
}

const clamp01 = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null)

export function normalizePins(raw: unknown): MapPin[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
    .map((p, i) => ({
      id: typeof p.id === 'string' && p.id ? p.id : `pin${i + 1}`,
      name: typeof p.name === 'string' ? p.name : '',
      x: clamp01(p.x),
      y: clamp01(p.y),
      kind: (PIN_KINDS as readonly string[]).includes(p.kind as string) ? (p.kind as PinKind) : 'location',
      description: typeof p.description === 'string' ? p.description : '',
      ...(typeof p.note === 'string' && p.note ? { note: p.note } : {})
    }))
    .filter((p) => p.name.trim())
}

export function normalizeParty(raw: unknown): PartyMarker | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const x = clamp01(r.x)
  const y = clamp01(r.y)
  if (x === null || y === null) return null
  return { x, y, ...(typeof r.at === 'string' && r.at ? { at: r.at } : {}) }
}

const PIN_LINE = /^\s*[-*]\s+(?:\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]|([^—–-]+?))\s*(?:[—–-]\s*(.*))?$/

/** Pins listed in a "## Pins" section without coordinates (hand-written notes). */
export function pinsFromBody(body: string): MapPin[] {
  const section = /^##\s+Pins\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/im.exec(body)?.[1] ?? ''
  const out: MapPin[] = []
  for (const line of section.split('\n')) {
    const m = PIN_LINE.exec(line)
    if (!m) continue
    const note = m[1]?.trim()
    const name = (m[2] ?? note ?? m[3] ?? '').trim()
    if (!name) continue
    out.push({ id: `pin${out.length + 1}`, name, x: null, y: null, kind: 'location', description: (m[4] ?? '').trim(), ...(note ? { note } : {}) })
  }
  return out
}

/** Rewrites (or adds) the "## Pins" section of a map note body. */
export function replacePinsSection(body: string, pins: MapPin[]): string {
  const lines = pins.map((p) => {
    const label = p.note ? (p.note === p.name ? `[[${p.note}]]` : `[[${p.note}|${p.name}]]`) : p.name
    return `- ${label}${p.description.trim() ? ` — ${p.description.trim()}` : ''}`
  })
  const section = `## Pins\n\n${lines.length ? lines.join('\n') : '*No pins yet.*'}\n`
  const re = /^##\s+Pins\s*$[\s\S]*?(?=^##\s|(?![\s\S]))/im
  if (re.test(body)) return body.replace(re, `${section}\n`).replace(/\n{3,}$/, '\n')
  return `${body.replace(/\s*$/, '')}\n\n${section}`
}

/** Short description of where the party is, for the prompt. */
export function partyLocation(map: Pick<CampaignMap, 'pins' | 'party'> | null): string | null {
  if (!map?.party?.at) return null
  const pin = map.pins.find((p) => p.id === map.party!.at)
  if (!pin) return null
  return pin.description.trim() ? `${pin.name}: ${pin.description.trim()}` : pin.name
}

/** The nearest placed pin within `radius` (fractions of the image) of a point. */
export function nearestPin(pins: MapPin[], x: number, y: number, radius = 0.04): MapPin | null {
  let best: MapPin | null = null
  let bestD = radius
  for (const p of pins) {
    if (p.x === null || p.y === null) continue
    const d = Math.hypot(p.x - x, p.y - y)
    if (d <= bestD) {
      best = p
      bestD = d
    }
  }
  return best
}
