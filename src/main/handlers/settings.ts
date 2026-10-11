import { app, dialog } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import {
  ImageBackendInputSchema,
  SettingsPatchSchema,
  SettingsSchema,
  TextBackendInputSchema,
  type SettingsPatch
} from '@shared/settings'
import { writeFileAtomic } from '../atomic'
import { AppError } from '../errors'
import { handle } from '../ipc'
import { settingsStore } from '../settings-store'
import { exportSecret, storeImageBackend, storeTextBackend } from '../backends/store'
import { getMainWindow } from '../window'

const EXPORT_FORMAT = 'dnd-tavern-settings'

export function registerSettingsHandlers(): void {
  handle('settings:get', () => settingsStore.getPublic())

  handle(
    'settings:update',
    async (_e, patch) => {
      await settingsStore.patch(patch)
      return settingsStore.getPublic()
    },
    z.tuple([SettingsPatchSchema]) as unknown as z.ZodType<[SettingsPatch]>
  )

  handle(
    'settings:export',
    async (_e, { includeKeys }) => {
      const win = getMainWindow()
      const opts: Electron.SaveDialogOptions = {
        title: 'Export settings',
        defaultPath: join(app.getPath('documents'), 'dnd-tavern-settings.json'),
        filters: [{ name: 'JSON', extensions: ['json'] }]
      }
      const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      if (result.canceled || !result.filePath) return null

      const s = settingsStore.get()
      const mapNet = <T extends { headers: { name: string; value: Parameters<typeof exportSecret>[0] }[] }>(n: T) => ({
        ...n,
        headers: n.headers.map((h) => ({ name: h.name, value: exportSecret(h.value, includeKeys) }))
      })
      const data = {
        format: EXPORT_FORMAT,
        version: 1,
        exportedAt: new Date().toISOString(),
        includesKeys: includeKeys,
        settings: {
          ...s,
          textBackends: s.textBackends.map((b) => ({ ...b, apiKey: exportSecret(b.apiKey, includeKeys), network: mapNet(b.network) })),
          imageBackends: s.imageBackends.map((b) => ({ ...b, apiKey: exportSecret(b.apiKey, includeKeys), network: mapNet(b.network) }))
        }
      }
      await writeFileAtomic(result.filePath, JSON.stringify(data, null, 2))
      return { path: result.filePath }
    },
    z.tuple([z.object({ includeKeys: z.boolean() })])
  )

  handle('settings:import', async () => {
    const win = getMainWindow()
    const opts: Electron.OpenDialogOptions = {
      title: 'Import settings',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    const file = result.filePaths[0]
    if (result.canceled || !file) return null

    let json: { format?: string; settings?: Record<string, unknown> }
    try {
      json = JSON.parse(await fs.readFile(file, 'utf8'))
    } catch {
      throw new AppError('IMPORT_INVALID', 'That file is not valid JSON.')
    }
    if (json.format !== EXPORT_FORMAT || !json.settings) {
      throw new AppError('IMPORT_INVALID', 'That file is not a DND Tavern settings export.')
    }
    const raw = json.settings
    const text = z.array(TextBackendInputSchema).safeParse(raw.textBackends ?? [])
    const image = z.array(ImageBackendInputSchema).safeParse(raw.imageBackends ?? [])
    if (!text.success || !image.success) {
      throw new AppError('IMPORT_INVALID', 'The backends in that file are not valid.', (text.error ?? image.error)?.message)
    }
    const current = settingsStore.get()
    const parsed = SettingsSchema.safeParse({
      ...raw,
      // The vault belongs to this PC, so the current one is kept.
      vault: current.vault,
      setupComplete: true,
      textBackends: text.data.map((b) => storeTextBackend(b, undefined)),
      imageBackends: image.data.map((b) => storeImageBackend(b, undefined))
    })
    if (!parsed.success) throw new AppError('IMPORT_INVALID', 'The settings in that file are not valid.', parsed.error.message)
    await settingsStore.set(parsed.data)
    return settingsStore.getPublic()
  })
}
