import { useId, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronRight, Copy, Loader2, Lock, LockOpen, Plus, RefreshCw, Trash2, XCircle } from 'lucide-react'
import type { SecretInput } from '@shared/settings'
import type { TestResult } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/controls'
import { Input } from '@/components/ui/input'
import { Tip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { toast } from '@/stores/toasts'
import { SecretField } from './SecretField'

/** A number that can be left unset (null = "don't send"). */
export function NullableNumber({
  label,
  value,
  onChange,
  fallback,
  step = 0.05,
  min,
  max,
  hint
}: {
  label: string
  value: number | null
  onChange: (v: number | null) => void
  fallback: number
  step?: number
  min?: number
  max?: number
  hint?: string
}): React.JSX.Element {
  const id = useId()
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-xs font-medium">
          {label}
        </label>
        <Tip label={value === null ? 'Not sent: the server default applies' : 'Sent with every request'}>
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {value === null ? 'default' : 'set'}
            <Switch
              aria-label={`Send ${label}`}
              checked={value !== null}
              onCheckedChange={(on) => onChange(on ? fallback : null)}
              className="scale-90"
            />
          </span>
        </Tip>
      </div>
      <Input
        id={id}
        type="number"
        step={step}
        min={min}
        max={max}
        disabled={value === null}
        value={value ?? ''}
        placeholder="server default"
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
}): React.JSX.Element {
  const id = useId()
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-xs font-medium">
        {label}
      </label>
      <div className="relative">
        <Input
          id={id}
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => e.target.value !== '' && onChange(Number(e.target.value))}
          className={suffix ? 'pr-10' : undefined}
        />
        {suffix && <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  )
}

export interface HeaderRow {
  name: string
  value: SecretInput
}

/**
 * Custom HTTP headers (reverse proxies, Cloudflare Access, basic auth). Each
 * value can be marked secret, which stores it encrypted like an API key.
 */
export function HeadersEditor({ rows, onChange }: { rows: HeaderRow[]; onChange: (rows: HeaderRow[]) => void }): React.JSX.Element {
  const set = (i: number, row: HeaderRow): void => onChange(rows.map((r, j) => (j === i ? row : r)))
  return (
    <div className="space-y-2">
      {rows.length === 0 && <p className="text-xs text-muted-foreground">No custom headers.</p>}
      {rows.map((row, i) => {
        const secret = row.value.kind !== 'plain' && row.value.kind !== 'none'
        return (
          <div key={i} className="flex items-start gap-2">
            <Input
              aria-label="Header name"
              placeholder="CF-Access-Client-Id"
              value={row.name}
              onChange={(e) => set(i, { ...row, name: e.target.value })}
              className="w-56 font-mono text-[13px]"
            />
            <div className="min-w-0 flex-1">
              {secret ? (
                <SecretField value={row.value} onChange={(value) => set(i, { ...row, value })} placeholder="secret value" />
              ) : (
                <Input
                  aria-label="Header value"
                  placeholder="value"
                  value={row.value.kind === 'plain' ? row.value.value : ''}
                  onChange={(e) => set(i, { ...row, value: { kind: 'plain', value: e.target.value } })}
                  className="font-mono text-[13px]"
                />
              )}
            </div>
            <Tip label={secret ? 'Secret: stored encrypted, hidden everywhere' : 'Plain value: mark as secret'}>
              <Button
                variant="ghost"
                size="icon"
                aria-label={secret ? 'Make header value plain' : 'Make header value secret'}
                aria-pressed={secret}
                onClick={() => set(i, { ...row, value: secret ? { kind: 'plain', value: '' } : { kind: 'set', value: '' } })}
              >
                {secret ? <Lock className="text-emerald" /> : <LockOpen />}
              </Button>
            </Tip>
            <Button variant="ghost" size="icon" aria-label="Remove header" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
              <Trash2 />
            </Button>
          </div>
        )
      })}
      <Button variant="outline" size="sm" onClick={() => onChange([...rows, { name: '', value: { kind: 'plain', value: '' } }])}>
        <Plus /> Add header
      </Button>
    </div>
  )
}

/** Model name with a "Fetch models" button that fills a suggestion list. */
export function ModelField({
  id,
  value,
  onChange,
  fetchModels,
  placeholder
}: {
  id?: string
  value: string
  onChange: (v: string) => void
  fetchModels?: () => Promise<string[]>
  placeholder?: string
}): React.JSX.Element {
  const listId = useId()
  const [models, setModels] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const run = async (): Promise<void> => {
    if (!fetchModels) return
    setBusy(true)
    try {
      const list = await fetchModels()
      setModels(list)
      if (list.length === 0) toast.warning('The server returned no models.')
      else toast.success(`${list.length} model${list.length === 1 ? '' : 's'} found`)
    } catch (err) {
      toast.error(err, 'Could not fetch models')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex gap-2">
      <Input
        id={id}
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? 'model name'}
        spellCheck={false}
        className="font-mono text-[13px]"
      />
      <datalist id={listId}>
        {models.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      {fetchModels && (
        <Button variant="outline" onClick={() => void run()} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} Fetch models
        </Button>
      )}
    </div>
  )
}

export function TestResultPanel({ result, action }: { result: TestResult; action?: React.ReactNode }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const copy = async (): Promise<void> => {
    const e = result.error
    await navigator.clipboard.writeText([e?.message, e?.code && `Code: ${e.code}`, e?.detail].filter(Boolean).join('\n\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div
      role="status"
      className={cn(
        'rounded-lg border px-3 py-2.5 text-sm',
        result.ok ? 'border-emerald/40 bg-emerald/10' : 'border-crimson/40 bg-crimson/10'
      )}
    >
      <div className="flex items-center gap-2">
        {result.ok ? <CheckCircle2 className="size-4 text-emerald" /> : <XCircle className="size-4 text-crimson" />}
        <span className="font-medium">{result.ok ? 'Connected' : 'Failed'}</span>
        <span className="text-xs text-muted-foreground">{result.ms} ms</span>
        {!result.ok && result.error?.detail && (
          <button type="button" onClick={() => void copy()} className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <Copy className="size-3" /> {copied ? 'Copied' : 'Copy details'}
          </button>
        )}
      </div>
      {result.ok && result.sample && <p className="selectable mt-1.5 font-serif text-[15px] whitespace-pre-wrap text-parchment">{result.sample}</p>}
      {result.ok && result.notice && (
        <p className="selectable mt-2 flex gap-1.5 text-xs leading-relaxed text-gold">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {/* Keep command-line flags like "--contextsize 8192" on one line. */}
            {result.notice.split(/(--[a-z-]+(?: \d+)?)/).map((part, i) => (i % 2 ? <code key={i} className="font-mono whitespace-nowrap">{part}</code> : part))}
          </span>
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
      {result.imageDataUrl && <img src={result.imageDataUrl} alt="Test image" className="mt-2 max-h-48 rounded-md" />}
      {!result.ok && result.error && <p className="selectable mt-1.5 text-xs leading-relaxed">{result.error.message}</p>}
    </div>
  )
}

/** Collapsible group inside an editor. */
export function Disclosure({
  title,
  defaultOpen,
  children,
  badge
}: {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
  badge?: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(!!defaultOpen)
  return (
    <section className="rounded-lg border bg-background/30">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium hover:bg-accent/50"
      >
        <ChevronRight className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-90')} />
        {title}
        {badge && <span className="ml-auto">{badge}</span>}
      </button>
      {open && <div className="space-y-4 border-t px-4 py-4">{children}</div>}
    </section>
  )
}
