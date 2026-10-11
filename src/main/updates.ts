/**
 * Opt-in update check (Settings → General → Check for updates). Asks the
 * GitHub Releases API for the latest tag and shows a toast with a download
 * link when it is newer. Nothing is downloaded or installed automatically.
 */
import { app } from 'electron'
import { isNewer } from '@shared/version'
import { readJson, request } from './http'
import { send } from './ipc'
import { settingsStore } from './settings-store'
import { getMainWindow } from './window'

export const RELEASES_REPO = 'CannonPrince711/cannontavern'

export async function checkForUpdates(): Promise<void> {
  const settings = settingsStore.get()
  if (!settings.behavior.autoUpdateCheck) return
  try {
    const { res, deadline } = await request(
      { headers: {}, proxy: '', allowSelfSigned: false, timeoutMs: 15_000, retries: 0 },
      {
        url: `https://api.github.com/repos/${RELEASES_REPO}/releases/latest`,
        method: 'GET',
        headers: { accept: 'application/vnd.github+json', 'user-agent': `DND-Tavern/${app.getVersion()}` }
      }
    )
    const release = (await readJson(res, deadline)) as { tag_name?: string; html_url?: string; draft?: boolean; prerelease?: boolean }
    if (!release.tag_name || release.draft || release.prerelease || !isNewer(release.tag_name, app.getVersion())) return
    send(getMainWindow(), 'toast', {
      level: 'info',
      title: `DND Tavern ${release.tag_name.replace(/^v/i, '')} is available`,
      detail: `You have ${app.getVersion()}.`,
      link: { label: 'Open the download page', url: release.html_url ?? `https://github.com/${RELEASES_REPO}/releases/latest` }
    })
  } catch (err) {
    // Offline, rate-limited or no releases yet: stay quiet.
    console.warn('[updates] check failed:', (err as Error).message)
  }
}
