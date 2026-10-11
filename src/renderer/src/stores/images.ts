import { create } from 'zustand'
import type { InvokeArgs } from '@shared/ipc'
import { invoke, on } from '@/lib/ipc'
import { useChat } from './chat'
import { toast } from './toasts'

export interface ImageJob {
  requestId: string
  label: string
  value: number
  kind: 'prompt' | 'scene' | 'portrait'
}

interface ImagesStore {
  jobs: ImageJob[]
  /** Image path shown in the lightbox. */
  lightbox: { path: string; prompt?: string; caption?: string } | null
  init: () => () => void
  generate: (opts: InvokeArgs<'images:generate'>[0]) => Promise<void>
  cancel: (requestId: string) => Promise<void>
}

export const useImages = create<ImagesStore>((set, get) => ({
  jobs: [],
  lightbox: null,

  init() {
    const offs = [
      on('images:progress', (e) => {
        const jobs = get().jobs
        const job = jobs.find((j) => j.requestId === e.requestId)
        if (job) set({ jobs: jobs.map((j) => (j.requestId === e.requestId ? { ...j, value: e.value, label: e.label ?? j.label } : j)) })
        else set({ jobs: [...jobs, { requestId: e.requestId, value: e.value, label: e.label ?? 'Generating…', kind: 'scene' }] })
      }),
      on('images:done', (e) => {
        set({ jobs: get().jobs.filter((j) => j.requestId !== e.requestId) })
        if (e.session && useChat.getState().session?.path === e.session.path) useChat.setState({ session: e.session })
        if (!e.session) toast.success('Portrait saved', e.image.file)
      }),
      on('images:error', (e) => {
        set({ jobs: get().jobs.filter((j) => j.requestId !== e.requestId) })
        if (e.error.code !== 'ABORTED') toast.error(e.error, 'Image generation failed')
      })
    ]
    return () => offs.forEach((off) => off())
  },

  async generate(opts) {
    try {
      const { requestId } = await invoke('images:generate', opts)
      if (!get().jobs.some((j) => j.requestId === requestId)) {
        set({ jobs: [...get().jobs, { requestId, value: 0, label: 'Starting…', kind: opts.kind }] })
      }
    } catch (err) {
      toast.error(err, 'Could not start image generation')
    }
  },

  async cancel(requestId) {
    await invoke('images:cancel', requestId).catch(() => {})
  }
}))
