import type { EventChannel, EventMap, InvokeArgs, InvokeChannel, InvokeResult } from '@shared/ipc'
import type { ErrorInfo } from '@shared/types'

export class IpcError extends Error implements ErrorInfo {
  readonly code: string
  readonly detail?: string

  constructor(info: ErrorInfo) {
    super(info.message)
    this.name = 'IpcError'
    this.code = info.code
    this.detail = info.detail
  }
}

/** Typed call into the main process. Throws IpcError on failure. */
export async function invoke<C extends InvokeChannel>(channel: C, ...args: InvokeArgs<C>): Promise<InvokeResult<C>> {
  const result = await window.api.invoke(channel, ...args)
  if (result.ok) return result.data
  throw new IpcError(result.error)
}

/** Subscribes to a main-process event. Returns the unsubscribe function. */
export function on<C extends EventChannel>(channel: C, listener: (payload: EventMap[C]) => void): () => void {
  return window.api.on(channel, listener)
}
