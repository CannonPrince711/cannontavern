import { app, shell } from 'electron'
import { promises as fs } from 'node:fs'
import { release } from 'node:os'
import { z } from 'zod'
import { AppError } from '../errors'
import { handle } from '../ipc'
import { paths } from '../paths'
import { openExternalSafe } from '../security'
import { popupMenu } from '../context-menu'
import { keyStorage } from '../secrets'
import { updater } from '../updater'
import { getAppliedMaterial, getMainWindow, isWin11 } from '../window'

export function registerAppHandlers(): void {
  handle('app:getInfo', () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    osRelease: release(),
    isWin11: isWin11(),
    material: getAppliedMaterial(),
    isPackaged: app.isPackaged,
    userDataPath: app.getPath('userData'),
    keyStorage: keyStorage()
  }))

  handle(
    'app:openExternal',
    async (_e, url) => {
      if (!(await openExternalSafe(url))) {
        throw new AppError('LINK_BLOCKED', 'Only https: and obsidian: links can be opened.')
      }
    },
    z.tuple([z.string().max(8192)])
  )

  handle('updates:status', () => updater.status)
  handle('updates:check', () => updater.check(true))
  handle('updates:download', () => updater.download())
  handle('updates:install', () => updater.install())

  handle(
    'app:contextMenu',
    async (_e, items) => {
      const win = getMainWindow()
      return win ? popupMenu(win, items) : null
    },
    z.tuple([
      z
        .array(
          z.object({
            id: z.string().max(100),
            label: z.string().max(200),
            enabled: z.boolean().optional(),
            accelerator: z.string().max(40).optional(),
            type: z.literal('separator').optional()
          })
        )
        .max(40)
    ])
  )

  handle(
    'app:openFolder',
    async (_e, which) => {
      const dir = { userData: paths.userData, extensions: paths.extensionsDir, workflows: paths.workflowsDir }[which]
      await fs.mkdir(dir, { recursive: true })
      const err = await shell.openPath(dir)
      if (err) throw new AppError('OPEN_FAILED', err)
    },
    z.tuple([z.enum(['userData', 'extensions', 'workflows'])])
  )

  handle('window:minimize', () => getMainWindow()?.minimize())
  handle('window:toggleMaximize', () => {
    const win = getMainWindow()
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  handle('window:close', () => getMainWindow()?.close())
  handle('window:getState', () => {
    const win = getMainWindow()
    return { maximized: !!win?.isMaximized(), focused: !!win?.isFocused() }
  })
}
