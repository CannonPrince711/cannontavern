import { useEffect, useMemo, useState } from 'react'
import { Dices, EyeOff } from 'lucide-react'
import { CONDITION_NOTES } from '@shared/checks'
import { roll } from '@shared/dice'
import { editionOf, type Edition } from '@shared/editions'
import type { Campaign, Party, RollResult } from '@shared/types'
import { BOND_STATUSES, bondIcon, type Bond } from '@shared/bonds'
import { NativeSelect } from '@/components/ui/controls'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { invoke } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { toast } from '@/stores/toasts'
import { useUi } from '@/stores/ui'
import { useVault } from '@/stores/vault'

const DCS: Record<Edition, [string, number][]> = {
  '5e': [['Very easy', 5], ['Easy', 10], ['Medium', 15], ['Hard', 20], ['Very hard', 25], ['Nearly impossible', 30]],
  '3.5e': [['Very easy', 0], ['Easy', 5], ['Average', 10], ['Tough', 15], ['Challenging', 20], ['Formidable', 25], ['Heroic', 30], ['Nearly impossible', 40]]
}

/** The "Secrets (for the DM)" section of a campaign note, as list items. */
function secretsOf(c: Campaign | null): string[] {
  if (!c) return []
  const section = /^##\s+Secrets[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/im.exec(c.body)?.[1] ?? ''
  return section
    .split('\n')
    .map((l) => l.replace(/^\s*[-*]\s+/, '').replace(/\*\*/g, '').trim())
    .filter(Boolean)
}

