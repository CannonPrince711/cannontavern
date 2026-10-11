import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Accessible on/off switch (a button with role="switch"). */
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  className,
  ...props
}: Omit<React.ComponentProps<'button'>, 'onChange'> & {
  checked: boolean
  onCheckedChange: (v: boolean) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50',
        checked ? 'border-primary bg-primary' : 'border-input bg-muted',
        className
      )}
      {...props}
    >
      <span
        className={cn(
          'inline-block size-3.5 rounded-full shadow-sm transition-transform',
          checked ? 'translate-x-[18px] bg-primary-foreground' : 'translate-x-0.5 bg-muted-foreground'
        )}
      />
    </button>
  )
}

/** Styled native <select>: fully keyboard/screen-reader accessible for free. */
export function NativeSelect({ className, children, ...props }: React.ComponentProps<'select'>): React.JSX.Element {
  return (
    <span className={cn('relative block', className)}>
      <select
        className="h-9 w-full appearance-none rounded-md border border-input bg-background/60 pr-8 pl-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50 [&>option]:bg-popover"
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
    </span>
  )
}

export function Slider({
  value,
  min,
  max,
  step,
  onValueChange,
  format,
  ...props
}: Omit<React.ComponentProps<'input'>, 'value' | 'onChange'> & {
  value: number
  min: number
  max: number
  step: number
  onValueChange: (v: number) => void
  format?: (v: number) => string
}): React.JSX.Element {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onValueChange(Number(e.target.value))}
        className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full accent-[var(--primary)]"
        style={{ background: `linear-gradient(to right, var(--primary) ${pct}%, var(--muted) ${pct}%)` }}
        {...props}
      />
      <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{format ? format(value) : value}</span>
    </div>
  )
}

/** Label + description + control, laid out as a settings row. */
export function Field({
  label,
  description,
  htmlFor,
  children,
  inline,
  className
}: {
  label: React.ReactNode
  description?: React.ReactNode
  htmlFor?: string
  children: React.ReactNode
  inline?: boolean
  className?: string
}): React.JSX.Element {
  if (inline) {
    return (
      <div className={cn('flex items-center justify-between gap-6 py-2.5', className)}>
        <div className="min-w-0">
          <label htmlFor={htmlFor} className="text-sm font-medium">
            {label}
          </label>
          {description && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>}
        </div>
        <div className="shrink-0">{children}</div>
      </div>
    )
  }
  return (
    <div className={cn('space-y-1.5 py-2', className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {description && <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>}
    </div>
  )
}

/** A titled card grouping related settings. */
export function SettingsGroup({
  title,
  description,
  children,
  actions,
  className
}: {
  title: string
  description?: React.ReactNode
  children: React.ReactNode
  actions?: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <section className={cn('rounded-xl border bg-card/80 p-5 shadow-card', className)}>
      <div className="mb-2 flex items-start justify-between gap-4">
        <div>
          <h3 className="font-display text-[15px] font-semibold tracking-wide">{title}</h3>
          {description && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="divide-y divide-border/60">{children}</div>
    </section>
  )
}

export function Badge({
  children,
  tone = 'muted',
  className
}: {
  children: React.ReactNode
  tone?: 'muted' | 'gold' | 'emerald' | 'crimson'
  className?: string
}): React.JSX.Element {
  const tones = {
    muted: 'bg-muted text-muted-foreground',
    gold: 'bg-gold/15 text-gold',
    emerald: 'bg-emerald/15 text-emerald',
    crimson: 'bg-crimson/15 text-crimson'
  }
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', tones[tone], className)}>{children}</span>
}

/** Inline callout for warnings and notes inside forms. */
export function Callout({
  tone = 'gold',
  icon,
  children,
  className
}: {
  tone?: 'gold' | 'crimson' | 'emerald' | 'muted'
  icon?: React.ReactNode
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  const tones = {
    gold: 'border-gold/40 bg-gold/10 text-foreground',
    crimson: 'border-crimson/40 bg-crimson/10 text-foreground',
    emerald: 'border-emerald/40 bg-emerald/10 text-foreground',
    muted: 'border-border bg-muted/60 text-muted-foreground'
  }
  return (
    <div role="note" className={cn('flex gap-2 rounded-md border px-3 py-2 text-xs leading-relaxed', tones[tone], className)}>
      {icon && <span className="mt-0.5 shrink-0 [&_svg]:size-3.5">{icon}</span>}
      <div className="min-w-0">{children}</div>
    </div>
  )
}
