import { z } from 'zod'
import { AppError } from '../errors'
import { handle } from '../ipc'
import { settingsStore } from '../settings-store'
import { resolveTextBackend, textAdapter } from '../backends/text'
import { listImageModels, withImageModel } from '../backends/image/models'

/** The model switchers: list a saved backend's models and make a backend + model the active one. */
export function registerModelHandlers(): void {
  handle(
    'textBackends:models',
    (_e, id) => {
      const b = settingsStore.get().textBackends.find((x) => x.id === id)
      if (!b) throw new AppError('NOT_FOUND', 'That text backend no longer exists.')
      return textAdapter(b.type).listModels(resolveTextBackend(b))
    },
    z.tuple([z.string().min(1)])
  )

  handle(
    'textBackends:use',
    async (_e, id, model) => {
      const s = settingsStore.get()
      if (!s.textBackends.some((b) => b.id === id)) throw new AppError('NOT_FOUND', 'That text backend no longer exists.')
      const textBackends = s.textBackends.map((b) => (b.id === id && model !== undefined ? { ...b, model } : b))
      // The chat role wins over the default when one is set, so switch whichever is in charge.
      await settingsStore.set({ ...s, textBackends, ...(s.roles.chat ? { roles: { ...s.roles, chat: id } } : { defaultTextBackendId: id }) })
      return settingsStore.getPublic()
    },
    z.tuple([z.string().min(1), z.string().max(300).optional()])
  )

  handle(
    'imageBackends:models',
    (_e, id) => {
      const b = settingsStore.get().imageBackends.find((x) => x.id === id)
      if (!b) throw new AppError('NOT_FOUND', 'That image backend no longer exists.')
      return listImageModels(b)
    },
    z.tuple([z.string().min(1)])
  )

  handle(
    'imageBackends:use',
    async (_e, id, choice) => {
      const s = settingsStore.get()
      if (!s.imageBackends.some((b) => b.id === id)) throw new AppError('NOT_FOUND', 'That image backend no longer exists.')
      const imageBackends = s.imageBackends.map((b) => (b.id === id ? withImageModel(b, choice ?? {}) : b))
      await settingsStore.set({ ...s, imageBackends, defaultImageBackendId: id })
      return settingsStore.getPublic()
    },
    z.tuple([z.string().min(1), z.object({ model: z.string().max(500).optional(), workflowId: z.string().optional() }).optional()])
  )
}
