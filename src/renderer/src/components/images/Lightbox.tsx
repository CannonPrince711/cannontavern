import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Copy, ExternalLink, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { invoke } from '@/lib/ipc'
import { useImages } from '@/stores/images'
import { toast } from '@/stores/toasts'
import { vaultUrl } from '@/stores/vault'

export function Lightbox(): React.JSX.Element {
  const box = useImages((s) => s.lightbox)
  const close = (): void => useImages.setState({ lightbox: null })

  useEffect(() => {
    if (!box) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [box])

  return (
    <AnimatePresence>
      {box && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-x-0 top-10 bottom-0 z-[58] flex flex-col bg-black/85 backdrop-blur-sm"
          role="dialog"
          aria-modal
          aria-label={box.caption ?? 'Image'}
          onClick={close}
        >
          <div className="flex items-center gap-2 px-4 py-3 text-white" onClick={(e) => e.stopPropagation()}>
            <p className="min-w-0 flex-1 truncate text-sm">{box.caption}</p>
            {box.prompt && (
              <Button variant="ghost" size="sm" className="text-white hover:bg-white/10 hover:text-white" onClick={() => void navigator.clipboard.writeText(box.prompt!).then(() => toast.success('Prompt copied'))}>
                <Copy /> Copy prompt
              </Button>
            )}
            <Button variant="ghost" size="sm" className="text-white hover:bg-white/10 hover:text-white" onClick={() => void invoke('vault:openInObsidian', box.path).catch((e) => toast.error(e))}>
              <ExternalLink /> Open in Obsidian
            </Button>
            <Button variant="ghost" size="icon" className="text-white hover:bg-white/10 hover:text-white" aria-label="Close" onClick={close}>
              <X />
            </Button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-6">
            <motion.img
              initial={{ scale: 0.96 }}
              animate={{ scale: 1 }}
              src={vaultUrl(box.path)}
              alt={box.prompt ?? box.caption ?? ''}
              className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          {box.prompt && (
            <p className="selectable mx-auto max-w-3xl px-6 pb-5 text-center text-xs text-white/70" onClick={(e) => e.stopPropagation()}>
              {box.prompt}
            </p>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