/** DM-only tools: private rolls, DCs, condition reminders, campaign secrets and NPCs. */
export function DmScreen(): React.JSX.Element {
  const activeCampaign = useVault((s) => s.activeCampaign)
  const npcs = useVault((s) => s.index?.npcs)
  const characters = useVault((s) => s.index?.characters)
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [party, setParty] = useState<Party | null>(null)
  const [expr, setExpr] = useState('1d20')
  const [rolls, setRolls] = useState<RollResult[]>([])

  useEffect(() => {
    if (!activeCampaign) return setCampaign(null)
    let stale = false
    invoke('campaigns:get', activeCampaign)
      .then((r) => {
        if (stale) return
        setCampaign(r.campaign)
        setParty(r.party)
      })
      .catch(() => {})
    return () => {
      stale = true
    }
  }, [activeCampaign])

  const edition = editionOf(campaign)
  const secrets = useMemo(() => secretsOf(campaign), [campaign])
  const privateRoll = (e: string): void => {
    try {
      const r = roll(e)
      setRolls((list) => [r, ...list].slice(0, 12))
    } catch (err) {
      toast.error(err, 'Not a dice expression')
    }
  }

  return (
    <div className="space-y-5 p-3 text-sm">
      <section className="space-y-2">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          <EyeOff className="size-3.5" /> Private rolls
        </h3>
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            if (expr.trim()) privateRoll(expr.trim())
          }}
        >
          <Input value={expr} onChange={(e) => setExpr(e.target.value)} aria-label="Dice to roll privately" className="h-8 font-mono" />
          <Button type="submit" size="sm" variant="outline">
            <Dices /> Roll
          </Button>
        </form>
        <div className="flex flex-wrap gap-1">
          {['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'].map((d) => (
            <button key={d} type="button" onClick={() => privateRoll(`1${d}`)} className="rounded border bg-card px-2 py-0.5 font-mono text-xs hover:border-primary">
              {d}
            </button>
          ))}
        </div>
        {rolls.length > 0 && (
          <ul className="space-y-0.5 text-xs" aria-label="Private roll results">
            {rolls.map((r, i) => (
              <li key={i} className={cn('flex justify-between rounded px-1.5 py-0.5', i === 0 && 'bg-accent')}>
                <span className="font-mono text-muted-foreground">{r.expression}</span>
                <span className="font-display font-semibold">{r.total}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-muted-foreground">Only you see these; nothing is posted to the session.</p>
      </section>

      {activeCampaign && party && (
        <Relationships
          bonds={party.bonds ?? []}
          names={[...(characters ?? []), ...(npcs ?? [])].map((c) => c.displayName)}
          onChange={(bonds) =>
            void invoke('campaigns:saveParty', activeCampaign, { ...party, bonds })
              .then(setParty)
              .catch((err) => toast.error(err, 'Couldn’t save the relationships'))
          }
        />
      )}

      {secrets.length > 0 && (
        <section className="space-y-1.5">
          <h3 className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">Campaign secrets</h3>
          <ul className="space-y-1 text-xs leading-relaxed">
            {secrets.map((s) => (
              <li key={s} className="rounded-md border border-gold/30 bg-gold/5 px-2 py-1">
                {s}
              </li>
            ))}
          </ul>
        </section>
      )}

      {npcs && npcs.length > 0 && (
        <section className="space-y-1">
          <h3 className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">NPCs</h3>
          <div className="flex flex-wrap gap-1">
            {npcs.map((n) => (
              <button key={n.path} type="button" onClick={() => useUi.setState({ editingCharacter: n.path })} className="rounded-full border bg-card px-2 py-0.5 text-xs hover:border-primary">
                {n.displayName}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-1.5">
        <h3 className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">Difficulty classes ({edition})</h3>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
          {DCS[edition].map(([label, dc]) => (
            <div key={label} className="flex justify-between">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-mono">{dc}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-1.5">
        <h3 className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">Conditions</h3>
        <dl className="space-y-1 text-xs">
          {CONDITION_NOTES[edition].map(([name, note]) => (
            <div key={name}>
              <dt className="inline font-medium">{name}: </dt>
              <dd className="inline text-muted-foreground">{note}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  )
}

/** Who is what to whom in this campaign. The DM updates it with <bond> tags; edit it here any time. */
function Relationships({ bonds, names, onChange }: { bonds: Bond[]; names: string[]; onChange: (bonds: Bond[]) => void }): React.JSX.Element {
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [status, setStatus] = useState<string>('friends')
  const add = (): void => {
    if (!a.trim() || !b.trim() || a.trim().toLowerCase() === b.trim().toLowerCase()) return
    const key = (x: Bond): string => [x.a, x.b].map((n) => n.toLowerCase()).sort().join('|')
    const next: Bond = { a: a.trim(), b: b.trim(), status }
    onChange([...bonds.filter((x) => key(x) !== key(next)), next])
    setA('')
    setB('')
  }
  return (
    <section className="space-y-1.5">
      <h3 className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">Relationships</h3>
      {bonds.length === 0 && <p className="text-xs text-muted-foreground">None yet. The DM adds them at turning points, or add one below.</p>}
      <ul className="space-y-1">
        {bonds.map((x, i) => (
          <li key={`${x.a}|${x.b}`} className="flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs">
            <span aria-hidden>{bondIcon(x.status)}</span>
            <span className="min-w-0 flex-1 truncate" title={x.since ? `Since ${x.since}` : undefined}>
              {x.a} & {x.b}
            </span>
            <NativeSelect value={x.status} onChange={(e) => onChange(bonds.map((y, j) => (j === i ? { ...y, status: e.target.value } : y)))} className="h-6 w-28 text-xs" aria-label={`${x.a} and ${x.b}`}>
              {[...new Set([x.status, ...BOND_STATUSES])].map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </NativeSelect>
            <button type="button" aria-label={`Remove ${x.a} and ${x.b}`} onClick={() => onChange(bonds.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-crimson">
              ×
            </button>
          </li>
        ))}
      </ul>
      <form
        className="grid grid-cols-[1fr_1fr_6.5rem_auto] gap-1"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <Input value={a} onChange={(e) => setA(e.target.value)} list="bond-names" placeholder="Character" className="h-7 text-xs" aria-label="First character" />
        <Input value={b} onChange={(e) => setB(e.target.value)} list="bond-names" placeholder="Character" className="h-7 text-xs" aria-label="Second character" />
        <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)} className="h-7 text-xs" aria-label="Relationship">
          {BOND_STATUSES.map((st) => (
            <option key={st} value={st}>
              {st}
            </option>
          ))}
        </NativeSelect>
        <Button type="submit" size="sm" variant="outline" className="h-7">
          Add
        </Button>
        <datalist id="bond-names">
          {names.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </form>
    </section>
  )
}
