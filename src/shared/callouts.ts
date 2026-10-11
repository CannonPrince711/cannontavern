/**
 * Session note body ⇄ messages.
 *
 * Each chat turn is an Obsidian callout:
 *
 *   > [!dm] Narrator
 *   > The fog rolls in over Saltmere.
 *   >
 *   > A bell tolls somewhere below the water.
 *   > <!-- id:m1k2x9 t:2026-10-10T19:00:00.000Z swipes:2 swipe:1 -->
 *
 * The last line of a callout is an HTML comment with the message id and
 * metadata (invisible in Obsidian's reading view). Structured payloads (dice
 * results, image info) are base64url JSON under `data:`. The active swipe's
 * text lives in the body; alternative swipes live in the frontmatter.
 *
 * Parsing records every block's exact character range, and edits splice only
 * that range, so anything the user writes between callouts in Obsidian is left
 * byte-for-byte untouched.
 */
import type { Message, MessageImage, MessageRole, RollResult, StateChange } from './types'

const ROLES: MessageRole[] = ['player', 'dm', 'roll', 'system', 'image']
const HEADER_RE = /^>\s*\[!(player|dm|roll|system|image)\][+-]?[ \t]*(.*)$/i
const META_RE = /^<!--(.*)-->\s*$/

export interface ParsedBlock {
  message: Message
  /** Character offsets of the block in the body: [start, end). */
  start: number
  end: number
}

interface MetaData {
  roll?: RollResult
  image?: MessageImage
  stateChanges?: StateChange[]
  backendId?: string
}

/** "m" + base-36 timestamp + 32 random bits, so ids made in the same millisecond don't collide. */
export function newMessageId(): string {
  const rand = new Uint32Array(1)
  globalThis.crypto.getRandomValues(rand)
  return `m${Date.now().toString(36)}${rand[0]!.toString(36).padStart(7, '0')}`
}

// ─── base64url JSON (works in Node and the browser) ─────────────────────────

function toBase64Url(json: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(json))
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): unknown {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return JSON.parse(new TextDecoder().decode(bytes))
}

// ─── Metadata comment ───────────────────────────────────────────────────────

function formatMeta(m: Message): string {
  const parts = [`id:${m.id}`]
  if (m.createdAt) parts.push(`t:${m.createdAt}`)
  if (m.swipes.length > 1) parts.push(`swipes:${m.swipes.length}`, `swipe:${m.swipeIndex}`)
  if (m.hidden) parts.push('hidden')
  if (m.model) parts.push(`model:${encodeURIComponent(m.model)}`)
  const data: MetaData = {}
  if (m.roll) data.roll = m.roll
  if (m.image) data.image = m.image
  if (m.stateChanges?.length) data.stateChanges = m.stateChanges
  if (m.backendId) data.backendId = m.backendId
  if (Object.keys(data).length) parts.push(`data:${toBase64Url(data)}`)
  return `<!-- ${parts.join(' ')} -->`
}

function parseMeta(inner: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const token of inner.trim().split(/\s+/)) {
    if (!token) continue
    const i = token.indexOf(':')
    if (i === -1) out[token] = 'true'
    else out[token.slice(0, i)] = token.slice(i + 1)
  }
  return out
}

// ─── Serialisation ──────────────────────────────────────────────────────────

/** The callout title: speaker name, roll label, image caption… on one line. */
function titleOf(m: Message): string {
  const raw = m.name ?? ''
  return raw.replace(/\s+/g, ' ').trim()
}

/** One message → one callout block (no trailing newline). */
export function serializeMessage(m: Message): string {
  const title = titleOf(m)
  const lines = [`> [!${m.role}]${title ? ` ${title}` : ''}`]
  const text = m.text.replace(/\r\n?/g, '\n').replace(/\s+$/, '')
  if (text) for (const line of text.split('\n')) lines.push(line ? `> ${line}` : '>')
  lines.push(`> ${formatMeta(m)}`)
  return lines.join('\n')
}

export function serializeSessionBody(messages: Message[]): string {
  return messages.length ? `${messages.map(serializeMessage).join('\n\n')}\n` : ''
}

/** Alternative swipes for the frontmatter (only messages that have more than one). */
export function swipesForFrontmatter(messages: Message[]): Record<string, string[]> | undefined {
  const out: Record<string, string[]> = {}
  for (const m of messages) if (m.swipes.length > 1) out[m.id] = m.swipes
  return Object.keys(out).length ? out : undefined
}

// ─── Parsing ────────────────────────────────────────────────────────────────

interface Line {
  text: string
  start: number
  /** Offset just past the line's content (before its line break). */
  end: number
}

function splitLines(body: string): Line[] {
  const lines: Line[] = []
  const re = /\r\n|\r|\n/g
  let pos = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    lines.push({ text: body.slice(pos, m.index), start: pos, end: m.index })
    pos = m.index + m[0].length
  }
  if (pos < body.length) lines.push({ text: body.slice(pos), start: pos, end: body.length })
  return lines
}

