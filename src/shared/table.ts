/**
 * Multiplayer ("the table"): the host's app runs a small game server; players
 * join from a browser with a code, claim a character, and act as it. This file
 * holds the wire protocol and what players are allowed to see.
 */
import type { Edition } from './editions'
import type { PlayMode } from './play'
import type { Message, RollResult } from './types'

export const TABLE_DEFAULT_PORT = 7777

/** Who acts next when a player speaks (in AI-DM sessions). */
export type AutoRespond = 'each' | 'all' | 'manual'

export const AUTO_RESPOND_INFO: Record<AutoRespond, string> = {
  each: 'The DM answers every player message',
  all: 'The DM answers once every player has acted',
  manual: 'The DM answers when you send from your screen'
}

/** A message as players see it (no hidden notes, no machine data). */
export interface TableMessage {
  id: string
  role: Message['role']
  name?: string
  text: string
  roll?: RollResult
  /** For images: a URL on the host. */
  imageUrl?: string
  createdAt: string
}

/** What players may see of a character: enough to play, nothing private. */
export interface TableCharacter {
  path: string
  name: string
  avatarUrl?: string
  race: string
  class: string
  level: number
  hp: number
  max_hp: number
  temp_hp: number
  ac: number
  conditions: string[]
  edition: Edition
  /** Roll buttons: skills and saves with their totals. */
  checks: { target: string; label: string; bonus: number; kind: 'skill' | 'save' | 'ability' }[]
  /** Player id that claimed it, if any. */
  claimedBy?: string
}

export interface TablePlayer {
  id: string
  name: string
  characterPath?: string
  connected: boolean
}

export interface TableState {
  sessionTitle: string | null
  campaignName: string | null
  mode: PlayMode
  messages: TableMessage[]
  party: TableCharacter[]
  /** Characters players can still claim. */
  available: { path: string; name: string }[]
  players: TablePlayer[]
  /** The DM is writing (for a typing indicator). */
  busy: boolean
}

// ── Wire messages ───────────────────────────────────────────────────────────

export type ClientMessage =
  | { type: 'hello'; code: string; name: string; token?: string; view?: 'player' | 'screen' }
  | { type: 'claim'; characterPath: string | null }
  | { type: 'say'; text: string }
  | { type: 'check'; target: string; dc?: number }
  | { type: 'roll'; expr: string }
  | { type: 'ping' }

export type ServerMessage =
  | { type: 'welcome'; token: string; you: TablePlayer; state: TableState }
  | { type: 'state'; state: TableState }
  | { type: 'stream'; text: string; speaker: 'dm' | 'player'; speakerName?: string }
  | { type: 'stream-end' }
  | { type: 'error'; message: string }
  | { type: 'kicked'; reason: string }
  | { type: 'pong' }

/** Host-side status shown on the DM screen. */
export interface TableStatus {
  hosting: boolean
  scope: 'local' | 'network'
  port: number
  code: string
  /** Join links (one per network address). */
  urls: string[]
  /** Public join link through Tailscale Funnel, while it's on. */
  publicUrl?: string
  sessionPath: string | null
  autoRespond: AutoRespond
  players: TablePlayer[]
}

/** Messages players can see: no hidden notes and no sheet-change details. */
export function playerSafe(messages: Message[], imageUrl: (file: string) => string | undefined): TableMessage[] {
  return messages
    .filter((m) => !m.hidden)
    .map((m) => ({
      id: m.id,
      role: m.role,
      ...(m.name ? { name: m.name } : {}),
      text: m.role === 'image' ? '' : m.text,
      ...(m.roll ? { roll: m.roll } : {}),
      ...(m.role === 'image' && m.image?.file ? { imageUrl: imageUrl(m.image.file) } : {}),
      createdAt: m.createdAt
    }))
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** A join code like "K7QF-2M9X" from random bytes (no 0/O/1/I). */
export function makeJoinCode(bytes: Uint8Array): string {
  const chars = [...bytes.slice(0, 8)].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length])
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}`
}

/** Codes compare case-insensitively and ignore the dash. */
export function sameCode(a: string, b: string): boolean {
  const norm = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return norm(a).length === 8 && norm(a) === norm(b)
}

/** True when every connected player with a character has spoken since the DM last did. */
export function everyoneActed(messages: Message[], players: TablePlayer[], nameOf: (path: string) => string | undefined): boolean {
  const acting = players.filter((p) => p.connected && p.characterPath).map((p) => nameOf(p.characterPath!)).filter((n): n is string => !!n)
  if (!acting.length) return false
  const lastDm = messages.map((m) => m.role).lastIndexOf('dm')
  const since = messages.slice(lastDm + 1).filter((m) => m.role === 'player' && !m.hidden)
  return acting.every((name) => since.some((m) => m.name === name))
}
