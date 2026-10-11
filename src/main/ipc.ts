import { EventEmitter } from 'node:events'
import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type { z } from 'zod'
import type {
  EventChannel,
  EventMap,
  InvokeArgs,
  InvokeChannel,
  InvokeResult,
  IpcResult
} from '@shared/ipc'
import { AppError, toErrorInfo } from './errors'
import { isTrustedRendererUrl } from './security'
import { describeIssues } from '@shared/validation'

type Handler<C extends InvokeChannel> = (
  event: IpcMainInvokeEvent,
  ...args: InvokeArgs<C>
) => InvokeResult<C> | Promise<InvokeResult<C>>

/**
 * Registers a typed handler. Arguments are validated with `argsSchema` when
 * given (a zod tuple), the sender must be our own renderer, and every result
 * or error is wrapped in an IpcResult envelope.
 */
export function handle<C extends InvokeChannel>(
  channel: C,
  handler: Handler<C>,
  argsSchema?: z.ZodType<InvokeArgs<C>>
): void {
  ipcMain.handle(channel, async (event, ...rawArgs: unknown[]): Promise<IpcResult<InvokeResult<C>>> => {
    try {
      if (!isTrustedRendererUrl(event.senderFrame?.url ?? '')) {
        throw new AppError('IPC_FORBIDDEN', `Untrusted sender for ${channel}`)
      }
      let args = rawArgs as InvokeArgs<C>
      if (argsSchema) {
        const parsed = argsSchema.safeParse(rawArgs)
        if (!parsed.success) {
          throw new AppError('IPC_INVALID_ARGS', describeIssues(parsed.error, rawArgs) ?? `Invalid arguments for ${channel}`, parsed.error.message)
        }
        args = parsed.data
      }
      return { ok: true, data: await handler(event, ...args) }
    } catch (err) {
      const error = toErrorInfo(err)
      console.error(`[ipc] ${channel} failed:`, error.message)
      return { ok: false, error }
    }
  })
}

/** Every event sent to the window is also emitted here (the multiplayer host listens). */
export const outbound = new EventEmitter()

export function send<C extends EventChannel>(win: BrowserWindow | null | undefined, channel: C, payload: EventMap[C]): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  outbound.emit('event', channel, payload)
}
