import { dirname } from 'node:path'
import { app, dialog, shell } from 'electron'
import { z } from 'zod'
import { IMAGE_EXTENSIONS, RESOURCE_FOLDERS } from '@shared/layout'
import { noteName } from '@shared/names'
import { AppError } from '../errors'
import { handle } from '../ipc'
import { settingsStore } from '../settings-store'
import { detectObsidianVaults, obsidianConfigFiles, obsidianUri, validateVault } from '../vault/obsidian'
import { installFolderWarning, vaultInInstallFolder } from '../vault/location'
import { vaultService } from '../vault/service'
import { createSampleCampaign } from '../sample'
import { createResources } from '../resources'
import { buildVaultGraph } from '../graph'
import { getMainWindow } from '../window'

const pathArg = z.tuple([z.string().min(1).max(1024)])

let noteListCache: { at: number; paths: string[] } | null = null

export function registerVaultHandlers(): void {
  handle('vault:detect', () => detectObsidianVaults(obsidianConfigFiles(app.getPath('appData'), app.getPath('home'))))

  handle('vault:pick', async () => {
    const win = getMainWindow()
    const opts: Electron.OpenDialogOptions = {
      title: 'Choose your Obsidian vault',
      properties: ['openDirectory', 'createDirectory']
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  handle('vault:validate', (_e, path) => validateVault(path), pathArg)

  handle(
    'vault:configure',
    async (_e, { path, rootFolder }) => {
      const installFolder = app.isPackaged ? dirname(app.getPath('exe')) : null
      if (installFolder && vaultInInstallFolder(path, rootFolder, installFolder)) {
        throw new AppError('VAULT_IN_INSTALL', installFolderWarning(installFolder))
      }
      const index = await vaultService.open(path, rootFolder, { create: true })
      await settingsStore.patch({ vault: { path: index.vaultPath, rootFolder: index.rootFolder } })
      noteListCache = null
      return index
    },
    z.tuple([z.object({ path: z.string().min(1), rootFolder: z.string().min(1).max(200) })])
  )

  handle('vault:getIndex', () => vaultService.getIndex())

  handle('vault:graph', () => buildVaultGraph())

  handle('vault:createSampleCampaign', async () => {
    const vault = vaultService.require()
    const r = await createSampleCampaign(vault, settingsStore.get().general.sessionDateFormat)
    // Index everything that was written.
    for (const p of await vault.walk(vault.rootFolder, (x) => x.endsWith('.md'))) await vaultService.reindex(p)
    return { index: vaultService.getIndex()!, ...r }
  })

  handle('vault:createResources', async () => {
    const vault = vaultService.require()
    await createResources(vault)
    for (const p of await vault.walk(vault.rootPath(RESOURCE_FOLDERS.root), (x) => x.endsWith('.md'))) await vaultService.reindex(p)
    return vaultService.getIndex()!
  })

  // Any note in the vault can be read (for /note), but never .obsidian/.
  handle(
    'vault:readNote',
    async (_e, path) => {
      if (!path.toLowerCase().endsWith('.md')) throw new AppError('VAULT_PATH', 'Only Markdown notes can be read.')
      const { content } = await vaultService.require().read(path)
      return { path, content }
    },
    pathArg
  )

  handle(
    'vault:searchNotes',
    async (_e, query) => {
      const vault = vaultService.require()
      if (!noteListCache || Date.now() - noteListCache.at > 30_000) {
        noteListCache = { at: Date.now(), paths: await vault.walkVault((p) => p.toLowerCase().endsWith('.md')) }
      }
      const q = query.trim().toLowerCase()
      return noteListCache.paths
        .map((path) => ({ path, name: noteName(path) }))
        .filter((n) => !q || n.name.toLowerCase().includes(q) || n.path.toLowerCase().includes(q))
        .sort((a, b) => rank(a.name, q) - rank(b.name, q) || a.name.localeCompare(b.name))
        .slice(0, 30)
    },
    z.tuple([z.string().max(200)])
  )

  handle(
    'vault:openInObsidian',
    async (_e, path) => {
      const index = vaultService.getIndex()
      if (!index) throw new AppError('VAULT_NOT_CONFIGURED', 'No vault is open.')
      vaultService.require().resolve(path) // validates the path
      await shell.openExternal(obsidianUri(index.vaultName, path))
    },
    pathArg
  )

  handle(
    'vault:readImage',
    async (_e, path) => {
      const vault = vaultService.require()
      const ext = path.split('.').pop()?.toLowerCase() ?? ''
      if (!IMAGE_EXTENSIONS.includes(ext) || !vault.isInRoot(path)) {
        throw new AppError('VAULT_PATH', 'Only images inside the DND Tavern folder can be read.')
      }
      const data = await vault.readBinary(path)
      const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
      return `data:${mime};base64,${data.toString('base64')}`
    },
    pathArg
  )
}

function rank(name: string, q: string): number {
  const n = name.toLowerCase()
  if (n === q) return 0
  if (n.startsWith(q)) return 1
  return 2
}
