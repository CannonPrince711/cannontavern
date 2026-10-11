/**
 * Session recaps: when a session ends, its chat is compressed into a short
 * recap (stored in the session's frontmatter) that later sessions of the same
 * campaign receive as "Previously…" context instead of the full transcript.
 */
import type { Message, SessionSummary, VaultPath } from './types'

export interface SessionRecap {
  path: VaultPath
  title: string
  created: string
  recap: string
}

export const RECAP_SYSTEM = `You compress a finished Dungeons & Dragons session into a recap the Dungeon Master will read before the next session.

Write exactly these three parts, in English unless the session is in another language:
1. One paragraph (at most 200 words), past tense, third person, of what happened, in order.
2. "Open threads:" followed by up to 6 short bullet points: unresolved hooks, promises, debts, goals and mysteries.
3. "Where things stand:" one or two sentences: where the party ended up, injuries, notable items gained or lost, allies and enemies made.

Keep every name exactly as written. Do not invent anything. No preamble.`

/** Used for the earlier pieces of a session too long to read in one request. */
export const RECAP_NOTES_SYSTEM =
  'You take running notes on a long Dungeons & Dragons session. Merge the new events into the notes so far: compact past-tense prose, at most 400 words, keeping names, places, discoveries, promises, open threads, injuries and items. Do not invent anything. Reply with the notes only.'

/** Messages that count for a recap: what the players and DM actually said. */
export function recapMessages(messages: Message[]): Message[] {
  return messages.filter((m) => !m.hidden && m.role !== 'image')
}

/** Too short to be worth an LLM call: needs a player turn and a few messages. */
export function isRecapWorthy(messages: Message[]): boolean {
  const visible = recapMessages(messages)
  return visible.length >= 3 && visible.some((m) => m.role === 'player')
}

/** True when messages were added (or changed at the end) since the recap was written. */
export function isRecapStale(recapUpto: string | undefined, messages: Message[]): boolean {
  const visible = recapMessages(messages)
  const last = visible[visible.length - 1]
  return !!last && last.id !== recapUpto
}

function orderKey(s: { path: string; created?: string }): string {
  // ISO dates sort as strings; the file name (which starts with a date) breaks ties.
  return `${s.created ?? ''}|${s.path.split('/').pop() ?? ''}`
}

/** Sessions of the same campaign that started before `current`, newest first. */
export function previousSessions(all: SessionSummary[], current: { path: string; campaignPath: string; created?: string }): SessionSummary[] {
  const key = orderKey(current)
  const campaign = current.campaignPath.toLowerCase()
  return all
    .filter((s) => s.campaignPath.toLowerCase() === campaign && s.path !== current.path && orderKey(s) < key)
    .sort((a, b) => orderKey(b).localeCompare(orderKey(a)))
}

/** Splits transcript lines into pieces of at most `maxChars` (a single huge line is cut). */
export function chunkLines(lines: string[], maxChars: number): string[] {
  const chunks: string[] = []
  let current = ''
  for (const raw of lines) {
    for (let i = 0; i < Math.max(1, raw.length); i += maxChars) {
      const line = raw.slice(i, i + maxChars)
      if (current && current.length + line.length + 2 > maxChars) {
        chunks.push(current)
        current = ''
      }
      current = current ? `${current}\n\n${line}` : line
    }
  }
  if (current) chunks.push(current)
  return chunks
}

/** The "Previous sessions" prompt block, oldest first. */
export function renderRecaps(recaps: SessionRecap[]): string {
  if (!recaps.length) return ''
  const parts = recaps.map((r) => `### ${r.title}\n${r.recap.trim()}`)
  return `Previously in this campaign (recaps of earlier sessions, oldest first):\n\n${parts.join('\n\n')}`
}
