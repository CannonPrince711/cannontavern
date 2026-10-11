import { useState } from 'react'
import { Camera, ImagePlus, Loader2, UserRound, X } from 'lucide-react'
import { joinVaultPath } from '@shared/names'
import { EmptyState } from '@/components/EmptyState'
import { FrameArt } from '@/components/illustrations'
import { Button } from '@/components/ui/button'
import { ImageModelSwitcher } from '@/components/ModelSwitcher'
import { Textarea } from '@/components/ui/input'
import { useApp } from '@/stores/app'
import { useChat } from '@/stores/chat'
import { useImages } from '@/stores/images'
import { useUi } from '@/stores/ui'
import { vaultUrl } from '@/stores/vault'

export function ImageJobs(): React.JSX.Element | null {
  const jobs = useImages((s) => s.jobs)
  const cancel = useImages((s) => s.cancel)
  if (!jobs.length) return null
  return (
    <ul className="space-y-1.5">
      {jobs.map((j) => (
        <li key={j.requestId} className="rounded-lg border border-gold/40 bg-gold/5 px-3 py-2" role="status">
          <div className="flex items-center gap-2 text-xs">
            <Loader2 className="size-3.5 animate-spin text-gold" />
            <span className="flex-1 truncate">{j.label}</span>
            <button type="button" aria-label="Cancel" onClick={() => void cancel(j.requestId)} className="text-muted-foreground hover:text-foreground">
              <X className="size-3.5" />
            </button>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-gold transition-[width] duration-300" style={{ width: `${Math.max(3, j.value * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

export function ImagesPanel(): React.JSX.Element {
  const session = useChat((s) => s.session)
  const settings = useApp((s) => s.settings)
  const updateSettings = useApp((s) => s.updateSettings)
  const generate = useImages((s) => s.generate)
  const [prompt, setPrompt] = useState('')

  if (!settings?.imageBackends.length) {
    return (
      <EmptyState
        illustration={<FrameArt />}
        title="No image backend"
        description="Connect ComfyUI, Automatic1111, OpenAI or a custom API to illustrate your adventures."
        action={
          <Button size="sm" onClick={() => useUi.getState().openSettings('images')}>
            <ImagePlus /> Add image backend
          </Button>
        }
        className="pt-16"
      />
    )
  }
  if (!session) return <EmptyState illustration={<FrameArt />} title="No session open" description="Images are saved to the campaign’s Images folder and embedded in the session note." className="pt-16" />

  const images = session.messages.filter((m) => m.role === 'image' && m.image).reverse()

  return (
    <div className="space-y-3 p-3">
      <ImageModelSwitcher className="w-full" />
      <div className="grid grid-cols-2 gap-1.5">
        <Button variant="outline" size="sm" onClick={() => void generate({ sessionPath: session.path, kind: 'scene' })}>
          <Camera /> Illustrate scene
        </Button>
        <Button variant="outline" size="sm" onClick={() => void generate({ sessionPath: session.path, kind: 'portrait' })} disabled={!session.frontmatter.characters.length}>
          <UserRound /> Portrait
        </Button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!prompt.trim()) return
          void generate({ sessionPath: session.path, kind: 'prompt', prompt: prompt.trim() })
          setPrompt('')
        }}
        className="space-y-1.5"
      >
        <Textarea rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe an image…" aria-label="Image prompt" className="text-xs" />
        <Button type="submit" size="sm" className="w-full" disabled={!prompt.trim()}>
          <ImagePlus /> Generate
        </Button>
      </form>

      <ImageJobs />

      {images.length === 0 ? (
        <p className="pt-4 text-center text-xs text-muted-foreground">No images in this session yet.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2">
          {images.map((m) => {
            const path = joinVaultPath(session.campaignPath, 'Images', m.image!.file)
            return (
              <li key={m.id}>
                <button
                  type="button"
                  className="group block w-full overflow-hidden rounded-lg border"
                  onClick={() => useImages.setState({ lightbox: { path, prompt: m.image!.prompt, caption: m.name } })}
                  aria-label={`View ${m.name ?? 'image'}`}
                >
                  <img src={vaultUrl(path)} alt={m.image!.prompt} loading="lazy" className="aspect-square w-full object-cover transition-transform group-hover:scale-105" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
