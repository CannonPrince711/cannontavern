import { lazy, Suspense, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { RollResult } from '@shared/types'
import { useReducedMotion } from '@/hooks/useAppearance'
import { useApp } from '@/stores/app'
import { finishDiceFx, useDiceFx } from '@/stores/dice'
import { DieShape } from './DieShape'

const Dice3D = lazy(() => import('./Dice3D'))

const TUMBLE_MS = 850
const HOLD_MS = 900

function tone(r: RollResult, d: RollResult['dice'][number]): 'crit' | 'fumble' | 'dropped' | 'default' {
  if (!d.kept) return 'dropped'
  if (d.sides === 20 && r.crit && d.value === 20) return 'crit'
  if (d.sides === 20 && r.fumble && d.value === 1) return 'fumble'
  return 'default'
}

/** Random faces flicker while the die tumbles, then it lands on the real value. */
function TumblingDie({ die, result, index }: { die: RollResult['dice'][number]; result: RollResult; index: number }): React.JSX.Element {
  const [face, setFace] = useState<number>(() => 1 + Math.floor(Math.random() * die.sides))
  const [landed, setLanded] = useState(false)
  useEffect(() => {
    const flick = setInterval(() => setFace(1 + Math.floor(Math.random() * die.sides)), 70)
    const stop = setTimeout(() => {
      clearInterval(flick)
      setLanded(true)
    }, TUMBLE_MS + index * 90)
    return () => {
      clearInterval(flick)
      clearTimeout(stop)
    }
  }, [die.sides, index])
  return (
    <motion.div
      initial={{ y: -140, x: (index % 2 ? 1 : -1) * 60, rotate: -260, opacity: 0, scale: 0.6 }}
      animate={landed ? { y: 0, x: 0, rotate: 0, opacity: 1, scale: 1 } : { y: [-140, 10, -24, 0], x: 0, rotate: [-260, 40, -20, 0], opacity: 1, scale: 1 }}
      transition={landed ? { type: 'spring', stiffness: 380, damping: 18 } : { duration: TUMBLE_MS / 1000, ease: 'easeOut', delay: index * 0.09 }}
      className={landed && tone(result, die) === 'crit' ? 'drop-shadow-[0_0_14px_var(--gold)]' : undefined}
    >
      <DieShape sides={die.sides} value={landed ? die.value : face} tone={landed ? tone(result, die) : 'default'} className="size-16" />
    </motion.div>
  )
}

export function DiceOverlay(): React.JSX.Element {
  const current = useDiceFx((s) => s.current)
  const reduced = useReducedMotion()
  const dice3d = useApp((s) => s.settings?.appearance.dice3d ?? false)

  useEffect(() => {
    if (!current) return
    if (reduced) {
      finishDiceFx()
      return
    }
    const ms = dice3d ? 2300 : TUMBLE_MS + current.dice.length * 90 + HOLD_MS
    const t = setTimeout(finishDiceFx, ms)
    return () => clearTimeout(t)
  }, [current, reduced, dice3d])

  return (
    <AnimatePresence>
      {current && !reduced && (
        <motion.div
          key="dice"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={finishDiceFx}
          className="pointer-events-auto fixed inset-x-0 top-10 bottom-0 z-[55] grid place-items-center bg-black/25"
          role="status"
          aria-label={`Rolled ${current.total}`}
        >
          <div className="flex flex-col items-center gap-4">
            {dice3d ? (
              <Suspense fallback={null}>
                <Dice3D result={current} />
              </Suspense>
            ) : (
              <div className="flex max-w-xl flex-wrap justify-center gap-3">
                {current.dice.slice(0, 24).map((d, i) => (
                  <TumblingDie key={i} die={d} result={current} index={i} />
                ))}
              </div>
            )}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: dice3d ? 1.5 : (TUMBLE_MS + current.dice.length * 90) / 1000 }}
              className="rounded-xl border bg-popover/95 px-5 py-2 text-center shadow-card"
            >
              <div className={`font-display text-3xl font-bold ${current.crit ? 'text-gold' : current.fumble ? 'text-crimson' : 'text-foreground'}`}>{current.total}</div>
              <div className="text-xs text-muted-foreground">
                {current.label ? `${current.label} · ` : ''}
                {current.expression}
                {current.mode !== 'normal' ? ` (${current.mode === 'adv' ? 'advantage' : 'disadvantage'})` : ''}
                {current.dc !== undefined ? ` · DC ${current.dc} ${current.success ? '✓' : '✗'}` : ''}
              </div>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
