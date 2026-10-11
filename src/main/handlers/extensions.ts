import { z } from 'zod'
import { ExtensionPermissionSchema } from '@shared/settings'
import type { ExtensionPermission } from '@shared/types'
import { resolveTextBackend, textAdapter } from '../backends/text'
import { backendChain } from '../chat'
import { AppError } from '../errors'
import { extensionHost } from '../extensions/host'
import { imageService } from '../images'
import { handle } from '../ipc'
import { settingsStore } from '../settings-store'

export function registerExtensionHandlers(): void {
  // Services the bridge needs, bound late to avoid import cycles.
  extensionHost.services = {
    async generateText(prompt, opts) {
      const backend = backendChain(settingsStore.get(), 'summary')[0]
      if (!backend) throw new AppError('NO_BACKEND', 'No text backend is configured.')
      const r = await textAdapter(backend.type).generate(
        resolveTextBackend(backend),
        { system: opts.system ?? 'You are a helpful assistant for a Dungeons & Dragons game.', messages: [{ role: 'user', content: prompt }], maxTokens: Math.min(opts.maxTokens ?? 800, 4000) },
        { stream: false }
      )
      return r.text
    },
    generateImage: (prompt, sessionPath, opts) =>
      imageService.generateNow({ kind: 'prompt', prompt, sessionPath, workflowId: typeof opts.workflowId === 'string' ? opts.workflowId : undefined })
  }

  handle('extensions:list', () => extensionHost.list())
  handle('extensions:reload', async () => {
    await extensionHost.installBundled()
    return extensionHost.reload()
  })
  handle(
    'extensions:setEnabled',
    (_e, id, enabled, granted) => extensionHost.setEnabled(id, enabled, granted as ExtensionPermission[]),
    z.tuple([z.string().min(1), z.boolean(), z.array(ExtensionPermissionSchema)])
  )
  handle(
    'extensions:runCommand',
    (_e, { extensionId, command, args, sessionPath }) => extensionHost.runCommand(extensionId, command, args, sessionPath),
    z.tuple([z.object({ extensionId: z.string(), command: z.string(), args: z.string().max(10_000), sessionPath: z.string().optional() })])
  )
  handle(
    'extensions:saveSettings',
    (_e, id, values) => extensionHost.saveSettings(id, values),
    z.tuple([z.string(), z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))])
  )
  handle(
    'extensions:uiState',
    async (_e, id, sessionPath) => {
      const info = extensionHost.info(id)
      if (!info?.enabled) throw new AppError('EXT_DISABLED', 'That extension is not enabled.')
      return { ...(await extensionHost.snapshot(id, sessionPath)), store: await extensionHost.storeSnapshot(id) }
    },
    z.tuple([z.string(), z.string().optional()])
  )
}
