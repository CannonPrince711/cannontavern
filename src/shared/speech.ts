/**
 * Splits text for a speech server into sentence-sized pieces. Slow servers
 * (Orpheus speaks about 12 characters a second) would take minutes on a whole
 * DM reply and hit proxy timeouts; pieces start playing in seconds while the
 * next one is made. The first piece is short so reading starts quickly.
 */
export function splitForSpeech(text: string, opts: { first?: number; max?: number } = {}): string[] {
  const first = opts.first ?? 160
  const max = opts.max ?? 360
  const sentences = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?…]["'”’)\]]?)\s+/)
    .flatMap((s) => (s.length <= max ? [s] : hardSplit(s, max)))
    .filter(Boolean)
  const out: string[] = []
  let cur = ''
  for (const s of sentences) {
    const limit = out.length === 0 ? first : max
    if (cur && cur.length + 1 + s.length > limit) {
      out.push(cur)
      cur = s
    } else cur = cur ? `${cur} ${s}` : s
  }
  if (cur) out.push(cur)
  return out
}

/** A sentence too long for one piece: break at commas or semicolons, else at spaces. */
function hardSplit(s: string, max: number): string[] {
  const out: string[] = []
  let rest = s
  while (rest.length > max) {
    const window = rest.slice(0, max)
    let cut = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '), window.lastIndexOf(' — '))
    if (cut < max / 3) cut = window.lastIndexOf(' ')
    if (cut <= 0) cut = max
    out.push(rest.slice(0, cut + (rest[cut] === ',' || rest[cut] === ';' ? 1 : 0)).trim())
    rest = rest.slice(cut + 1).trim()
  }
  if (rest) out.push(rest)
  return out
}
