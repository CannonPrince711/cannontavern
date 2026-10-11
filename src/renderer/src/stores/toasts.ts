import { create } from 'zustand'
import type { ToastEvent } from '@shared/types'
import { on } from '@/lib/ipc'

export interface Toast extends ToastEvent {
  id: number
}

interface ToastStore {
  toasts: Toast[]
  push: (t: ToastEvent) => void
  dismiss: (id: number) => void
}

let nextId = 1

export const useToasts = create<ToastStore>((set, get) => ({
  toasts: [],
  push(t) {
    const id = nextId++
    set({ toasts: [...get().toasts.slice(-4), { ...t, id }] })
    // Errors (and toasts with a link) stay until dismissed.
    if (t.level !== 'error' && !t.link) setTimeout(() => get().dismiss(id), t.level === 'warning' ? 7000 : 4000)
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) })
  }
}))

export const toast = {
  info: (title: string, detail?: string) => useToasts.getState().push({ level: 'info', title, detail }),
  success: (title: string, detail?: string) => useToasts.getState().push({ level: 'success', title, detail }),
  warning: (title: string, detail?: string) => useToasts.getState().push({ level: 'warning', title, detail }),
  /** Shows an error (IpcError or anything thrown) with its details available to copy. */
  error: (err: unknown, title?: string) => {
    const e = err as { message?: string; code?: string; detail?: string }
    const message = e?.message ?? String(err)
    useToasts.getState().push({
      level: 'error',
      title: title ?? message,
      detail: [title ? message : null, e?.code ? `Code: ${e.code}` : null, e?.detail].filter(Boolean).join('\n\n') || undefined
    })
  }
}

/** Routes toasts sent by the main process into the store. */
export function subscribeMainToasts(): () => void {
  return on('toast', (t) => useToasts.getState().push(t))
}
