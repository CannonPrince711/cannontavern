import { create } from 'zustand'
import type { ExtensionInfo, ExtensionPermission } from '@shared/types'
import { registerCommand, unregisterCommands } from '@/lib/commands'
import { invoke } from '@/lib/ipc'
import { useChat } from './chat'
import { toast } from './toasts'

interface ExtensionsStore {
  list: ExtensionInfo[]
  /** Plain-text decorations from extensions' onMessageRender, by message id. */
  decorations: Record<string, Record<string, string>>
  /** Bumped after commands run, so panels refresh their state. */
  stateVersion: number
  load: () => Promise<void>
  reload: () => Promise<void>
  setEnabled: (id: string, enabled: boolean, granted: ExtensionPermission[]) => Promise<void>
  /** True once saved; errors are shown as a toast. */
  saveSettings: (id: string, values: Record<string, unknown>) => Promise<boolean>
}

/** Registers each enabled extension's commands in the slash-command menu. */
function syncCommands(list: ExtensionInfo[]): void {
  for (const ext of list) unregisterCommands(ext.manifest.name)
  for (const ext of list) {
    if (!ext.enabled || ext.status !== 'loaded') continue
    for (const cmd of ext.manifest.commands ?? []) {
      registerCommand({
        name: cmd.name,
        usage: cmd.usage ?? `/${cmd.name}`,
        description: cmd.description,
        source: ext.manifest.name,
        run: async ({ session, args }) => {
          await invoke('extensions:runCommand', { extensionId: ext.manifest.id, command: cmd.name, args, sessionPath: session.path })
          useExtensions.setState((s) => ({ stateVersion: s.stateVersion + 1 }))
        }
      })
    }
  }
}

export const useExtensions = create<ExtensionsStore>((set) => ({
  list: [],
  decorations: {},
  stateVersion: 0,

  async load() {
    try {
      const list = await invoke('extensions:list')
      set({ list })
      syncCommands(list)
    } catch (err) {
      toast.error(err, 'Could not load extensions')
    }
  },

  async reload() {
    const list = await invoke('extensions:reload')
    set({ list })
    syncCommands(list)
  },

  async setEnabled(id, enabled, granted) {
    try {
      const list = await invoke('extensions:setEnabled', id, enabled, granted)
      set({ list })
      syncCommands(list)
      const ext = list.find((e) => e.manifest.id === id)
      if (ext?.status === 'error') toast.error({ message: ext.error ?? 'failed to load' }, `${ext.manifest.name} could not start`)
      else if (enabled) toast.success(`${ext?.manifest.name ?? id} enabled`)
    } catch (err) {
      toast.error(err)
    }
  },

  async saveSettings(id, values) {
    try {
      set({ list: await invoke('extensions:saveSettings', id, values) })
      return true
    } catch (err) {
      toast.error(err, 'Couldn’t save the extension’s settings')
      return false
    }
  }
}))

/** Refresh panels when the session changes. */
useChat.subscribe((s, prev) => {
  if (s.session !== prev.session) useExtensions.setState((x) => ({ stateVersion: x.stateVersion + 1 }))
})
