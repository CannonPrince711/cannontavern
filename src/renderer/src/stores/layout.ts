import { create } from 'zustand'

export type RightTab = 'sheet' | 'combat' | 'lore' | 'images' | 'graph' | 'table' | 'extensions'

interface LayoutStore {
  leftCollapsed: boolean
  rightCollapsed: boolean
  rightTab: RightTab
  setLeftCollapsed: (v: boolean) => void
  setRightCollapsed: (v: boolean) => void
  toggleLeft: () => void
  toggleRight: () => void
  setRightTab: (tab: RightTab) => void
}

export const useLayout = create<LayoutStore>((set) => ({
  leftCollapsed: false,
  rightCollapsed: false,
  rightTab: 'sheet',
  setLeftCollapsed: (leftCollapsed) => set({ leftCollapsed }),
  setRightCollapsed: (rightCollapsed) => set({ rightCollapsed }),
  toggleLeft: () => set((s) => ({ leftCollapsed: !s.leftCollapsed })),
  toggleRight: () => set((s) => ({ rightCollapsed: !s.rightCollapsed })),
  setRightTab: (rightTab) => set({ rightTab })
}))
