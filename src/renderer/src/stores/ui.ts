import { create } from 'zustand'

export type SettingsSection =
  | 'general'
  | 'updates'
  | 'appearance'
  | 'text'
  | 'images'
  | 'prompt'
  | 'tts'
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
  /** The campaign builder dialog is open. */
  buildingCampaign: boolean
  /** The universes dialog is open. */
  managingUniverses: boolean
  /** Campaign folder whose settings dialog is open. */
  campaignSettings: string | null
  /** Which tab that dialog opens on. */
  campaignSettingsTab: 'campaign' | 'world'
  settingsOpen: boolean
  settingsSection: SettingsSection
  paletteOpen: boolean
  /** Text pushed into the chat composer (from the command palette); n changes on every push. */
  composerPrefill: { text: string; n: number } | null
  prefillComposer: (text: string) => void
  openSettings: (section?: SettingsSection) => void
  closeSettings: () => void
}

export const useUi = create<UiStore>((set) => ({
  inspectorOpen: false,
  editingLorebook: null,
  editingCharacter: null,
  creatingCampaign: false,
  buildingCampaign: false,
  managingUniverses: false,
  campaignSettings: null,
  campaignSettingsTab: 'campaign',
  settingsOpen: false,
  settingsSection: 'general',
  paletteOpen: false,
  composerPrefill: null,
  prefillComposer: (text) => set((s) => ({ composerPrefill: { text, n: (s.composerPrefill?.n ?? 0) + 1 } })),
  openSettings: (section) => set((s) => ({ settingsOpen: true, settingsSection: section ?? s.settingsSection })),
  closeSettings: () => set({ settingsOpen: false })
}))
