import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { z } from 'zod'
import { handle } from '../ipc'
import { tableHost } from '../table/host'

let screen: BrowserWindow | null = null

/** A read-only window with the player view, for a second monitor or a TV. */
function openPlayerScreen(): void {
  const url = tableHost.screenUrl()
  if (screen && !screen.isDestroyed()) {
    screen.focus()
    return
  }
  screen = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'DND Tavern · Player screen',
    autoHideMenuBar: true,
    backgroundColor: '#121014',
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  screen.setMenu(null)
  screen.on('closed', () => (screen = null))
  void screen.loadURL(url)
}

export function registerTableHandlers(): void {
  handle(
    'table:start',
    (_e, opts) => tableHost.start(opts),
    z.tuple([z.object({ scope: z.enum(['local', 'network']), port: z.number().int().min(1024).max(65535), sessionPath: z.string().max(1024).nullable(), funnel: z.boolean().optional() })])
  )
  handle('table:stop', async () => {
    screen?.close()
    return tableHost.stop()
  })
  handle('table:status', () => tableHost.status())
  handle('table:kick', (_e, id) => tableHost.kick(id), z.tuple([z.string().max(40)]))
  handle('table:setAutoRespond', (_e, mode) => tableHost.setAutoRespond(mode), z.tuple([z.enum(['each', 'all', 'manual'])]))
  handle('table:setSession', (_e, path) => tableHost.setSession(path), z.tuple([z.string().max(1024).nullable()]))
  handle('table:openScreen', () => openPlayerScreen())
}

export async function stopTable(): Promise<void> {
  // Funnel first and synchronously: the app may be gone before async work finishes.
  tableHost.stopFunnelNow()
  if (tableHost.hosting) await tableHost.stop()
}
