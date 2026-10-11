import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { cn } from '@/lib/utils'
import { useApp } from '@/stores/app'
import { BackendStep } from './BackendStep'
import { FinishStep } from './FinishStep'
import { VaultStep } from './VaultStep'
import { WelcomeStep } from './WelcomeStep'

export interface StepProps {
  next: () => void
  back: () => void
}

const STEPS: { id: string; label: string; component: React.ComponentType<StepProps> }[] = [
  { id: 'welcome', label: 'Welcome', component: WelcomeStep },
  { id: 'vault', label: 'Vault', component: VaultStep },
  { id: 'backend', label: 'Text model', component: BackendStep },
  { id: 'finish', label: 'Finish', component: FinishStep }
]

/** First-run setup, shown full-screen until settings.setupComplete is true. */
export function Wizard(): React.JSX.Element {
  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState(1)
  const updateSettings = useApp((s) => s.updateSettings)
  const Current = STEPS[step]!.component

  const go = (to: number): void => {
    setDirection(to > step ? 1 : -1)
    setStep(Math.max(0, Math.min(STEPS.length - 1, to)))
  }

  return (
    <div className="absolute inset-x-0 top-10 bottom-0 z-40 flex flex-col overflow-y-auto bg-background" role="dialog" aria-modal aria-label="First-run setup">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(ellipse 60% 45% at 50% 0%, color-mix(in srgb, var(--gold) 14%, transparent), transparent 70%)' }}
      />
      <div className="relative mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-10">
        <ol className="mb-10 flex items-center justify-center gap-2" aria-label="Setup progress">
          {STEPS.map((s, i) => (
            <li key={s.id} className="flex items-center gap-2">
              <span
                className={cn(
                  'grid size-6 place-items-center rounded-full border text-[11px] font-semibold transition-colors',
                  i < step && 'border-primary bg-primary text-primary-foreground',
                  i === step && 'border-primary text-primary',
                  i > step && 'text-muted-foreground'
                )}
                aria-current={i === step ? 'step' : undefined}
              >
                {i < step ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span className={cn('text-xs', i === step ? 'text-foreground' : 'text-muted-foreground')}>{s.label}</span>
              {i < STEPS.length - 1 && <span className="mx-1 h-px w-8 bg-border" aria-hidden />}
            </li>
          ))}
        </ol>

        <div className="relative flex-1">
          <AnimatePresence mode="wait" custom={direction} initial={false}>
            <motion.div
              key={STEPS[step]!.id}
              custom={direction}
              initial={{ opacity: 0, x: direction * 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: direction * -24 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
            >
              <Current next={() => go(step + 1)} back={() => go(step - 1)} />
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="mt-10 flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Logo className="size-3.5 text-gold" /> DND Tavern
          </span>
          <button
            type="button"
            className="underline-offset-4 hover:text-foreground hover:underline"
            onClick={() => void updateSettings({ setupComplete: true })}
          >
            Skip setup, I’ll configure it later
          </button>
        </div>
      </div>
    </div>
  )
}

export function StepHeader({ title, children }: { title: string; children?: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mb-6 text-center">
      <h1 className="font-display text-2xl font-semibold tracking-wide">{title}</h1>
      {children && <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">{children}</p>}
    </div>
  )
}
