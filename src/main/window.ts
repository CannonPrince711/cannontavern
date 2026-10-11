import { BrowserWindow, app, nativeTheme, screen } from 'electron'
import { release } from 'node:os'
import { join } from 'node:path'
import { THEMES, TITLEBAR_HEIGHT } from '@shared/themes'
import type { Appearance } from '@shared/settings'
import type { AppInfo } from '@shared/types'
import { readJson, writeFileAtomic } from './atomic'
import { send } from './ipc'
import { paths } from './paths'
import { rendererIndexFile } from './security'
import { installEditMenu } from './context-menu'

interface SavedBounds {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

const DEFAULT_SIZE = { width: 1440, height: 900 }
const MIN_SIZE = { width: 960, height: 600 }

let mainWindow: BrowserWindow | null = null
let appliedMaterial: AppInfo['material'] = 'none'

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function getAppliedMaterial(): AppInfo['material'] {
  return appliedMaterial
}

export function windowsBuild(): number {
  if (process.platform !== 'win32') return 0
  return Number(release().split('.')[2] ?? 0)
}

export function isWin11(): boolean {
  return windowsBuild() >= 22000
}

/** Windows 11 22H2 (build 22621) is the first with system backdrop support. */
function resolveMaterial(pref: Appearance['windowMaterial']): AppInfo['material'] {
  if (pref === 'none' || windowsBuild() < 22621) return 'none'
  if (pref === 'acrylic') return 'acrylic'
  return 'mica'
}

async function loadBounds(): Promise<SavedBounds | null> {
  const raw = (await readJson(paths.windowStateFile).catch(() => undefined)) as
    | Partial<SavedBounds>
    | undefined
  if (!raw || typeof raw.width !== 'number' || typeof raw.height !== 'number') return null
  const bounds: SavedBounds = {
    x: raw.x,
    y: raw.y,
    width: Math.max(MIN_SIZE.width, raw.width),
    height: Math.max(MIN_SIZE.height, raw.height),
    maximized: !!raw.maximized
  }
  if (bounds.x === undefined || bounds.y === undefined) return bounds
  const { x, y } = bounds
  // Drop the position if the monitor it was on is gone.
  const visible = screen.getAllDisplays().some(({ workArea: a }) => {
    return (
      x < a.x + a.width - 100 &&
      x + bounds.width > a.x + 100 &&
      y >= a.y - 10 &&
      y < a.y + a.height - 50
    )
  })
  return visible ? bounds : { ...bounds, x: undefined, y: undefined }
}

function trackBounds(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | undefined
  const save = (): void => {
    if (win.isDestroyed()) return
    // getNormalBounds() keeps the restored size while maximised.
    const state: SavedBounds = { ...win.getNormalBounds(), maximized: win.isMaximized() }
    void writeFileAtomic(paths.windowStateFile, JSON.stringify(state)).catch((err) =>
      console.error('[window] could not save window state:', err)
    )
  }
  const schedule = (): void => {
    clearTimeout(timer)
    timer = setTimeout(save, 400)
  }
  win.on('resize', schedule)
  win.on('move', schedule)
  win.on('close', () => {
    clearTimeout(timer)
    save()
  })
}

export async function createMainWindow(appearance: Appearance): Promise<BrowserWindow> {
  const theme = THEMES[appearance.theme]
  nativeTheme.themeSource = theme.native
  appliedMaterial = resolveMaterial(appearance.windowMaterial)
  const saved = await loadBounds()

  const win = new BrowserWindow({
    width: saved?.width ?? DEFAULT_SIZE.width,
    height: saved?.height ?? DEFAULT_SIZE.height,
    ...(saved?.x !== undefined && saved.y !== undefined ? { x: saved.x, y: saved.y } : {}),
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    show: false,
    title: 'DND Tavern',
    // Packaged builds take the icon from the .exe; dev builds need it explicitly.
    ...(app.isPackaged ? {} : { icon: join(__dirname, '../../resources/icon.png') }),
    // A hidden title bar plus the overlay keeps the native caption buttons, so
    // Windows 11 snap layouts appear when hovering maximise.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: theme.titlebar, symbolColor: theme.symbol, height: TITLEBAR_HEIGHT },
    backgroundColor: appliedMaterial === 'none' ? theme.background : '#00000000',
    backgroundMaterial: appliedMaterial,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: true
    }
  })
  mainWindow = win
  win.setMenu(null)
  installEditMenu(win)
  if (saved?.maximized) win.maximize()
  trackBounds(win)

  win.once('ready-to-show', () => win.show())
  const pushState = (): void =>
    send(win, 'window:state', { maximized: win.isMaximized(), focused: win.isFocused() })
  for (const ev of ['maximize', 'unmaximize', 'focus', 'blur'] as const) win.on(ev as 'focus', pushState)
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) await win.loadURL(devUrl)
  else await win.loadFile(rendererIndexFile())
  return win
}

/** Re-applies theme-dependent native chrome after an appearance change. */
export function applyAppearance(appearance: Appearance): void {
  const theme = THEMES[appearance.theme]
  nativeTheme.themeSource = theme.native
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  win.setTitleBarOverlay({ color: theme.titlebar, symbolColor: theme.symbol, height: TITLEBAR_HEIGHT })
  const material = resolveMaterial(appearance.windowMaterial)
  if (material !== appliedMaterial) {
    appliedMaterial = material
    win.setBackgroundMaterial(material)
  }
  win.setBackgroundColor(material === 'none' ? theme.background : '#00000000')
}
