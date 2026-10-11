import { create } from 'zustand'
import type { RollResult } from '@shared/types'

interface DiceFx {
  /** Roll currently animating in the overlay. */
  current: RollResult | null
  trayOpen: boolean
  setTrayOpen: (open: boolean) => void
  /** Shows the dice animation; resolves when it has finished. */
  play: (r: RollResult) => Promise<void>
}

let finish: (() => void) | null = null

export const useDiceFx = create<DiceFx>((set) => ({
  current: null,
  trayOpen: false,
  setTrayOpen: (trayOpen) => set({ trayOpen }),
  play: (r) =>
    new Promise<void>((resolve) => {
      finish?.()
      finish = () => {
        finish = null
        set({ current: null })
        resolve()
      }
      set({ current: r })
    })
}))

/** Called by the overlay when its animation ends (or immediately with reduced motion). */
export function finishDiceFx(): void {
  finish?.()
}
