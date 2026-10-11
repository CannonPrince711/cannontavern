import { useState } from 'react'
import { BedDouble, Coffee, Heart, Minus, Pencil, Plus, ScrollText, Shield, Sparkles, Swords, Trash2, TrendingUp, X, Zap } from 'lucide-react'
import { ABILITIES, CONDITIONS, SKILLS, XP_FOR_LEVEL, checkBonus, levelForXp } from '@shared/checks'
import { defaultSheet } from '@shared/notes'
import { modifier, signed } from '@shared/prompt'
import { damage, heal, hitDie, levelUp, longRest, shortRest } from '@shared/sheet'
import type { DndSheet } from '@shared/types'
import { askConfirm } from '@/components/AskDialog'
import { CharacterAvatar, hpColor } from '@/components/CharacterAvatar'
import { EmptyState } from '@/components/EmptyState'
import { HoodArt } from '@/components/illustrations'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/controls'
import { Input } from '@/components/ui/input'
import { Tip } from '@/components/ui/tooltip'
import { useActiveCharacterPath, useCharacterNote } from '@/hooks/useActiveCharacter'
import { rollCheckFor } from '@/lib/rolls'
import { cn } from '@/lib/utils'
import { useChat } from '@/stores/chat'
import { toast } from '@/stores/toasts'
import { useUi } from '@/stores/ui'
import { useVault } from '@/stores/vault'

/** A number that turns into an input when clicked. */
function EditableNumber({ value, onCommit, label, className, min, max }: { value: number; onCommit: (v: number) => void; label: string; className?: string; min?: number; max?: number }): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value))
  if (editing) {
    const commit = (): void => {
      setEditing(false)
      const n = Number(draft)
      if (Number.isFinite(n) && n !== value) onCommit(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, Math.round(n))))
    }
    return (
      <input
        autoFocus
        aria-label={label}
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setEditing(false)
        }}
        className={cn('w-14 rounded border border-ring bg-background px-1 text-center outline-none', className)}
      />
    )
  }
  return (
    <button type="button" aria-label={`${label}: ${value}. Click to edit`} onClick={() => (setDraft(String(value)), setEditing(true))} className={cn('rounded px-1 hover:bg-accent', className)}>
      {value}
    </button>
  )
}

function EditableText({ value, onCommit, label, placeholder, className }: { value: string; onCommit: (v: string) => void; label: string; placeholder: string; className?: string }): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  if (editing) {
    const commit = (): void => {
      setEditing(false)
      if (draft.trim() !== value) onCommit(draft.trim())
    }
    return <input autoFocus aria-label={label} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} className={cn('w-24 rounded border border-ring bg-background px-1 outline-none', className)} />
  }
  return (
    <button type="button" aria-label={`${label}. Click to edit`} onClick={() => (setDraft(value), setEditing(true))} className={cn('rounded px-0.5 hover:bg-accent', !value && 'text-muted-foreground italic', className)}>
      {value || placeholder}
    </button>
  )
}

