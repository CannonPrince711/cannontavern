import { create } from 'zustand'

export type SettingsSection =
  | 'general'
  | 'appearance'
  | 'text'
  | 'images'
  | 'prompt'
  | 'security'
  | 'extensions'

interface UiStore {
  inspectorOpen: boolean
  /** Path of the lorebook open in the editor dialog. */
  editingLorebook: string | null
  /** Path of the character open in the editor dialog. */
  editingCharacter: string | null
  /** Chat pane shows the "new campaign" form. */
  creatingCampaign: boolean
  settingsOpen: boolean
  settingsSection: SettingsSection
  openSettings: (section?: SettingsSection) => void
  closeSettings: () => void
}

export const useUi = create<UiStore>((set) => ({
  inspectorOpen: false,
  editingLorebook: null,
  editingCharacter: null,
  creatingCampaign: false,
  settingsOpen: false,
  settingsSection: 'general',
  openSettings: (section) => set((s) => ({ settingsOpen: true, settingsSection: section ?? s.settingsSection })),
  closeSettings: () => set({ settingsOpen: false })
}))
