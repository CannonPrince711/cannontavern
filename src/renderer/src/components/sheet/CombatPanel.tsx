import { useState } from 'react'
import { ChevronLeft, ChevronRight, Dices, Flag, Minus, Plus, Shield, Trash2, UserPlus, X } from 'lucide-react'
import { CONDITIONS } from '@shared/checks'
import { removeCombatant } from '@shared/combat'
import type { Combatant } from '@shared/types'
import { hpColor } from '@/components/CharacterAvatar'
import { EmptyState } from '@/components/EmptyState'
import { SwordsArt } from '@/components/illustrations'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/controls'
import { Input } from '@/components/ui/input'
import { Tip } from '@/components/ui/tooltip'
import { addPartyToCombat, combatActions, hurt, updateCombat } from '@/lib/combat'
import { cn } from '@/lib/utils'
import { useChat } from '@/stores/chat'
import { useApp } from '@/stores/app'
import { chime, TurnTimerRing, useCountdown } from '@/components/TurnTimer'
import { toast } from '@/stores/toasts'

const run = (p: Promise<unknown>): void => void p.catch((e) => toast.error(e))

function CombatantRow({ c, current }: { c: Combatant; current: boolean }): React.JSX.Element {
  const [amount, setAmount] = useState('')
  const [expanded, setExpanded] = useState(false)
  const ratio = c.max_hp ? c.hp / c.max_hp : 0
  const n = Math.max(0, Math.round(Number(amount) || 0))
  const down = c.hp <= 0 && !c.is_player
  return (
    <li
      className={cn('rounded-lg border bg-card transition-colors', current && 'border-gold ring-1 ring-gold/60', down && 'opacity-50')}
      aria-current={current ? 'true' : undefined}
    >
      <div className="flex items-center gap-2 px-2.5 py-2">
        <span className={cn('grid size-7 shrink-0 place-items-center rounded-md font-display text-xs font-bold tabular-nums', current ? 'bg-gold text-primary-foreground' : 'bg-surface-2')}>
          {c.initiative ?? '–'}
        </span>
        <button type="button" onClick={() => setExpanded(!expanded)} className="min-w-0 flex-1 text-left" aria-expanded={expanded}>
          <span className={cn('block truncate text-sm font-medium', c.is_player && 'text-gold')}>{c.name}</span>
          <span className="mt-0.5 block h-1.5 overflow-hidden rounded-full bg-muted">
            <span className="block h-full rounded-full transition-[width]" style={{ width: `${Math.max(0, ratio * 100)}%`, background: hpColor(ratio) }} />
          </span>
        </button>
        <span className="w-14 text-right text-xs tabular-nums">
          {c.hp}/{c.max_hp}
        </span>
        <span className="flex items-center gap-0.5 text-xs text-muted-foreground" title="Armor class">
          <Shield className="size-3" />
          {c.ac}
        </span>
      </div>
      {c.conditions.length > 0 && (
        <div className="flex flex-wrap gap-1 px-2.5 pb-2">
          {c.conditions.map((cond) => (
            <span key={cond} className="flex items-center gap-0.5 rounded-full bg-crimson/10 px-1.5 py-0.5 text-[10px] capitalize text-crimson">
              {cond}
              <button type="button" aria-label={`Remove ${cond} from ${c.name}`} onClick={() => run(updateCombat((s) => ({ ...s, combatants: s.combatants.map((x) => (x.id === c.id ? { ...x, conditions: x.conditions.filter((y) => y !== cond) } : x)) })))}>
                <X className="size-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}
      {expanded && (
        <div className="flex flex-wrap items-center gap-1.5 border-t px-2.5 py-2">
          <Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} placeholder="0" aria-label={`Amount for ${c.name}`} className="h-7 w-14 text-center text-xs" />
          <Button size="sm" variant="outline" className="h-7 border-crimson/50 px-2 text-crimson" disabled={!n} onClick={() => (run(hurt(c.name, n)), setAmount(''))}>
            <Minus /> Dmg
          </Button>
          <Button size="sm" variant="outline" className="h-7 border-emerald/50 px-2 text-emerald" disabled={!n} onClick={() => (run(hurt(c.name, -n)), setAmount(''))}>
            <Plus /> Heal
          </Button>
          <NativeSelect
            value=""
            aria-label={`Add a condition to ${c.name}`}
            className="w-28"
            onChange={(e) => {
              const v = e.target.value
              if (v) run(updateCombat((s) => ({ ...s, combatants: s.combatants.map((x) => (x.id === c.id ? { ...x, conditions: [...new Set([...x.conditions, v])] } : x)) })))
            }}
          >
            <option value="">Condition…</option>
            {CONDITIONS.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </NativeSelect>
          <Button size="icon-sm" variant="ghost" aria-label={`Remove ${c.name}`} className="ml-auto text-muted-foreground hover:text-crimson" onClick={() => run(updateCombat((s) => removeCombatant(s, c.id)))}>
            <Trash2 />
          </Button>
        </div>
      )}
    </li>
  )
}

/** Counts down each combatant's turn when the turn timer is on. */
function CombatTurnTimer({ sessionPath, round, turn, name }: { sessionPath: string; round: number; turn: number; name: string }): React.JSX.Element | null {
  const timer = useApp((s) => s.settings?.play.turnTimer)
  const seconds = timer?.combatSeconds ?? 60
  const key = timer?.enabled ? `${sessionPath}|${round}|${turn}` : null
  const { remaining, paused, toggle } = useCountdown(key, seconds, () => {
    chime()
    if (timer?.onExpire === 'pass') {
      void useChat
        .getState()
        .post({ role: 'system', text: `${name}’s turn timed out.`, swipes: [], swipeIndex: 0 })
        .then(() => combatActions.next())
    } else toast.warning(`${name}’s time is up`, 'Combat turn timer.')
  })
  if (!key) return null
  return <TurnTimerRing remaining={remaining} total={seconds} paused={paused} onToggle={toggle} label="Combat turn timer" />
}

export function CombatPanel(): React.JSX.Element {
  const session = useChat((s) => s.session)
  const combat = session?.frontmatter.combat
  const [form, setForm] = useState({ name: '', hp: '', ac: '', init: '' })

  if (!session) {
    return <EmptyState illustration={<SwordsArt />} title="No session open" description="Combat is tracked per session and saved in the session note." className="pt-16" />
  }

  const add = (): void => {
    if (!form.name.trim()) return
    const args = `${form.name.trim()}${form.hp ? ` hp ${form.hp}` : ''}${form.ac ? ` ac ${form.ac}` : ''}${form.init ? ` init ${form.init}` : ''}`
    run(combatActions.add(args).then(() => setForm({ name: '', hp: '', ac: '', init: '' })))
  }

  const list = combat?.combatants ?? []
  const current = combat?.active ? list[combat.turn] : undefined

  return (
    <div className="space-y-3 p-3">
      {combat?.active && (
        <div className="flex items-center justify-between rounded-lg border border-gold/40 bg-gold/10 px-3 py-2">
          <div>
            <div className="text-[11px] tracking-widest text-gold uppercase">Round {combat.round}</div>
            <div className="text-sm font-medium">{current ? `${current.name}’s turn` : '—'}</div>
          </div>
          <div className="flex items-center gap-1">
            {current && <CombatTurnTimer sessionPath={session.path} round={combat.round} turn={combat.turn} name={current.name} />}
            <Tip label="Previous turn">
              <Button size="icon-sm" variant="ghost" aria-label="Previous turn" onClick={() => run(combatActions.prev())}>
                <ChevronLeft />
              </Button>
            </Tip>
            <Button size="sm" onClick={() => run(combatActions.next())}>
              Next <ChevronRight />
            </Button>
          </div>
        </div>
      )}

      {list.length === 0 ? (
        <EmptyState illustration={<SwordsArt />} title="No fight in progress" description="Add combatants below or type /add Goblin hp 7 ac 15 init +2." />
      ) : (
        <ol className="space-y-1.5">
          {list.map((c, i) => (
            <CombatantRow key={c.id} c={c} current={!!combat?.active && i === combat.turn} />
          ))}
        </ol>
      )}

      <form
        className="space-y-1.5 rounded-lg border bg-card/60 p-2.5"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <div className="flex gap-1.5">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name (3 Goblins adds three)" aria-label="Combatant name" className="h-8 text-xs" />
        </div>
        <div className="flex gap-1.5">
          <Input value={form.hp} onChange={(e) => setForm({ ...form, hp: e.target.value })} placeholder="HP or 2d6" aria-label="Hit points" className="h-8 text-xs" />
          <Input value={form.ac} onChange={(e) => setForm({ ...form, ac: e.target.value.replace(/\D/g, '') })} placeholder="AC" aria-label="Armor class" className="h-8 w-16 px-2 text-center text-xs" />
          <Input value={form.init} onChange={(e) => setForm({ ...form, init: e.target.value.replace(/[^\d+-]/g, '') })} placeholder="Init" aria-label="Initiative modifier" className="h-8 w-16 px-2 text-center text-xs" />
          <Button type="submit" size="sm" disabled={!form.name.trim()}>
            <Plus /> Add
          </Button>
        </div>
      </form>

      <div className="grid grid-cols-2 gap-1.5">
        <Button variant="outline" size="sm" onClick={() => run(addPartyToCombat())}>
          <UserPlus /> Add my character
        </Button>
        <Button variant="outline" size="sm" disabled={list.length === 0} onClick={() => run(combatActions.initiative())}>
          <Dices /> Roll initiative
        </Button>
        {combat && (
          <Button variant="ghost" size="sm" className="col-span-2 text-muted-foreground" onClick={() => run(combatActions.end())}>
            <Flag /> End combat
          </Button>
        )}
      </div>
    </div>
  )
}
