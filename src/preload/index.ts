import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { EVENT_CHANNELS, INVOKE_CHANNELS, type PreloadApi } from '@shared/ipc'

const invokeAllowed = new Set<string>(INVOKE_CHANNELS)
const eventAllowed = new Set<string>(EVENT_CHANNELS)

const api: PreloadApi = {
  invoke(channel, ...args) {
    if (!invokeAllowed.has(channel)) {
      return Promise.resolve({
        ok: false,
        error: { code: 'IPC_UNKNOWN_CHANNEL', message: `Unknown channel: ${String(channel)}` }
      })
    }
    return ipcRenderer.invoke(channel, ...args)
  },
  on(channel, listener) {
    if (!eventAllowed.has(channel)) throw new Error(`Unknown event channel: ${String(channel)}`)
    const wrapped = (_event: IpcRendererEvent, payload: unknown): void =>
      listener(payload as Parameters<typeof listener>[0])
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.removeListener(channel, wrapped)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
