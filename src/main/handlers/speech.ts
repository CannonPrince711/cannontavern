import { z } from 'zod'
import { handle } from '../ipc'
import { serverVoices, synthesize, voiceFor } from '../speech'

export function registerSpeechHandlers(): void {
  handle(
    'speech:synthesize',
    async (_e, text, who) => synthesize(text, who?.voice || (who ? await voiceFor(who) : undefined)),
    z.tuple([
      z.string().min(1).max(20_000),
      z.object({ sessionPath: z.string().max(1024).optional(), role: z.string().max(20).optional(), name: z.string().max(200).optional(), voice: z.string().max(100).optional() }).optional()
    ])
  )
  handle('speech:voices', () => serverVoices())
}