function Section({ title, icon: Icon, children, action }: { title: string; icon: React.ElementType; children: React.ReactNode; action?: React.ReactNode }): React.JSX.Element {
  return (
    <section className="border-t px-3 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          <Icon className="size-3.5 text-gold" /> {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  )
}

export function SheetPanel(): React.JSX.Element {
  const path = useActiveCharacterPath()
  const { note, updateSheet } = useCharacterNote(path)
  const rootFolder = useVault((s) => s.index?.rootFolder ?? 'DND Tavern')
  const hasSession = useChat((s) => !!s.session)
  const [amount, setAmount] = useState('')
  const [newItem, setNewItem] = useState('')
  const [newSpell, setNewSpell] = useState('')

  if (!path) {
    return (
      <EmptyState
        illustration={<HoodArt />}
        title="No character"
        description={hasSession ? 'This session has no character. Pick one in the session header.' : 'Select a character in the sidebar to see their sheet.'}
        className="pt-16"
      />
    )
  }
  if (!note) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>
  const sheet = note.card.dnd
  const avatar = note.card.avatar ? (note.card.avatar.includes('/') ? note.card.avatar : `${rootFolder}/Characters/avatars/${note.card.avatar}`) : undefined

  if (!sheet) {
    return (
      <EmptyState
        illustration={<HoodArt />}
        title={`${note.card.name} has no sheet`}
        description="Add a D&D 5e sheet: it’s stored in the character note’s frontmatter under dnd:."
        action={<Button onClick={() => void updateSheet(defaultSheet())}>Add D&D sheet</Button>}
        className="pt-16"
      />
    )
  }

  const set = (patch: Partial<DndSheet>): void => void updateSheet(patch)
  const roll = (target: string, save = false): void => void rollCheckFor(target, undefined, { save }).catch((e) => toast.error(e))
  const hpRatio = sheet.max_hp ? sheet.hp / sheet.max_hp : 0
  const nextXp = XP_FOR_LEVEL[Math.min(20, sheet.level + 1)] ?? sheet.xp
  const canLevel = sheet.level < 20 && levelForXp(sheet.xp) > sheet.level
  const n = Math.max(0, Math.round(Number(amount) || 0))

  const doLevelUp = async (): Promise<void> => {
    if (!(await askConfirm({ title: `Level up to ${sheet.level + 1}?`, description: `Max HP rises by the average of a d${hitDie(sheet)} plus CON; proficiency updates automatically.`, confirmLabel: 'Level up' }))) return
    const r = levelUp(sheet)
    set(r.sheet)
    void useChat.getState().post({ role: 'system', text: `${note.card.name} reached level ${r.sheet.level} (+${r.hpGain} max HP).`, swipes: [], swipeIndex: 0 })
  }

  return (
    <div className="pb-6 text-sm">
      {/* Identity */}
      <div className="flex items-center gap-3 px-3 py-3">
        <CharacterAvatar name={note.card.name} avatar={avatar} version={note.mtimeMs} hp={sheet.hp} maxHp={sheet.max_hp} size={52} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <h2 className="truncate font-display text-base font-semibold tracking-wide">{note.card.name}</h2>
            <Tip label="Edit card">
              <button type="button" aria-label="Edit card" onClick={() => useUi.setState({ editingCharacter: path })} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
                <Pencil className="size-3" />
              </button>
            </Tip>
          </div>
          <p className="text-xs text-muted-foreground">
            <EditableText value={sheet.race} label="Race" placeholder="Race" onCommit={(v) => set({ race: v })} />{' '}
            <EditableText value={sheet.class} label="Class" placeholder="Class" onCommit={(v) => set({ class: v })} /> · Level{' '}
            <EditableNumber value={sheet.level} label="Level" min={1} max={20} onCommit={(v) => set({ level: v })} />
          </p>
        </div>
      </div>

      {/* HP */}
      <div className="px-3 pb-3">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Heart className="size-3.5 text-crimson" /> Hit points
          </span>
          <span className="font-display text-lg font-semibold tabular-nums">
            <EditableNumber value={sheet.hp} label="Current HP" min={0} max={sheet.max_hp} onCommit={(v) => set({ hp: v })} />
            <span className="text-muted-foreground">/</span>
            <EditableNumber value={sheet.max_hp} label="Max HP" min={1} onCommit={(v) => set({ max_hp: v, hp: Math.min(sheet.hp, v) })} />
            {sheet.temp_hp > 0 && <span className="ml-1 text-sm text-gold">+{sheet.temp_hp}</span>}
          </span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-muted" role="meter" aria-label="Hit points" aria-valuenow={sheet.hp} aria-valuemin={0} aria-valuemax={sheet.max_hp}>
          <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(0, Math.min(100, hpRatio * 100))}%`, background: hpColor(hpRatio) }} />
        </div>
        <div className="mt-2 flex gap-1.5">
          <Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))} placeholder="0" aria-label="Amount" className="h-8 w-16 text-center" inputMode="numeric" />
          <Button size="sm" variant="outline" className="flex-1 border-crimson/50 text-crimson hover:bg-crimson/10" disabled={!n} onClick={() => (set(damage(sheet, n)), setAmount(''))}>
            Damage
          </Button>
          <Button size="sm" variant="outline" className="flex-1 border-emerald/50 text-emerald hover:bg-emerald/10" disabled={!n} onClick={() => (set(heal(sheet, n)), setAmount(''))}>
            Heal
          </Button>
          <Tip label="Add temporary HP">
            <Button size="sm" variant="outline" disabled={!n} onClick={() => (set({ temp_hp: Math.max(sheet.temp_hp, n) }), setAmount(''))}>
              Temp
            </Button>
          </Tip>
        </div>
      </div>

      {/* Core stats */}
      <div className="grid grid-cols-4 gap-1.5 px-3 pb-3 text-center">
        {[
          { label: 'AC', icon: Shield, node: <EditableNumber value={sheet.ac} label="Armor class" min={0} onCommit={(v) => set({ ac: v })} /> },
          { label: 'Speed', icon: Zap, node: <EditableNumber value={sheet.speed} label="Speed" min={0} onCommit={(v) => set({ speed: v })} /> },
          {
            label: 'Init',
            icon: Swords,
            node: (
              <button type="button" onClick={() => roll('dex')} className="rounded px-1 hover:bg-accent" aria-label="Roll initiative (Dexterity check)">
                {signed(modifier(sheet.dex))}
              </button>
            )
          },
          { label: 'Prof', icon: Sparkles, node: <span>{signed(sheet.proficiency_bonus)}</span> }
        ].map(({ label, icon: Icon, node }) => (
          <div key={label} className="rounded-lg border bg-card py-1.5">
            <div className="flex items-center justify-center gap-1 text-[10px] tracking-wider text-muted-foreground uppercase">
              <Icon className="size-3" /> {label}
            </div>
            <div className="font-display text-base font-semibold tabular-nums">{node}</div>
          </div>
        ))}
      </div>

      {/* XP */}
      <div className="px-3 pb-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            XP <EditableNumber value={sheet.xp} label="Experience points" min={0} onCommit={(v) => set({ xp: v })} />
            {sheet.level < 20 && <> / {nextXp.toLocaleString()}</>}
          </span>
          {canLevel ? (
            <Button size="sm" className="h-6 px-2 text-[11px]" onClick={() => void doLevelUp()}>
              <TrendingUp /> Level up
            </Button>
          ) : (
            <button type="button" className="text-[11px] hover:text-foreground" onClick={() => void doLevelUp()}>
              Level up…
            </button>
          )}
        </div>
        {sheet.level < 20 && (
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-gold" style={{ width: `${Math.min(100, ((sheet.xp - (XP_FOR_LEVEL[sheet.level] ?? 0)) / Math.max(1, nextXp - (XP_FOR_LEVEL[sheet.level] ?? 0))) * 100)}%` }} />
          </div>
        )}
      </div>

      {/* Abilities */}
      <Section title="Abilities" icon={ScrollText}>
        <div className="grid grid-cols-3 gap-1.5">
          {ABILITIES.map(({ key, name }) => {
            const save = checkBonus(sheet, { kind: 'save', ability: key, name })
            const proficient = sheet.saves.includes(key)
            return (
              <div key={key} className="rounded-lg border bg-card px-1 py-1.5 text-center">
                <div className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{key}</div>
                <Tip label={`${name} check`}>
                  <button type="button" onClick={() => roll(key)} className="font-display text-lg font-semibold tabular-nums hover:text-gold" aria-label={`Roll ${name} check (${signed(modifier(sheet[key]))})`}>
                    {signed(modifier(sheet[key]))}
                  </button>
                </Tip>
                <div className="text-[11px] text-muted-foreground">
                  <EditableNumber value={sheet[key]} label={`${name} score`} min={1} max={30} onCommit={(v) => set({ [key]: v } as Partial<DndSheet>)} />
                </div>
                <div className="mt-0.5 flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
                  <button
                    type="button"
                    aria-label={`${proficient ? 'Remove' : 'Add'} ${name} save proficiency`}
                    aria-pressed={proficient}
                    onClick={() => set({ saves: proficient ? sheet.saves.filter((s) => s !== key) : [...sheet.saves, key] })}
                    className={cn('size-2.5 rounded-full border', proficient ? 'border-gold bg-gold' : 'border-muted-foreground')}
                  />
                  <button type="button" onClick={() => roll(key, true)} className="hover:text-foreground" aria-label={`Roll ${name} save (${signed(save.bonus)})`}>
                    save {signed(save.bonus)}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </Section>

      {/* Skills */}
      <Section title="Skills" icon={Sparkles}>
        <ul className="grid grid-cols-1 gap-0.5">
          {SKILLS.map((s) => {
            const proficient = sheet.skills.includes(s.key)
            const { bonus } = checkBonus(sheet, { kind: 'skill', ability: s.ability, name: s.name, skill: s.key })
            return (
              <li key={s.key} className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-accent/60">
                <button
                  type="button"
                  aria-label={`${proficient ? 'Remove' : 'Add'} ${s.name} proficiency`}
                  aria-pressed={proficient}
                  onClick={() => set({ skills: proficient ? sheet.skills.filter((k) => k !== s.key) : [...sheet.skills, s.key] })}
                  className={cn('size-2.5 shrink-0 rounded-full border', proficient ? 'border-gold bg-gold' : 'border-muted-foreground')}
                />
                <button type="button" onClick={() => roll(s.key)} className="flex flex-1 items-center justify-between text-left" aria-label={`Roll ${s.name} (${signed(bonus)})`}>
                  <span className={cn('text-xs', proficient ? 'text-foreground' : 'text-muted-foreground')}>
                    {s.name} <span className="text-[10px] uppercase opacity-60">{s.ability}</span>
                  </span>
                  <span className="font-mono text-xs tabular-nums">{signed(bonus)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </Section>

      {/* Conditions */}
      <Section
        title="Conditions"
        icon={Zap}
        action={
          <NativeSelect value="" aria-label="Add condition" className="w-32" onChange={(e) => e.target.value && set({ conditions: [...new Set([...sheet.conditions, e.target.value])] })}>
            <option value="">Add…</option>
            {CONDITIONS.filter((c) => !sheet.conditions.includes(c)).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </NativeSelect>
        }
      >
        {sheet.conditions.length === 0 ? (
          <p className="text-xs text-muted-foreground">None.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {sheet.conditions.map((c) => (
              <span key={c} className="flex items-center gap-1 rounded-full border border-crimson/40 bg-crimson/10 px-2 py-0.5 text-xs capitalize text-crimson">
                {c}
                <button type="button" aria-label={`Remove ${c}`} onClick={() => set({ conditions: sheet.conditions.filter((x) => x !== c) })}>
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </Section>

      {/* Inventory */}
      <Section
        title="Inventory"
        icon={ScrollText}
        action={
          <span className="text-xs text-muted-foreground">
            <EditableNumber value={sheet.gold} label="Gold" min={0} onCommit={(v) => set({ gold: v })} className="text-gold" /> gp
          </span>
        }
      >
        <ul className="space-y-0.5">
          {sheet.inventory.map((item, i) => (
            <li key={`${item.name}-${i}`} className="group flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-accent/60">
              <button
                type="button"
                aria-label={`${item.equipped ? 'Unequip' : 'Equip'} ${item.name}`}
                aria-pressed={!!item.equipped}
                onClick={() => set({ inventory: sheet.inventory.map((x, j) => (j === i ? { ...x, equipped: !x.equipped } : x)) })}
                className={cn('size-2.5 shrink-0 rotate-45 border', item.equipped ? 'border-gold bg-gold' : 'border-muted-foreground')}
              />
              <span className="min-w-0 flex-1 truncate text-xs">{item.name}</span>
              <button type="button" aria-label={`One fewer ${item.name}`} onClick={() => set({ inventory: item.qty > 1 ? sheet.inventory.map((x, j) => (j === i ? { ...x, qty: x.qty - 1 } : x)) : sheet.inventory.filter((_, j) => j !== i) })} className="opacity-0 group-hover:opacity-100">
                <Minus className="size-3" />
              </button>
              <span className="w-6 text-center font-mono text-xs tabular-nums">×{item.qty}</span>
              <button type="button" aria-label={`One more ${item.name}`} onClick={() => set({ inventory: sheet.inventory.map((x, j) => (j === i ? { ...x, qty: x.qty + 1 } : x)) })} className="opacity-0 group-hover:opacity-100">
                <Plus className="size-3" />
              </button>
              <button type="button" aria-label={`Remove ${item.name}`} onClick={() => set({ inventory: sheet.inventory.filter((_, j) => j !== i) })} className="text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-crimson">
                <Trash2 className="size-3" />
              </button>
            </li>
          ))}
        </ul>
        <form
          className="mt-1.5 flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            if (!newItem.trim()) return
            set({ inventory: [...sheet.inventory, { name: newItem.trim(), qty: 1 }] })
            setNewItem('')
          }}
        >
          <Input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Add an item" className="h-7 text-xs" aria-label="New item" />
          <Button type="submit" size="icon-sm" variant="outline" aria-label="Add item" disabled={!newItem.trim()}>
            <Plus />
          </Button>
        </form>
      </Section>

      {/* Spells */}
      <Section title="Spells" icon={Sparkles}>
        <div className="mb-2 space-y-1">
          {Array.from({ length: 9 }, (_, i) => String(i + 1)).map((lvl) => {
            const slot = sheet.spell_slots[lvl] ?? { max: 0, used: 0 }
            if (!slot.max && Number(lvl) > 1 && !sheet.spell_slots[String(Number(lvl) - 1)]?.max) return null
            return (
              <div key={lvl} className="flex items-center gap-2 text-xs">
                <span className="w-10 text-muted-foreground">Lv {lvl}</span>
                <div className="flex flex-1 flex-wrap gap-1">
                  {Array.from({ length: slot.max }, (_, k) => (
                    <button
                      key={k}
                      type="button"
                      aria-label={`Level ${lvl} slot ${k + 1}: ${k < slot.used ? 'used' : 'available'}`}
                      onClick={() => set({ spell_slots: { ...sheet.spell_slots, [lvl]: { ...slot, used: k < slot.used ? k : k + 1 } } })}
                      className={cn('size-3.5 rounded-full border-2', k < slot.used ? 'border-muted-foreground bg-transparent' : 'border-gold bg-gold')}
                    />
                  ))}
                  {slot.max === 0 && <span className="text-muted-foreground">no slots</span>}
                </div>
                <button type="button" aria-label={`Fewer level ${lvl} slots`} onClick={() => set({ spell_slots: { ...sheet.spell_slots, [lvl]: { max: Math.max(0, slot.max - 1), used: Math.min(slot.used, Math.max(0, slot.max - 1)) } } })} className="text-muted-foreground hover:text-foreground">
                  <Minus className="size-3" />
                </button>
                <button type="button" aria-label={`More level ${lvl} slots`} onClick={() => set({ spell_slots: { ...sheet.spell_slots, [lvl]: { ...slot, max: Math.min(9, slot.max + 1) } } })} className="text-muted-foreground hover:text-foreground">
                  <Plus className="size-3" />
                </button>
              </div>
            )
          })}
        </div>
        <ul className="space-y-0.5">
          {sheet.spells.map((sp, i) => (
            <li key={`${sp.name}-${i}`} className="group flex items-center gap-1.5 rounded px-1 py-0.5 text-xs hover:bg-accent/60">
              <span className="w-6 text-center text-[10px] text-muted-foreground">{sp.level === 0 ? 'C' : sp.level}</span>
              <span className="flex-1 truncate">{sp.name}</span>
              <button type="button" aria-label={`Remove ${sp.name}`} onClick={() => set({ spells: sheet.spells.filter((_, j) => j !== i) })} className="text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-crimson">
                <Trash2 className="size-3" />
              </button>
            </li>
          ))}
        </ul>
        <form
          className="mt-1.5 flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            const m = /^(.*?)(?:\s+(\d))?$/.exec(newSpell.trim())
            if (!m?.[1]) return
            set({ spells: [...sheet.spells, { name: m[1], level: Number(m[2] ?? 0) }] })
            setNewSpell('')
          }}
        >
          <Input value={newSpell} onChange={(e) => setNewSpell(e.target.value)} placeholder="Add a spell, e.g. Fireball 3" className="h-7 text-xs" aria-label="New spell" />
          <Button type="submit" size="icon-sm" variant="outline" aria-label="Add spell" disabled={!newSpell.trim()}>
            <Plus />
          </Button>
        </form>
      </Section>

      {/* Rests */}
      <Section title="Rest" icon={BedDouble}>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => {
              const r = shortRest(sheet, 1)
              set(r.sheet)
              void useChat.getState().post({ role: 'system', text: `${note.card.name} takes a short rest and spends a hit die, regaining ${r.healed} HP.`, swipes: [], swipeIndex: 0 })
            }}
            disabled={(sheet.hit_dice ? sheet.hit_dice.max - sheet.hit_dice.used : sheet.level) <= 0 || sheet.hp >= sheet.max_hp}
          >
            <Coffee /> Short rest
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => {
              set(longRest(sheet))
              void useChat.getState().post({ role: 'system', text: `${note.card.name} takes a long rest.`, swipes: [], swipeIndex: 0 })
            }}
          >
            <BedDouble /> Long rest
          </Button>
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Hit dice: {(sheet.hit_dice?.max ?? sheet.level) - (sheet.hit_dice?.used ?? 0)}/{sheet.hit_dice?.max ?? sheet.level} d{hitDie(sheet)}
        </p>
      </Section>
    </div>
  )
}
