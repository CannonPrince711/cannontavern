import { useState } from 'react'
import { motion } from 'framer-motion'
import { Eraser, Minus, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { rollExpression } from '@/lib/rolls'
import { useDiceFx } from '@/stores/dice'
import { toast } from '@/stores/toasts'
import { DieShape } from './DieShape'

const DICE = [4, 6, 8, 10, 12, 20, 100]

/** The dice tray: build a pool, set a modifier and advantage, roll into the chat. */
export function DiceTray(): React.JSX.Element | null {
  const open = useDiceFx((s) => s.trayOpen)
  const setOpen = useDiceFx((s) => s.setTrayOpen)
  const [pool, setPool] = useState<Record<number, number>>({})
  const [mod, setMod] = useState(0)
  const [mode, setMode] = useState<'normal' | 'adv' | 'dis'>('normal')
  const [label, setLabel] = useState('')

  if (!open) return null

  const terms = DICE.filter((s) => pool[s]).map((s) => `${pool[s]}d${s}`)
  const singleD20 = terms.length === 1 && pool[20] === 1
  const expr = terms.length ? `${terms.join('+')}${mod ? (mod > 0 ? `+${mod}` : `${mod}`) : ''}` : ''
  const add = (s: number, n: number): void => setPool((p) => ({ ...p, [s]: Math.max(0, Math.min(99, (p[s] ?? 0) + n)) }))

  const go = async (): Promise<void> => {
    if (!expr) return
    try {
      await rollExpression(`${expr}${singleD20 && mode !== 'normal' ? ` ${mode}` : ''}${label.trim() ? ` ${label.trim()}` : ''}`)
      setOpen(false)
      setPool({})
      setMod(0)
      setMode('normal')
      setLabel('')
    } catch (err) {
      toast.error(err)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="absolute right-3 bottom-full left-3 z-20 mx-auto mb-2 max-w-3xl rounded-xl border bg-popover p-4 shadow-card"
      role="dialog"
      aria-label="Dice tray"
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-sm font-semibold tracking-wide">Dice tray</h3>
        <Button variant="ghost" size="icon-sm" aria-label="Close dice tray" onClick={() => setOpen(false)}>
          <X />
        </Button>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {DICE.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => add(s, 1)}
            onContextMenu={(e) => {
              e.preventDefault()
              add(s, -1)
            }}
            aria-label={`Add a d${s}${pool[s] ? ` (${pool[s]} in pool)` : ''}`}
            className="group relative flex w-16 flex-col items-center gap-1 rounded-lg border bg-card px-2 py-2 transition-colors hover:border-primary hover:bg-accent"
          >
            <DieShape sides={s} value={s === 100 ? '%' : s} className="size-9 transition-transform group-hover:-rotate-12" label={`d${s}`} />
            <span className="text-[11px] text-muted-foreground">d{s}</span>
            {!!pool[s] && <span className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">{pool[s]}</span>}
          </button>
        ))}
      </div>
      <p className="mt-2 text-center text-[11px] text-muted-foreground">Click to add, right-click to remove.</p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1" aria-label="Modifier">
          <Button variant="outline" size="icon-sm" aria-label="Decrease modifier" onClick={() => setMod((m) => m - 1)}>
            <Minus />
          </Button>
          <span className="w-10 text-center text-sm tabular-nums">{mod >= 0 ? `+${mod}` : mod}</span>
          <Button variant="outline" size="icon-sm" aria-label="Increase modifier" onClick={() => setMod((m) => m + 1)}>
            <Plus />
          </Button>
        </div>
        <div className="flex rounded-lg border p-0.5" role="radiogroup" aria-label="Advantage">
          {(['dis', 'normal', 'adv'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              disabled={!singleD20 && m !== 'normal'}
              onClick={() => setMode(m)}
              className={cn('rounded-md px-2.5 py-1 text-xs disabled:opacity-40', mode === m && 'bg-accent font-medium text-foreground', mode !== m && 'text-muted-foreground')}
            >
              {m === 'adv' ? 'Advantage' : m === 'dis' ? 'Disadvantage' : 'Normal'}
            </button>
          ))}
        </div>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)" className="h-8 w-40 flex-1" aria-label="Roll label" />
        <code className="min-w-20 text-center font-mono text-sm text-gold">{expr || '—'}</code>
        <Button variant="ghost" size="icon-sm" aria-label="Clear" onClick={() => (setPool({}), setMod(0))} disabled={!expr && !mod}>
          <Eraser />
        </Button>
        <Button onClick={() => void go()} disabled={!expr}>
          Roll
        </Button>
      </div>
    </motion.div>
  )
}
