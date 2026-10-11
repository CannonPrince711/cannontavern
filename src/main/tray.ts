/**
 * Optional notification-area icon (Settings → General → Minimise to tray).
 * While enabled, closing the window hides it instead of quitting.
 */
import { app, Menu, nativeImage, Tray, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { settingsStore } from './settings-store'
import { getMainWindow } from './window'

let tray: Tray | null = null
let quitting = false

function iconPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(__dirname, '../../resources/icon.png')
}

function showWindow(): void {
  const win = getMainWindow()
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function createTray(): void {
  if (tray) return
  const image = nativeImage.createFromPath(iconPath()).resize({ width: 16, height: 16 })
  tray = new Tray(image)
  tray.setToolTip('DND Tavern')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show DND Tavern', click: showWindow },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
  tray.on('click', showWindow)
}

function destroyTray(): void {
  tray?.destroy()
  tray = null
}

/** Applies the current setting; call on startup and whenever settings change. */
export function syncTray(): void {
  if (settingsStore.get().behavior.minimizeToTray) createTray()
  else destroyTray()
}

/** Hides instead of closing while the tray is on. */
export function attachTrayBehaviour(win: BrowserWindow): void {
  win.on('close', (e) => {
    if (quitting || !tray || !settingsStore.get().behavior.minimizeToTray) return
    e.preventDefault()
    win.hide()
  })
}

app.on('before-quit', () => {
  quitting = true
})
