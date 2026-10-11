import { useEffect, useMemo, useState } from 'react'
import { Dices, EyeOff } from 'lucide-react'
import { roll } from '@shared/dice'
import { editionOf, type Edition } from '@shared/editions'
import type { Campaign, RollResult } from '@shared/types'
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

/** Short reminders, in our own words, of what common conditions do. */
const CONDITION_NOTES: Record<Edition, [string, string][]> = {
  '5e': [
    ['Blinded', 'Can’t see; attacks against it have advantage, its attacks have disadvantage.'],
    ['Charmed', 'Won’t attack the charmer; the charmer has advantage on social checks with it.'],
    ['Frightened', 'Disadvantage on checks and attacks while the source is in sight; can’t move closer.'],
    ['Grappled', 'Speed 0 until it escapes or the grappler is moved away.'],
    ['Incapacitated', 'No actions or reactions.'],
    ['Invisible', 'Attacks against it have disadvantage; its attacks have advantage.'],
    ['Paralyzed', 'Incapacitated, fails STR/DEX saves; hits from within 5 ft are crits.'],
    ['Poisoned', 'Disadvantage on attack rolls and ability checks.'],
    ['Prone', 'Melee attacks against it have advantage, ranged have disadvantage; standing costs half speed.'],
    ['Restrained', 'Speed 0; attacks against it have advantage; disadvantage on DEX saves and its attacks.'],
    ['Stunned', 'Incapacitated, can barely speak, fails STR/DEX saves; attacks against it have advantage.'],
    ['Unconscious', 'Drops prone, fails STR/DEX saves; melee hits within 5 ft are crits.'],
    ['Exhaustion', 'Cumulative levels: penalties grow until death at the last level.']
  ],
  '3.5e': [
    ['Blinded', '−2 AC, loses DEX to AC, half speed, −4 on most STR/DEX skills; 50% miss chance on its attacks.'],
    ['Dazed', 'Can take no actions, but has no AC penalty.'],
    ['Entangled', '−2 attack, −4 DEX, half speed; casting needs a Concentration check.'],
    ['Fatigued', '−2 STR and DEX; can’t run or charge. Exhausted is worse (−6, half speed).'],
    ['Flat-footed', 'Hasn’t acted yet in combat: loses DEX bonus to AC, no attacks of opportunity.'],
    ['Grappling', 'Can’t move freely; limited actions; loses DEX to AC against others.'],
    ['Helpless', 'Melee attacks get +4; can be coup de grâced; treated as DEX 0.'],
    ['Nauseated', 'Can only take a single move action each turn.'],
    ['Prone', '−4 melee attack; +4 AC against ranged, −4 AC against melee.'],
    ['Shaken', '−2 on attacks, saves, skill and ability checks. Frightened/panicked are worse.'],
    ['Sickened', '−2 on attacks, weapon damage, saves, skill and ability checks.'],
    ['Stunned', 'Drops what it holds, no actions, −2 AC, loses DEX to AC.']
  ]
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
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [expr, setExpr] = useState('1d20')
  const [rolls, setRolls] = useState<RollResult[]>([])

  useEffect(() => {
    if (!activeCampaign) return setCampaign(null)
    let stale = false
    invoke('campaigns:get', activeCampaign)
      .then((r) => !stale && setCampaign(r.campaign))
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
