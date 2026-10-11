import { z } from 'zod'
import { TextBackendInputSchema, type TextBackendInput } from '@shared/settings'
import { handle } from '../ipc'
import { settingsStore } from '../settings-store'
import { backendList, storeTextBackend } from '../backends/store'
import { resolveTextInput, testTextBackend, textAdapter } from '../backends/text'

const idArg = z.tuple([z.string().min(1)])
const textInputArg = z.tuple([TextBackendInputSchema]) as unknown as z.ZodType<[TextBackendInput]>

export function registerBackendHandlers(): void {
  handle(
    'textBackends:save',
    async (_e, input) => {
      const s = settingsStore.get()
      const previous = s.textBackends.find((b) => b.id === input.id)
      await settingsStore.set(backendList.upsert(s, 'textBackends', storeTextBackend(input, previous)))
      return settingsStore.getPublic()
    },
    textInputArg
  )

  handle(
    'textBackends:delete',
    async (_e, id) => {
      await settingsStore.set(backendList.remove(settingsStore.get(), 'textBackends', id))
      return settingsStore.getPublic()
    },
    idArg
  )

  handle(
    'textBackends:duplicate',
    async (_e, id) => {
      await settingsStore.set(backendList.duplicate(settingsStore.get(), 'textBackends', id))
      return settingsStore.getPublic()
    },
    idArg
  )

  handle(
    'textBackends:reorder',
    async (_e, ids) => {
      await settingsStore.set(backendList.reorder(settingsStore.get(), 'textBackends', ids))
      return settingsStore.getPublic()
    },
    z.tuple([z.array(z.string())])
  )

  handle(
    'textBackends:test',
    (_e, input) => {
      const stored = settingsStore.get().textBackends.find((b) => b.id === input.id)
      return testTextBackend(resolveTextInput(input, stored))
    },
    textInputArg
  )

  handle(
    'textBackends:fetchModels',
    (_e, input) => {
      const stored = settingsStore.get().textBackends.find((b) => b.id === input.id)
      const resolved = resolveTextInput(input, stored)
      return textAdapter(resolved.type).listModels(resolved)
    },
    textInputArg
  )
}
