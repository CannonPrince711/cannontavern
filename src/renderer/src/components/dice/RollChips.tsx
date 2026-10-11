import { motion } from 'framer-motion'
import type { RollResult } from '@shared/types'
import { cn } from '@/lib/utils'

/** A roll in the chat: small dice chips that flip in, then the total. */
export function RollChips({ roll, name, animate }: { roll: RollResult; name?: string; animate: boolean }): React.JSX.Element {
  const shown = roll.dice.slice(0, 20)
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5">
      {name && <span className="mr-1 text-xs font-semibold text-gold">{name}</span>}
      <span className="mr-1 font-mono text-[11px] text-muted-foreground">
        {roll.expression}
        {roll.mode === 'adv' ? ' adv' : roll.mode === 'dis' ? ' dis' : ''}
      </span>
      {shown.map((d, i) => {
        const crit = d.kept && d.sides === 20 && roll.crit && d.value === 20
        const fumble = d.kept && d.sides === 20 && roll.fumble && d.value === 1
        return (
          <motion.span
            key={i}
            initial={animate ? { rotateX: 90, opacity: 0 } : false}
            animate={{ rotateX: 0, opacity: 1 }}
            transition={{ delay: i * 0.06, type: 'spring', stiffness: 300, damping: 18 }}
            title={`d${d.sides}${d.kept ? '' : ' (dropped)'}`}
            className={cn(
              'grid h-6 min-w-6 place-items-center rounded-md border px-1 font-display text-xs font-bold tabular-nums',
              crit && 'border-gold bg-gold text-primary-foreground shadow-[0_0_10px_var(--gold)]',
              fumble && 'border-crimson bg-crimson text-white',
              !crit && !fumble && 'bg-surface-2',
              !d.kept && 'line-through opacity-40'
            )}
          >
            {d.value}
          </motion.span>
        )
      })}
      {roll.dice.length > shown.length && <span className="text-xs text-muted-foreground">+{roll.dice.length - shown.length} more</span>}
      {roll.modifier !== 0 && (
        <span className="text-xs text-muted-foreground">
          {roll.modifier > 0 ? '+' : '−'}
          {Math.abs(roll.modifier)}
        </span>
      )}
      <span className="text-xs text-muted-foreground">=</span>
      <span className={cn('font-display text-base font-bold', roll.crit ? 'text-gold' : roll.fumble ? 'text-crimson' : 'text-foreground')}>{roll.total}</span>
      {roll.dc !== undefined && (
        <span className={cn('ml-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', roll.success ? 'bg-emerald/15 text-emerald' : 'bg-crimson/15 text-crimson')}>
          DC {roll.dc} {roll.success ? '✓ success' : '✗ failure'}
        </span>
      )}
      {roll.crit && roll.dc === undefined && <span className="ml-1 text-[11px] font-semibold text-gold">Natural 20!</span>}
      {roll.fumble && roll.dc === undefined && <span className="ml-1 text-[11px] font-semibold text-crimson">Natural 1</span>}
    </div>
  )
}
