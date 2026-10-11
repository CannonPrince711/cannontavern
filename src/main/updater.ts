/**
 * In-app updates from GitHub Releases.
 *
 * Installed Windows builds (NSIS) and Linux AppImages update themselves with
 * electron-updater: check, download in the background, then restart to
 * install (or install on quit). Portable, .deb and dev builds can't replace
 * themselves, so they get a link to the release page instead.
 */
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '@shared/types'
import { isNewer } from '@shared/version'
import { toErrorInfo } from './errors'
import { readJson, request } from './http'
import { send } from './ipc'
import { openExternalSafe } from './security'
import { settingsStore } from './settings-store'
import { getMainWindow } from './window'

export const RELEASES_REPO = 'CannonPrince711/cannontavern'
const RELEASES_URL = `https://github.com/${RELEASES_REPO}/releases/latest`

function friendly(err: unknown): string {
  const msg = toErrorInfo(err).message
  if (/404|not found|no published versions|latest\.yml/i.test(msg)) {
    return 'No published release was found. Releases have to be public (a private repository needs its releases made public) and include latest.yml, which “npm run release” uploads.'
  }
  if (/net::|ENOTFOUND|ECONN|ETIMEDOUT|network/i.test(msg)) return 'Couldn’t reach GitHub. Check your internet connection.'
  return msg
}

class Updater {
  status: UpdateStatus = { state: 'idle' }
  private wired = false
  private latestUrl = RELEASES_URL

  /** NSIS installs and AppImages can replace themselves; portable, .deb and dev builds can't. */
  get canSelfUpdate(): boolean {
    if (!app.isPackaged) return false
    if (process.platform === 'linux') return !!process.env['APPIMAGE']
    return !process.env['PORTABLE_EXECUTABLE_DIR']
  }

  /** Read through a method: event handlers change the status while checks are awaited. */
  private current(): UpdateStatus['state'] {
    return this.status.state
  }

  private set(status: UpdateStatus): void {
    this.status = status
    send(getMainWindow(), 'updates:changed', status)
  }

  private wire(): void {
    if (this.wired || !this.canSelfUpdate) return
    this.wired = true
    autoUpdater.logger = null
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('update-available', (info) => {
      this.set({ state: 'available', version: info.version, canInstall: true, notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined })
    })
    autoUpdater.on('update-not-available', () => this.set({ state: 'none', checkedAt: new Date().toISOString() }))
    autoUpdater.on('download-progress', (p) => {
      const version = this.status.state === 'downloading' || this.status.state === 'available' ? this.status.version : ''
      this.set({ state: 'downloading', version, percent: Math.round(p.percent) })
    })
    autoUpdater.on('update-downloaded', (info) => {
      this.set({ state: 'ready', version: info.version })
      send(getMainWindow(), 'toast', { level: 'success', title: `DND Tavern ${info.version} is ready`, detail: 'Restart to update now, or it installs when you quit.' })
    })
    autoUpdater.on('error', (err) => this.set({ state: 'error', message: friendly(err) }))
  }

  /** Checks for a newer release. `manual` surfaces errors; startup checks stay quiet. */
  async check(manual: boolean): Promise<UpdateStatus> {
    if (this.status.state === 'checking' || this.status.state === 'downloading') return this.status
    this.set({ state: 'checking' })
    try {
      if (this.canSelfUpdate) {
        this.wire()
        autoUpdater.autoDownload = settingsStore.get().behavior.autoDownloadUpdates
        const result = await autoUpdater.checkForUpdates()
        const version = result?.updateInfo.version
        // The updater's events may already have moved the state on while we awaited.
        const stillChecking = this.current() === 'checking'
        if (version && isNewer(version, app.getVersion())) {
          if (stillChecking) this.set({ state: 'available', version, canInstall: true })
        } else if (stillChecking) this.set({ state: 'none', checkedAt: new Date().toISOString() })
      } else {
        await this.checkGitHub()
      }
      if (this.status.state === 'available' && !manual) {
        const s = this.status
        send(getMainWindow(), 'toast', {
          level: 'info',
          title: `DND Tavern ${s.version} is available`,
          detail: s.canInstall ? 'Use the update button in the title bar to install it.' : `You have ${app.getVersion()}.`,
          ...(s.canInstall ? {} : { link: { label: 'Open the download page', url: s.url ?? RELEASES_URL } })
        })
      }
    } catch (err) {
      if (manual) this.set({ state: 'error', message: friendly(err) })
      else {
        console.warn('[updates] check failed:', toErrorInfo(err).message)
        this.set({ state: 'idle' })
      }
    }
    return this.status
  }

  /** Portable/dev builds: compare against the latest release via the GitHub API. */
  private async checkGitHub(): Promise<void> {
    const { res, deadline } = await request(
      { headers: {}, proxy: '', allowSelfSigned: false, timeoutMs: 15_000, retries: 0 },
      {
        url: `https://api.github.com/repos/${RELEASES_REPO}/releases/latest`,
        method: 'GET',
        headers: { accept: 'application/vnd.github+json', 'user-agent': `DND-Tavern/${app.getVersion()}` }
      }
    )
    const release = (await readJson(res, deadline)) as { tag_name?: string; html_url?: string; body?: string; draft?: boolean; prerelease?: boolean }
    if (release.tag_name && !release.draft && !release.prerelease && isNewer(release.tag_name, app.getVersion())) {
      this.latestUrl = release.html_url ?? RELEASES_URL
      this.set({ state: 'available', version: release.tag_name.replace(/^v/i, ''), canInstall: false, url: this.latestUrl, notes: release.body })
    } else this.set({ state: 'none', checkedAt: new Date().toISOString() })
  }

  async download(): Promise<void> {
    if (!this.canSelfUpdate) {
      await openExternalSafe(this.latestUrl)
      return
    }
    if (this.status.state !== 'available' && this.status.state !== 'error') return
    const version = this.status.state === 'available' ? this.status.version : ''
    this.set({ state: 'downloading', version, percent: 0 })
    try {
      await autoUpdater.downloadUpdate()
    } catch (err) {
      this.set({ state: 'error', message: friendly(err) })
    }
  }

  install(): void {
    if (this.status.state === 'ready') autoUpdater.quitAndInstall(false, true)
  }

  /** Startup check, when "Check for updates" is on. */
  checkOnStartup(): void {
    if (!settingsStore.get().behavior.autoUpdateCheck) return
    setTimeout(() => void this.check(false), 5000)
  }
}

export const updater = new Updater()
