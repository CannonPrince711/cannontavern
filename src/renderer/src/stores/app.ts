import { create } from 'zustand'
import type { PublicSettings, SettingsPatch } from '@shared/settings'
import type { AppInfo, WindowState } from '@shared/types'
import { invoke, on } from '@/lib/ipc'

interface AppStore {
  ready: boolean
  info: AppInfo | null
  settings: PublicSettings | null
  window: WindowState
  /** Loads everything the shell needs and subscribes to main-process events. */
  init: () => Promise<() => void>
  updateSettings: (patch: SettingsPatch) => Promise<void>
}

export const useApp = create<AppStore>((set, get) => ({
  ready: false,
  info: null,
  settings: null,
  window: { maximized: false, focused: true },

  async init() {
    const [info, settings, windowState] = await Promise.all([
      invoke('app:getInfo'),
      invoke('settings:get'),
      invoke('window:getState')
    ])
    set({ info, settings, window: windowState, ready: true })
    const offs = [
      on('settings:changed', (s) => set({ settings: s })),
      on('window:state', (w) => set({ window: w }))
    ]
    return () => offs.forEach((off) => off())
  },

  async updateSettings(patch) {
    const prev = get().settings
    if (prev) {
      // Optimistic: merge section objects locally so the UI reacts instantly.
      const next = { ...prev } as Record<string, unknown>
      for (const [k, v] of Object.entries(patch)) {
        const cur = next[k]
        next[k] = v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' ? { ...cur, ...v } : v
      }
      set({ settings: next as unknown as PublicSettings })
    }
    try {
      set({ settings: await invoke('settings:update', patch) })
    } catch (err) {
      set({ settings: prev })
      throw err
    }
  }
}))
