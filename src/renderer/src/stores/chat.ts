import { create } from 'zustand'
import type { MessagePatch } from '@shared/ipc'
import type { ErrorInfo, Message, Session } from '@shared/types'
import { aiSpeakers, playModeOf, type Speaker } from '@shared/play'
import { invoke, on } from '@/lib/ipc'
import { toast } from './toasts'

export interface Streaming {
  requestId: string
  kind: 'new' | 'swipe' | 'continue'
  /** Set once the main process reports which message is being written. */
  messageId: string | null
  backendName: string
  /** Which story role the AI is writing (known once the main process starts). */
  speaker: Speaker | null
  speakerName?: string
  text: string
}

interface ChatStore {
  session: Session | null
  loading: boolean
  streaming: Streaming | null
  lastError: ErrorInfo | null
  init: () => () => void
  open: (path: string | null) => Promise<void>
  send: (text: string, speaker?: Speaker) => Promise<void>
  regenerate: () => Promise<void>
  continueReply: () => Promise<void>
  stop: () => Promise<void>
  swipe: (id: string, dir: -1 | 1) => Promise<void>
  edit: (id: string, patch: MessagePatch) => Promise<void>
  remove: (id: string) => Promise<void>
  fork: (id: string) => Promise<Session | null>
  post: (message: Omit<Message, 'id' | 'createdAt'>) => Promise<void>
}

export const useChat = create<ChatStore>((set, get) => {
  const start = async (kind: Streaming['kind'], call: () => Promise<{ requestId: string }>): Promise<void> => {
    if (get().streaming) return
    // Reserve the slot before the request so tokens arriving early have a home.
    set({ streaming: { requestId: '', kind, messageId: null, backendName: '', speaker: null, text: '' }, lastError: null })
    try {
      const { requestId } = await call()
      const s = get().streaming
      if (s && !s.requestId) set({ streaming: { ...s, requestId } })
    } catch (err) {
      set({ streaming: null })
      toast.error(err)
    }
  }

  const guard = async (fn: () => Promise<Session>): Promise<void> => {
    try {
      set({ session: await fn() })
    } catch (err) {
      toast.error(err)
    }
  }

  return {
    session: null,
    loading: false,
    streaming: null,
    lastError: null,

    init() {
      const mine = (id: string): boolean => {
        const s = get().streaming
        return !!s && (s.requestId === id || s.requestId === '')
      }
      const offs = [
        on('chat:started', (e) => {
          const s = get().streaming
          if (s && mine(e.requestId)) set({ streaming: { ...s, requestId: e.requestId, messageId: e.messageId, backendName: e.backendName, speaker: e.speaker, speakerName: e.speakerName } })
        }),
        on('chat:token', (e) => {
          const s = get().streaming
          if (s && mine(e.requestId)) set({ streaming: { ...s, requestId: e.requestId, text: s.text + e.delta } })
        }),
        on('chat:done', (e) => {
          if (!mine(e.requestId)) return
          set({ streaming: null, session: get().session?.path === e.session.path ? e.session : get().session })
        }),
        on('chat:error', (e) => {
          if (!mine(e.requestId)) return
          set({ streaming: null, lastError: e.error })
          toast.error(e.error, 'The AI couldn’t answer')
          // Partial text may have been saved; refresh.
          const path = get().session?.path
          if (path) void invoke('sessions:get', path).then((session) => set({ session })).catch(() => {})
        }),
        on('session:updated', (session) => {
          if (get().session?.path === session.path) set({ session })
        })
      ]
      return () => offs.forEach((off) => off())
    },

    async open(path) {
      if (!path) {
        set({ session: null })
        return
      }
      if (get().session?.path === path) return
      set({ loading: true })
      try {
        set({ session: await invoke('sessions:get', path), lastError: null })
      } catch (err) {
        toast.error(err, 'Could not open the session')
        set({ session: null })
      } finally {
        set({ loading: false })
      }
    },

    async send(text, speaker) {
      const session = get().session
      if (!session) return
      await start('new', () => invoke('chat:send', { sessionPath: session.path, text, ...(speaker ? { speaker } : {}) }))
    },

    async regenerate() {
      const session = get().session
      if (!session) return
      const last = session.messages[session.messages.length - 1]
      const ai: string[] = aiSpeakers(playModeOf(session.frontmatter))
      await start(last && ai.includes(last.role) ? 'swipe' : 'new', () => invoke('chat:regenerate', { sessionPath: session.path }))
    },

    async continueReply() {
      const session = get().session
      if (!session) return
      await start('continue', () => invoke('chat:continue', { sessionPath: session.path }))
    },

    async stop() {
      const s = get().streaming
      if (s?.requestId) await invoke('chat:stop', s.requestId).catch(() => {})
    },

    async swipe(id, dir) {
      const session = get().session
      const m = session?.messages.find((x) => x.id === id)
      if (!session || !m || get().streaming) return
      const next = m.swipeIndex + dir
      const isLast = session.messages[session.messages.length - 1]?.id === id
      if (next >= m.swipes.length) {
        // Past the last swipe on the newest reply: write a new one.
        if (isLast && (aiSpeakers(playModeOf(session.frontmatter)) as string[]).includes(m.role)) await get().regenerate()
        return
      }
      if (next < 0) return
      // Optimistic flip, then persist.
      set({
        session: {
          ...session,
          messages: session.messages.map((x) => (x.id === id ? { ...x, swipeIndex: next, text: x.swipes[next] ?? x.text } : x))
        }
      })
      await guard(() => invoke('sessions:updateMessage', session.path, id, { swipeIndex: next }))
    },

    async edit(id, patch) {
      const session = get().session
      if (!session) return
      await guard(() => invoke('sessions:updateMessage', session.path, id, patch))
    },

    async remove(id) {
      const session = get().session
      if (!session) return
      await guard(() => invoke('sessions:deleteMessage', session.path, id))
    },

    async fork(id) {
      const session = get().session
      if (!session) return null
      try {
        const forked = await invoke('sessions:fork', session.path, id)
        toast.success('Session forked', forked.frontmatter.title)
        return forked
      } catch (err) {
        toast.error(err)
        return null
      }
    },

    async post(message) {
      const session = get().session
      if (!session) return
      await guard(() => invoke('sessions:post', session.path, message))
    }
  }
})
