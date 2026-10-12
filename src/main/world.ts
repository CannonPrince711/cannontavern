/**
 * Settings as a campaign sees them: the global settings with the campaign's
 * `world:` overrides applied (see shared/world.ts). Uses the vault index, so
 * it is synchronous and cheap.
 */
import { classifyPath } from '@shared/layout'
import type { Settings } from '@shared/settings'
import type { VaultPath } from '@shared/types'
import { applyWorld, type WorldOverrides } from '@shared/world'
import { settingsStore } from './settings-store'
import { vaultService } from './vault/service'

/** A campaign's overrides, or undefined for none (or no campaign). */
export function worldOf(campaignPath: VaultPath | null | undefined): WorldOverrides | undefined {
  if (!campaignPath) return undefined
  const k = campaignPath.toLowerCase()
  return vaultService.getIndex()?.campaigns.find((c) => c.path.toLowerCase() === k)?.world
}

/** The campaign folder a session note belongs to. */
export function campaignOfSession(sessionPath: VaultPath | null | undefined): VaultPath | null {
  if (!sessionPath) return null
  const index = vaultService.getIndex()
  const k = sessionPath.toLowerCase()
  const known = index?.sessions.find((s) => s.path.toLowerCase() === k)?.campaignPath
  if (known) return known
  const root = vaultService.vault?.rootFolder
  return root ? (classifyPath(root, sessionPath)?.campaignPath ?? null) : null
}

/** Global settings with the campaign's overrides. */
export function settingsFor(campaignPath: VaultPath | null | undefined): Settings {
  return applyWorld(settingsStore.get(), worldOf(campaignPath))
}

/** Global settings with the overrides of the session's campaign. */
export function settingsForSession(sessionPath: VaultPath | null | undefined): Settings {
  return settingsFor(campaignOfSession(sessionPath))
}

/** Whether any world (or the global setting) paints portraits automatically. */
export function anyAutoPortraits(): boolean {
  if (settingsStore.get().imageTriggers.autoPortraits) return true
  return !!vaultService.getIndex()?.campaigns.some((c) => c.world?.auto_portraits)
}
