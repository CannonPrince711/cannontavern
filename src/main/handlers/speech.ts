import { z } from 'zod'
import { handle } from '../ipc'
import { synthesize } from '../speech'

export function registerSpeechHandlers(): void {
  handle('speech:synthesize', async (_e, text) => synthesize(text), z.tuple([z.string().min(1).max(20_000)]))
}
