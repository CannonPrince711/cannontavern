import { app, dialog } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import {
  ImageBackendInputSchema,
  SettingsPatchSchema,
  SettingsSchema,
  TextBackendInputSchema,
  keepMissingKeys,
  type Settings,
  type SettingsPatch
} from '@shared/settings'
import { writeFileAtomic } from '../atomic'
import { AppError } from '../errors'
import { handle } from '../ipc'
import { settingsStore } from '../settings-store'
import { exportSecret, storeImageBackend, storeTextBackend } from '../backends/store'
import { paths } from '../paths'
import { getMainWindow } from '../window'

const EXPORT_FORMAT = 'dnd-tavern-settings'

/** Settings in the file format: keys only when asked for, otherwise "keep this PC's key". */
function settingsFile(s: Settings, includeKeys: boolean): Record<string, unknown> {
  const mapNet = <T extends { headers: { name: string; value: Parameters<typeof exportSecret>[0] }[] }>(n: T) => ({
    ...n,
    headers: n.headers.map((h) => ({ name: h.name, value: exportSecret(h.value, includeKeys) }))
  })
  return {
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
}

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
        title: 'Save settings',
        defaultPath: join(app.getPath('documents'), 'dnd-tavern-settings.json'),
        filters: [{ name: 'JSON', extensions: ['json'] }]
      }
      const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      if (result.canceled || !result.filePath) return null

      const data = settingsFile(settingsStore.get(), includeKeys)
      await writeFileAtomic(result.filePath, JSON.stringify(data, null, 2))
      return { path: result.filePath }
    },
    z.tuple([z.object({ includeKeys: z.boolean() })])
  )

  handle('settings:import', async () => {
    const win = getMainWindow()
    const opts: Electron.OpenDialogOptions = {
      title: 'Open settings',
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
    // Older exports without keys wrote "none" for a stored key; read that as "keep this PC's key".
    const withoutKeys = (json as { includesKeys?: boolean }).includesKeys === false
    const text = z.array(TextBackendInputSchema).safeParse(((raw.textBackends ?? []) as unknown[]).map((b) => (withoutKeys ? keepMissingKeys(b) : b)))
    const image = z.array(ImageBackendInputSchema).safeParse(((raw.imageBackends ?? []) as unknown[]).map((b) => (withoutKeys ? keepMissingKeys(b) : b)))
    if (!text.success || !image.success) {
      throw new AppError('IMPORT_INVALID', 'The backends in that file are not valid.', (text.error ?? image.error)?.message)
    }
    const current = settingsStore.get()
    const parsed = SettingsSchema.safeParse({
      ...raw,
      // The vault belongs to this PC, so the current one is kept.
      vault: current.vault,
      setupComplete: true,
      // Keys the file leaves out come from the same backend on this PC.
      textBackends: text.data.map((b) => storeTextBackend(b, current.textBackends.find((c) => c.id === b.id))),
      imageBackends: image.data.map((b) => storeImageBackend(b, current.imageBackends.find((c) => c.id === b.id)))
    })
    if (!parsed.success) throw new AppError('IMPORT_INVALID', 'The settings in that file are not valid.', parsed.error.message)
    // Save the settings being replaced as a settings file, so opening it undoes this.
    const dir = join(paths.userData, 'settings-backups')
    await fs.mkdir(dir, { recursive: true })
    const backupPath = join(dir, `settings before opening ${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`)
    await writeFileAtomic(backupPath, JSON.stringify(settingsFile(current, false), null, 2))
    await settingsStore.set(parsed.data)
    return { settings: settingsStore.getPublic(), backupPath }
  })
}