/**
 * Parses every chat callout in a session body. `swipes` is the frontmatter's
 * swipe map; the body's text always wins for the active swipe.
 */
export function parseSessionBody(body: string, swipes: Record<string, string[]> = {}): ParsedBlock[] {
  const lines = splitLines(body)
  const blocks: ParsedBlock[] = []
  let i = 0
  let ordinal = 0
  while (i < lines.length) {
    const header = HEADER_RE.exec(lines[i]!.text)
    if (!header) {
      i++
      continue
    }
    const start = lines[i]!.start
    const role = header[1]!.toLowerCase() as MessageRole
    const title = (header[2] ?? '').trim()
    const content: string[] = []
    let j = i + 1
    while (j < lines.length && /^>/.test(lines[j]!.text) && !HEADER_RE.test(lines[j]!.text)) {
      content.push(lines[j]!.text.replace(/^> ?/, ''))
      j++
    }
    const end = lines[j - 1]!.end

    let meta: Record<string, string> = {}
    const last = content[content.length - 1]
    const metaMatch = last !== undefined ? META_RE.exec(last.trim()) : null
    if (metaMatch && /\bid:/.test(metaMatch[1] ?? '')) {
      meta = parseMeta(metaMatch[1] ?? '')
      content.pop()
    }
    while (content.length && content[content.length - 1]!.trim() === '') content.pop()
    const text = content.join('\n')

    let data: MetaData = {}
    if (meta.data) {
      try {
        data = fromBase64Url(meta.data) as MetaData
      } catch {
        data = {}
      }
    }

    const id = meta.id || autoId(ordinal, role, text)
    const stored = swipes[id]
    let swipeList = stored && stored.length > 1 ? [...stored] : [text]
    let swipeIndex = Math.max(0, Math.min(Number(meta.swipe ?? swipeList.length - 1) || 0, swipeList.length - 1))
    if (!stored) swipeIndex = 0
    swipeList[swipeIndex] = text
    if (swipeList.length === 0) swipeList = [text]

    const message: Message = {
      id,
      role: ROLES.includes(role) ? role : 'system',
      text,
      swipes: swipeList,
      swipeIndex,
      createdAt: meta.t ?? '',
      ...(title ? { name: title } : {}),
      ...(meta.hidden === 'true' ? { hidden: true } : {}),
      ...(meta.model ? { model: safeDecode(meta.model) } : {}),
      ...(data.roll ? { roll: data.roll } : {}),
      ...(data.image ? { image: data.image } : {}),
      ...(data.stateChanges ? { stateChanges: data.stateChanges } : {}),
      ...(data.backendId ? { backendId: data.backendId } : {})
    }
    blocks.push({ message, start, end })
    ordinal++
    i = j
  }
  return blocks
}

export function parseMessages(body: string, swipes?: Record<string, string[]>): Message[] {
  return parseSessionBody(body, swipes).map((b) => b.message)
}

/** Stable id for a callout the user typed by hand (no metadata comment yet). */
function autoId(ordinal: number, role: string, text: string): string {
  let h = 2166136261
  for (const ch of `${role}:${text}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return `auto${ordinal}-${(h >>> 0).toString(36)}`
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

// ─── Surgical edits ─────────────────────────────────────────────────────────

/** Appends a message block, separated from what came before by one blank line. */
export function appendMessage(body: string, m: Message): string {
  const trimmed = body.replace(/\s+$/, '')
  return `${trimmed ? `${trimmed}\n\n` : ''}${serializeMessage(m)}\n`
}

/** Replaces one message's block in place. Throws if the id isn't in the body. */
export function replaceMessage(body: string, id: string, m: Message): string {
  const block = parseSessionBody(body).find((b) => b.message.id === id)
  if (!block) throw new Error(`Message ${id} not found in the session note.`)
  return body.slice(0, block.start) + serializeMessage(m) + body.slice(block.end)
}

/** Removes one message's block and the blank line that separated it. */
export function removeMessage(body: string, id: string): string {
  const blocks = parseSessionBody(body)
  const block = blocks.find((b) => b.message.id === id)
  if (!block) return body
  let end = block.end
  // Swallow the line break(s) up to the next content so no double gap remains.
  const after = /^(\r?\n)+/.exec(body.slice(end))
  if (after) end += after[0].length
  let start = block.start
  if (end >= body.length) {
    // Last block: remove the separator before it instead.
    const before = /(\r?\n)+$/.exec(body.slice(0, start))
    if (before) start -= before[0].length
    const tail = body.slice(0, start)
    return tail ? `${tail}\n` : ''
  }
  return body.slice(0, start) + body.slice(end)
}

/** Keeps everything up to and including `id` (for "fork session from here"). */
export function truncateAfter(body: string, id: string): string {
  const block = parseSessionBody(body).find((b) => b.message.id === id)
  if (!block) throw new Error(`Message ${id} not found in the session note.`)
  return `${body.slice(0, block.end)}\n`
}
