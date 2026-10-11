import { useEffect, useRef, useState } from 'react'
import type { Message } from '@shared/types'
import { invoke } from '@/lib/ipc'
import { useChat } from '@/stores/chat'
import { useExtensions } from '@/stores/extensions'
import { toast } from '@/stores/toasts'

const THEME_VARS = ['--background', '--foreground', '--card', '--border', '--input', '--primary', '--primary-foreground', '--secondary', '--muted-foreground', '--gold']

function themeVars(): Record<string, string> {
  const css = getComputedStyle(document.documentElement)
  return Object.fromEntries(THEME_VARS.map((v) => [v, css.getPropertyValue(v).trim()]))
}

interface BridgeMessage {
  __tavern: true
  type: string
  payload?: unknown
  id?: number
}

/**
 * Hosts an extension's ui.js in a sandboxed iframe (opaque origin, scripts
 * only). It can't reach window.api; it talks to us through postMessage, and
 * can only notify, run its own commands, and read its context.
 */
export function ExtensionFrame({ extensionId, name, mode }: { extensionId: string; name: string; mode: 'panel' | 'worker' }): React.JSX.Element {
  const frame = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(mode === 'worker' ? 0 : 160)
  const sessionPath = useChat((s) => s.session?.path)
  const messages = useChat((s) => s.session?.messages)
  const stateVersion = useExtensions((s) => s.stateVersion)
  const ready = useRef(false)
  const decorated = useRef(new Set<string>())

  const post = (msg: Omit<BridgeMessage, '__tavern'>): void => frame.current?.contentWindow?.postMessage({ __tavern: true, ...msg }, '*')

  const pushState = async (): Promise<void> => {
    if (!ready.current) return
    try {
      const state = await invoke('extensions:uiState', extensionId, sessionPath)
      post({ type: 'state', payload: { ...(state as object), theme: themeVars() } })
    } catch {
      /* extension disabled meanwhile */
    }
  }

  // Ask the worker frame to decorate DM messages it hasn't seen.
  const decorate = (list: Message[] | undefined): void => {
    if (mode !== 'worker' || !ready.current || !list) return
    for (const m of list) {
      const key = `${m.id}:${m.text.length}`
      if (m.role !== 'dm' || decorated.current.has(key)) continue
      decorated.current.add(key)
      post({ type: 'decorate', payload: { extensionId, message: { id: m.id, role: m.role, text: m.text, name: m.name } } })
    }
  }

  useEffect(() => {
    const onMessage = (ev: MessageEvent): void => {
      if (ev.source !== frame.current?.contentWindow) return
      const m = ev.data as BridgeMessage
      if (!m || m.__tavern !== true) return
      switch (m.type) {
        case 'ready':
          ready.current = true
          void refresh(true)
          break
        case 'resize':
          if (mode === 'panel') setHeight(Math.min(900, Math.max(60, Number(m.payload) || 0)))
          break
        case 'notify':
          toast.info(String(m.payload).slice(0, 300), name)
          break
        case 'error':
          toast.error({ message: String(m.payload) }, `${name}: UI failed`)
          break
        case 'decoration': {
          const p = m.payload as { messageId: string; text: string }
          useExtensions.setState((s) => ({ decorations: { ...s.decorations, [p.messageId]: { ...(s.decorations[p.messageId] ?? {}), [extensionId]: p.text.slice(0, 200) } } }))
          break
        }
        case 'runCommand': {
          const p = m.payload as { command: string; args: string }
          const session = useChat.getState().session
          invoke('extensions:runCommand', { extensionId, command: String(p.command), args: String(p.args ?? ''), sessionPath: session?.path })
            .then(() => {
              post({ type: 'reply', id: m.id, payload: null })
              useExtensions.setState((s) => ({ stateVersion: s.stateVersion + 1 }))
            })
            .catch((err: Error) => post({ type: 'reply', id: m.id, payload: null, ...({ error: err.message } as object) }))
          break
        }
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [extensionId, name, mode, sessionPath]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Always send fresh state before asking for decorations; otherwise a worker
   * could decorate a new session's messages with the previous session's state.
   */
  const refresh = async (redecorate: boolean): Promise<void> => {
    if (!ready.current) return
    await pushState()
    if (redecorate) decorated.current.clear()
    decorate(useChat.getState().session?.messages)
  }

  useEffect(() => {
    void refresh(true)
  }, [sessionPath, stateVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void refresh(false)
  }, [messages]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <iframe
      ref={frame}
      title={`${name} ${mode}`}
      src={`ext://${extensionId}/panel.html${mode === 'worker' ? '?mode=worker' : ''}`}
      sandbox="allow-scripts"
      className={mode === 'worker' ? 'hidden' : 'w-full rounded-lg border-0 bg-transparent'}
      style={mode === 'panel' ? { height } : undefined}
      aria-hidden={mode === 'worker'}
    />
  )
}
