import { create } from 'zustand'
import type { CampaignSummary, VaultIndex } from '@shared/types'
import { invoke, on } from '@/lib/ipc'

const ACTIVE_CAMPAIGN_KEY = 'dnd-tavern:active-campaign'

function readStored(): string | null {
  try {
    return localStorage.getItem(ACTIVE_CAMPAIGN_KEY)
  } catch {
    return null
  }
}

interface VaultStore {
  index: VaultIndex | null
  loaded: boolean
  /** Folder path of the campaign shown in the sidebar and title bar. */
  activeCampaign: string | null
  selectedCharacter: string | null
  selectedSession: string | null
  init: () => Promise<() => void>
  setIndex: (index: VaultIndex | null) => void
  setActiveCampaign: (path: string | null) => void
  selectCharacter: (path: string | null) => void
  selectSession: (path: string | null) => void
}

/** Picks a valid active campaign: the stored one if it still exists, else the first. */
function resolveCampaign(index: VaultIndex | null, wanted: string | null): string | null {
  if (!index || index.campaigns.length === 0) return null
  const match = index.campaigns.find((c) => c.path.toLowerCase() === wanted?.toLowerCase())
  return (match ?? index.campaigns[0])!.path
}

export const useVault = create<VaultStore>((set, get) => ({
  index: null,
  loaded: false,
  activeCampaign: null,
  selectedCharacter: null,
  selectedSession: null,

  async init() {
    get().setIndex(await invoke('vault:getIndex'))
    set({ loaded: true })
    return on('vault:index', (index) => get().setIndex(index))
  },

  setIndex(index) {
    const activeCampaign = resolveCampaign(index, get().activeCampaign ?? readStored())
    const exists = (list: { path: string }[] | undefined, p: string | null): string | null =>
      p && list?.some((x) => x.path === p) ? p : null
    set({
      index,
      activeCampaign,
      selectedCharacter: exists(index?.characters.concat(index.npcs), get().selectedCharacter),
      selectedSession: exists(index?.sessions, get().selectedSession)
    })
  },

  setActiveCampaign(path) {
    try {
      if (path) localStorage.setItem(ACTIVE_CAMPAIGN_KEY, path)
    } catch {
      /* layout memory only */
    }
    set({ activeCampaign: path })
  },

  selectCharacter: (selectedCharacter) => set({ selectedCharacter }),
  selectSession: (selectedSession) => set({ selectedSession })
}))

export function useActiveCampaign(): CampaignSummary | null {
  return useVault((s) => s.index?.campaigns.find((c) => c.path === s.activeCampaign) ?? null)
}

/** URL for an image inside the root folder, served by the vault:// protocol. */
export function vaultUrl(path: string, bust?: number): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  return `vault://file/${encoded}${bust ? `?v=${Math.round(bust)}` : ''}`
}
