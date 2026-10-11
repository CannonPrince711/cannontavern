/**
 * Mode-aware sending and AI-only auto-play.
 *
 * - You are DM: a message with "[CHECK perception DC 13]" rolls the check for
 *   the character (with dice) instead of asking the AI, so you narrate the result.
 * - AI only: "Next turn" asks for one reply; Auto-play keeps going for a set
 *   number of turns, rolling any checks the DM asks for along the way.
 */
import { create } from 'zustand'
import { findChecks, playModeOf } from '@shared/play'
import { on } from '@/lib/ipc'
import { useApp } from '@/stores/app'
import { useChat } from '@/stores/chat'
import { toast } from '@/stores/toasts'
import { rollCheckFor } from './rolls'

/** Rolls the checks a DM message asks for, if the last message is one with open checks. */
async function rollPendingChecks(): Promise<boolean> {
  const session = useChat.getState().session
  const last = session?.messages[session.messages.length - 1]
  if (!last || last.role !== 'dm') return false
  const checks = findChecks(last.text)
  for (const c of checks) await rollCheckFor(c.target, c.dc)
  return checks.length > 0
}

/** Sends what the user typed, in their role for the session's mode. */
export async function submitMessage(text: string): Promise<void> {
  const chat = useChat.getState()
  const session = chat.session
  if (!session) return
  const mode = playModeOf(session.frontmatter)
  if (mode === 'user-dm' && text) {
    const checks = findChecks(text)
    if (checks.length) {
      // Post the DM's request, roll for the character, and leave the narration to the DM.
      await chat.post({ role: 'dm', text, swipes: [text], swipeIndex: 0 })
      for (const c of checks) await rollCheckFor(c.target, c.dc)
      return
    }
  }
  if (mode === 'ai-only' && !text) {
    await nextTurn()
    return
  }
  await chat.send(text)
}

/** AI-only: one more turn (rolling open checks first, so the DM narrates the result). */
export async function nextTurn(): Promise<void> {
  if (useChat.getState().streaming) return
  try {
    await rollPendingChecks()
  } catch (err) {
    toast.error(err, 'Could not roll the check')
  }
  await useChat.getState().send('')
}

interface AutoplayStore {
  /** Turns left in the current run; 0 when stopped. */
  left: number
  sessionPath: string | null
  start: (turns?: number) => void
  stop: () => void
}

let timer: ReturnType<typeof setTimeout> | undefined

export const useAutoplay = create<AutoplayStore>((set, get) => ({
  left: 0,
  sessionPath: null,
  start(turns) {
    const session = useChat.getState().session
    if (!session) return
    const n = turns ?? useApp.getState().settings?.play.autoplayTurns ?? 10
    set({ left: n, sessionPath: session.path })
    if (!useChat.getState().streaming) step()
  },
  stop() {
    clearTimeout(timer)
    set({ left: 0, sessionPath: null })
  }
}))

function step(): void {
  const { left, sessionPath } = useAutoplay.getState()
  const session = useChat.getState().session
  if (left <= 0 || !session || session.path !== sessionPath || playModeOf(session.frontmatter) !== 'ai-only') {
    useAutoplay.getState().stop()
    return
  }
  useAutoplay.setState({ left: left - 1 })
  void nextTurn()
}

/** Wires auto-play to chat events; call once at startup. */
export function initAutoplay(): () => void {
  const offs = [
    on('chat:done', () => {
      if (useAutoplay.getState().left <= 0) return
      const delay = (useApp.getState().settings?.play.autoplayDelaySec ?? 2) * 1000
      clearTimeout(timer)
      timer = setTimeout(step, delay)
    }),
    on('chat:error', () => useAutoplay.getState().stop())
  ]
  // Switching sessions ends a run.
  const unsub = useChat.subscribe((s, prev) => {
    if (s.session?.path !== prev.session?.path && useAutoplay.getState().left > 0) useAutoplay.getState().stop()
  })
  return () => {
    offs.forEach((off) => off())
    unsub()
    useAutoplay.getState().stop()
  }
}
