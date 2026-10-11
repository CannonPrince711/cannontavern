/**
 * Play modes: who writes which side of the story.
 *
 * - ai-dm    the AI is the Dungeon Master, you play your character (default)
 * - user-dm  you are the Dungeon Master, the AI plays the character
 * - ai-only  the AI plays both; you watch, steer with director's notes, or step in
 *
 * Messages keep their story role (dm / player) whoever wrote them, so a session
 * note reads the same in Obsidian and a session can switch modes at any time.
 */
import type { Message } from './types'

export const PLAY_MODES = ['ai-dm', 'user-dm', 'ai-only'] as const
export type PlayMode = (typeof PLAY_MODES)[number]

/** The story role the AI writes for a given reply. */
export type Speaker = 'dm' | 'player'

export const PLAY_MODE_INFO: Record<PlayMode, { label: string; short: string; description: string }> = {
  'ai-dm': { label: 'AI is the DM', short: 'AI is DM', description: 'You play your character; the AI runs the game.' },
  'user-dm': { label: 'You are the DM', short: 'You’re DM', description: 'You run the game; the AI plays the character.' },
  'ai-only': { label: 'AI only', short: 'AI only', description: 'The AI plays the DM and the character. Watch, steer or step in.' }
}

export function isPlayMode(v: unknown): v is PlayMode {
  return typeof v === 'string' && (PLAY_MODES as readonly string[]).includes(v)
}

export function playModeOf(fm: { mode?: PlayMode } | null | undefined): PlayMode {
  return fm?.mode ?? 'ai-dm'
}

/** Roles the AI writes in this mode. */
export function aiSpeakers(mode: PlayMode): Speaker[] {
  return mode === 'ai-dm' ? ['dm'] : mode === 'user-dm' ? ['player'] : ['dm', 'player']
}

/** The role of what the user types: their character, the DM, or a director's note. */
export function userRole(mode: PlayMode): 'player' | 'dm' | 'system' {
  return mode === 'ai-dm' ? 'player' : mode === 'user-dm' ? 'dm' : 'system'
}

/**
 * Who the AI should write as next. In AI-only play the turns alternate: the
 * character answers the DM, and the DM answers the character or a dice roll.
 */
export function nextSpeaker(mode: PlayMode, messages: Message[]): Speaker {
  if (mode === 'ai-dm') return 'dm'
  if (mode === 'user-dm') return 'player'
  const last = [...messages].reverse().find((m) => !m.hidden && (m.role === 'dm' || m.role === 'player' || m.role === 'roll'))
  return last?.role === 'dm' ? 'player' : 'dm'
}

/** The newest message the AI wrote (for swipes and Continue). */
export function lastAiMessage(mode: PlayMode, messages: Message[]): Message | undefined {
  const roles: string[] = aiSpeakers(mode)
  return [...messages].reverse().find((m) => roles.includes(m.role))
}

export const CHECK_RE = /\[CHECK\s+([a-z ]+?)\s+DC\s*(\d+)\]/gi

/** "[CHECK perception DC 13]" requests in a message. */
export function findChecks(text: string): { target: string; dc: number }[] {
  return [...text.matchAll(new RegExp(CHECK_RE.source, 'gi'))].map((m) => ({ target: m[1]!.trim(), dc: Number(m[2]) }))
}
