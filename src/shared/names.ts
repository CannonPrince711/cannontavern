/**
 * File-name, path and wikilink helpers shared by main and renderer.
 * Vault paths are always relative to the vault root and use forward slashes.
 */

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i

/**
 * Makes a string safe as a Windows file name and as an Obsidian wikilink
 * target: strips \ / : * ? " < > | (Windows) and # ^ [ ] (they break links),
 * control characters, and trailing dots/spaces; avoids reserved device names.
 */
export function sanitizeFileName(name: string, maxLength = 120): string {
  let out = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|#^[\]\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
  if (out.length > maxLength) out = out.slice(0, maxLength).trim().replace(/[. ]+$/, '')
  if (!out) out = 'Untitled'
  if (RESERVED.test(out.split('.')[0] ?? '')) out = `${out}_`
  return out
}

/** Joins vault path segments with forward slashes, dropping empty parts. */
export function joinVaultPath(...parts: string[]): string {
  return parts
    .flatMap((p) => p.split(/[\\/]+/))
    .filter((p) => p && p !== '.')
    .join('/')
}

/** "DND Tavern/Characters/Aria.md" → "Aria" */
export function noteName(path: string): string {
  const base = path.split('/').pop() ?? path
  return base.replace(/\.md$/i, '')
}

export function dirName(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

/** "[[Aria]]" or "[[DND Tavern/Characters/Aria|Aria]]" for a note path. */
export function toWikilink(path: string, opts: { full?: boolean; alias?: string } = {}): string {
  const name = noteName(path)
  if (!opts.full) return opts.alias && opts.alias !== name ? `[[${name}|${opts.alias}]]` : `[[${name}]]`
  const target = path.replace(/\.md$/i, '')
  return `[[${target}|${opts.alias ?? name}]]`
}

export interface Wikilink {
  target: string
  alias?: string
  heading?: string
  embed: boolean
}

const WIKILINK_RE = /(!?)\[\[([^\]|#\n]+)(?:#([^\]|\n]+))?(?:\|([^\]\n]+))?\]\]/g

/** Finds every [[target#heading|alias]] (and ![[embed]]) in a string. */
export function parseWikilinks(text: string): (Wikilink & { index: number; length: number })[] {
  const out: (Wikilink & { index: number; length: number })[] = []
  for (const m of text.matchAll(WIKILINK_RE)) {
    out.push({
      embed: m[1] === '!',
      target: (m[2] ?? '').trim(),
      heading: m[3]?.trim(),
      alias: m[4]?.trim(),
      index: m.index ?? 0,
      length: m[0].length
    })
  }
  return out
}

/** "[[Aria]]" → "Aria"; plain strings are returned trimmed. */
export function wikilinkTarget(value: string): string {
  const m = /^\s*!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]\s*$/.exec(value)
  return (m?.[1] ?? value).trim()
}

/** Formats a date with a tiny token set: YYYY MM DD HH mm. */
export function formatDate(date: Date, format: string): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return format
    .replace(/YYYY/g, String(date.getFullYear()))
    .replace(/MM/g, pad(date.getMonth() + 1))
    .replace(/DD/g, pad(date.getDate()))
    .replace(/HH/g, pad(date.getHours()))
    .replace(/mm/g, pad(date.getMinutes()))
}
