import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, Info, X, XCircle } from 'lucide-react'
import { invoke } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { useToasts, type Toast } from '@/stores/toasts'

const ICONS = {
  info: <Info className="size-4 text-muted-foreground" />,
  success: <CheckCircle2 className="size-4 text-emerald" />,
  warning: <AlertTriangle className="size-4 text-gold" />,
  error: <XCircle className="size-4 text-crimson" />
}

function ToastItem({ t }: { t: Toast }): React.JSX.Element {
  const dismiss = useToasts((s) => s.dismiss)
  const [copied, setCopied] = useState(false)
  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText([t.title, t.detail].filter(Boolean).join('\n\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: -12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ duration: 0.18 }}
      role={t.level === 'error' ? 'alert' : 'status'}
      className={cn(
        'pointer-events-auto w-[360px] rounded-lg border bg-popover p-3 shadow-card',
        t.level === 'error' && 'border-crimson/50'
      )}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5">{ICONS[t.level]}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium break-words">{t.title}</p>
          {t.source && <p className="text-[11px] text-muted-foreground">{t.source}</p>}
          {t.detail && t.level !== 'error' && <p className="mt-0.5 text-xs text-muted-foreground">{t.detail}</p>}
          {t.link && (
            <button
              type="button"
              onClick={() => {
                void invoke('app:openExternal', t.link!.url)
                dismiss(t.id)
              }}
              className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <ExternalLink className="size-3" /> {t.link.label}
            </button>
          )}
          {t.detail && t.level === 'error' && (
            <button
              type="button"
              onClick={() => void copy()}
              className="mt-1.5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <Copy className="size-3" /> {copied ? 'Copied' : 'Copy details'}
            </button>
          )}
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => dismiss(t.id)}
          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </motion.li>
  )
}

export function Toaster(): React.JSX.Element {
  const toasts = useToasts((s) => s.toasts)
  return (
    <ol className="pointer-events-none fixed top-14 right-4 z-[60] flex flex-col gap-2" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <ToastItem key={t.id} t={t} />
        ))}
      </AnimatePresence>
    </ol>
  )
}
