/**
 * The note graph: DND Tavern notes as nodes, wikilinks between them as edges
 * (resolved the way Obsidian does), plus "mention" edges where a session's
 * text names a character or NPC without linking it.
 */
import { classifyPath } from './layout'

export type GraphKind = 'universe' | 'campaign' | 'party' | 'session' | 'character' | 'npc' | 'lorebook' | 'preset' | 'note'

export interface GraphNode {
  id: string
  name: string
  kind: GraphKind
  campaignPath?: string
}

export interface GraphLink {
  source: string
  target: string
  kind: 'link' | 'mention'
}

export interface VaultGraph {
  nodes: GraphNode[]
  links: GraphLink[]
}

const LINK_RE = /(!?)\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g

/** Wikilink targets in a note (frontmatter included). Embedded non-notes (images) are skipped. */
export function extractLinks(content: string): string[] {
  const out: string[] = []
  for (const m of content.matchAll(LINK_RE)) {
    const target = m[2]!.trim()
    const ext = /\.([a-z0-9]+)$/i.exec(target)?.[1]?.toLowerCase()
    if (ext && ext !== 'md') continue
    out.push(target)
  }
  return out
}

function stem(p: string): string {
  return p.replace(/\\/g, '/').replace(/\.md$/i, '')
}

/** Resolves link text to a vault path: exact path, then path suffix, then a unique (or nearest) file name. */
export function makeResolver(paths: string[]): (target: string, from: string) => string | null {
  const byFull = new Map<string, string>()
  const byBase = new Map<string, string[]>()
  for (const p of paths) {
    const s = stem(p).toLowerCase()
    byFull.set(s, p)
    const base = s.split('/').pop()!
    byBase.set(base, [...(byBase.get(base) ?? []), p])
  }
  return (target, from) => {
    const t = stem(target.trim()).replace(/^\/+/, '').toLowerCase()
    if (!t) return null
    const exact = byFull.get(t)
    if (exact) return exact
    if (t.includes('/')) {
      for (const [s, p] of byFull) if (s.endsWith(`/${t}`)) return p
      return null
    }
    const candidates = byBase.get(t)
    if (!candidates?.length) return null
    if (candidates.length === 1) return candidates[0]!
    const dir = stem(from).split('/').slice(0, -1).join('/').toLowerCase()
    return candidates.find((p) => stem(p).toLowerCase().startsWith(`${dir}/`)) ?? [...candidates].sort((a, b) => a.length - b.length)[0]!
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Ids of the named things a text mentions (whole words, case-insensitive; names of 3+ letters). */
export function findMentions(text: string, names: { id: string; name: string }[]): string[] {
  const hits: string[] = []
  for (const n of names) {
    const name = n.name.trim()
    if (name.length < 3) continue
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(name)}($|[^\\p{L}\\p{N}])`, 'iu').test(text)) hits.push(n.id)
  }
  return hits
}

export interface GraphInput {
  rootFolder: string
  /** Every Markdown file in the vault (for resolving links). */
  allPaths: string[]
  /** Notes inside the DND Tavern folder, with their text. */
  files: { path: string; content: string }[]
  /** Display names by path (character names, session titles…). */
  labels: Map<string, string>
}

export function buildGraph({ rootFolder, allPaths, files, labels }: GraphInput): VaultGraph {
  const resolve = makeResolver(allPaths)
  const nodes = new Map<string, GraphNode>()
  const nameOf = (p: string): string => labels.get(p) ?? stem(p).split('/').pop()!
  const add = (path: string): GraphNode => {
    let n = nodes.get(path)
    if (!n) {
      const c = classifyPath(rootFolder, path)
      n = { id: path, name: nameOf(path), kind: c?.kind ?? 'note', ...(c?.campaignPath ? { campaignPath: c.campaignPath } : {}) }
      nodes.set(path, n)
    }
    return n
  }
  for (const f of files) add(f.path)

  const links: GraphLink[] = []
  const seen = new Set<string>()
  const pair = (a: string, b: string): string => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`)
  for (const f of files) {
    for (const target of extractLinks(f.content)) {
      const to = resolve(target, f.path)
      if (!to || to === f.path) continue
      add(to)
      const key = pair(f.path, to)
      if (seen.has(key)) continue
      seen.add(key)
      links.push({ source: f.path, target: to, kind: 'link' })
    }
  }

  // A party sheet belongs to its campaign even though it doesn't link to it.
  for (const n of nodes.values()) {
    if (n.kind !== 'party' || !n.campaignPath) continue
    const campaign = [...nodes.values()].find((x) => x.kind === 'campaign' && x.campaignPath === n.campaignPath)
    if (campaign && !seen.has(pair(n.id, campaign.id))) {
      seen.add(pair(n.id, campaign.id))
      links.push({ source: campaign.id, target: n.id, kind: 'link' })
    }
  }

  // Sessions that name a character or NPC without linking them.
  const people = [...nodes.values()].filter((n) => n.kind === 'character' || n.kind === 'npc').map((n) => ({ id: n.id, name: n.name }))
  for (const f of files) {
    if (nodes.get(f.path)?.kind !== 'session') continue
    for (const id of findMentions(f.content, people)) {
      const key = pair(f.path, id)
      if (seen.has(key)) continue
      seen.add(key)
      links.push({ source: f.path, target: id, kind: 'mention' })
    }
  }
  return { nodes: [...nodes.values()], links }
}

/** Nodes within `depth` links of `focus` (both directions). */
export function neighbourhood(graph: VaultGraph, focus: string, depth: number, kinds?: Set<GraphLink['kind']>): Set<string> {
  const adj = new Map<string, string[]>()
  for (const l of graph.links) {
    if (kinds && !kinds.has(l.kind)) continue
    adj.set(l.source, [...(adj.get(l.source) ?? []), l.target])
    adj.set(l.target, [...(adj.get(l.target) ?? []), l.source])
  }
  const out = new Set([focus])
  let frontier = [focus]
  for (let d = 0; d < depth; d++) {
    const next: string[] = []
    for (const id of frontier) for (const n of adj.get(id) ?? []) if (!out.has(n)) (out.add(n), next.push(n))
    frontier = next
  }
  return out
}
