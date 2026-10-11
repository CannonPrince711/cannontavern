import { useState } from 'react'
import { Eye, EyeOff, KeyRound, Lock } from 'lucide-react'
import type { SecretInput } from '@shared/settings'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/controls'
import { Input } from '@/components/ui/input'
import { keyStorageName } from '@/lib/platform'

/**
 * Edits a secret without ever showing a stored value. A stored key shows as
 * "Stored, encrypted" with Replace/Remove. Typing "env:NAME" reads the key from
 * an environment variable instead.
 */
export function SecretField({
  id,
  value,
  onChange,
  placeholder = 'Paste key, or env:VARIABLE_NAME'
}: {
  id?: string
  value: SecretInput
  onChange: (v: SecretInput) => void
  placeholder?: string
}): React.JSX.Element {
  const [reveal, setReveal] = useState(false)

  if (value.kind === 'keep') {
    return (
      <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-background/60 px-3">
        <Lock className="size-3.5 text-emerald" aria-hidden />
        <span className="flex-1 text-sm">Stored, encrypted with {keyStorageName()}</span>
        <Button variant="ghost" size="sm" onClick={() => onChange({ kind: 'set', value: '' })}>
          Replace
        </Button>
        <Button variant="ghost" size="sm" className="text-crimson" onClick={() => onChange({ kind: 'none' })}>
          Remove
        </Button>
      </div>
    )
  }

  const text = value.kind === 'env' ? `env:${value.name}` : value.kind === 'set' || value.kind === 'plain' ? value.value : ''
  const update = (raw: string): void => {
    const env = /^env:([A-Za-z_][A-Za-z0-9_]*)?$/.exec(raw.trim())
    if (env) onChange({ kind: 'env', name: env[1] ?? '' })
    else if (!raw) onChange({ kind: 'none' })
    else onChange({ kind: 'set', value: raw })
  }

  return (
    <div className="relative">
      <KeyRound className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        id={id}
        type={reveal || value.kind === 'env' ? 'text' : 'password'}
        value={text}
        onChange={(e) => update(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className="pr-24 pl-8 font-mono text-[13px]"
      />
      <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-1">
        {value.kind === 'env' && <Badge tone="gold">env</Badge>}
        {value.kind === 'set' && value.value && <Badge tone="muted">will encrypt</Badge>}
        {value.kind !== 'env' && (
          <button
            type="button"
            aria-label={reveal ? 'Hide key' : 'Show key'}
            onClick={() => setReveal(!reveal)}
            className="rounded p-1 text-muted-foreground hover:text-foreground"
          >
            {reveal ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </button>
        )}
      </div>
    </div>
  )
}
