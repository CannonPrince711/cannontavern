import { dialog } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import { z } from 'zod'
import { ImageBackendInputSchema, type ImageBackendInput } from '@shared/settings'
import { writeFileAtomic } from '../atomic'
import { AppError } from '../errors'
import { handle } from '../ipc'
import { paths } from '../paths'
import { settingsStore } from '../settings-store'
import { backendList, storeImageBackend } from '../backends/store'
import { loadWorkflowFile, resolveImageInput, testImageBackend } from '../backends/image'
import { guessMapping, parseWorkflow, summarizeWorkflow } from '../backends/image/comfy'
import { imageService } from '../images'
import { getMainWindow } from '../window'

const idArg = z.tuple([z.string().min(1)])
const inputArg = z.tuple([ImageBackendInputSchema]) as unknown as z.ZodType<[ImageBackendInput]>

export function registerImageHandlers(): void {
  handle(
    'imageBackends:save',
    async (_e, input) => {
      const s = settingsStore.get()
      const previous = s.imageBackends.find((b) => b.id === input.id)
      await settingsStore.set(backendList.upsert(s, 'imageBackends', storeImageBackend(input, previous)))
      return settingsStore.getPublic()
    },
    inputArg
  )
  handle('imageBackends:delete', async (_e, id) => (await settingsStore.set(backendList.remove(settingsStore.get(), 'imageBackends', id)), settingsStore.getPublic()), idArg)
  handle('imageBackends:duplicate', async (_e, id) => (await settingsStore.set(backendList.duplicate(settingsStore.get(), 'imageBackends', id)), settingsStore.getPublic()), idArg)
  handle(
    'imageBackends:reorder',
    async (_e, ids) => (await settingsStore.set(backendList.reorder(settingsStore.get(), 'imageBackends', ids)), settingsStore.getPublic()),
    z.tuple([z.array(z.string())])
  )
  handle(
    'imageBackends:test',
    (_e, input, workflowId) => {
      const stored = settingsStore.get().imageBackends.find((b) => b.id === input.id)
      return testImageBackend(resolveImageInput(input, stored), workflowId)
    },
    z.tuple([ImageBackendInputSchema, z.string().optional()]) as unknown as z.ZodType<[ImageBackendInput, string?]>
  )

  handle('comfy:importWorkflow', async () => {
    const win = getMainWindow()
    const opts: Electron.OpenDialogOptions = {
      title: 'Import a ComfyUI workflow (API format)',
      properties: ['openFile'],
      filters: [{ name: 'ComfyUI API workflow', extensions: ['json'] }]
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    const file = r.filePaths[0]
    if (r.canceled || !file) return null
    let json: unknown
    try {
      json = JSON.parse(await fs.readFile(file, 'utf8'))
    } catch {
      throw new AppError('COMFY_WORKFLOW', 'That file is not valid JSON.')
    }
    const wf = parseWorkflow(json)
    // Store a copy under the app's workflows folder so the original can move.
    await fs.mkdir(paths.workflowsDir, { recursive: true })
    const baseName = basename(file).replace(/[^\w .()-]/g, '_')
    let name = baseName
    for (let i = 2; await fs.stat(join(paths.workflowsDir, name)).then(() => true, () => false); i++) name = baseName.replace(/(\.json)?$/i, ` ${i}.json`)
    await writeFileAtomic(join(paths.workflowsDir, name), JSON.stringify(wf, null, 2))
    return { file: name, nodes: summarizeWorkflow(wf), guess: guessMapping(wf) }
  })

  handle(
    'comfy:inspectWorkflow',
    async (_e, file, location) => {
      const wf = await loadWorkflowFile(file, location)
      return { file, nodes: summarizeWorkflow(wf), guess: guessMapping(wf) }
    },
    z.tuple([z.string().min(1), z.enum(['appdata', 'vault'])])
  )

  handle(
    'images:generate',
    (_e, opts) => imageService.generate(opts),
    z.tuple([
      z.object({
        sessionPath: z.string().optional(),
        kind: z.enum(['prompt', 'scene', 'portrait', 'battlemap']),
        prompt: z.string().max(4000).optional(),
        characterPath: z.string().optional(),
        messageId: z.string().optional(),
        backendId: z.string().optional(),
        workflowId: z.string().optional()
      })
    ])
  )
  handle('images:cancel', (_e, id) => imageService.cancel(id), idArg)
}
