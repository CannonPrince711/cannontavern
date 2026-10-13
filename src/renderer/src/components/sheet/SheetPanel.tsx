import { useCampaignRuleset } from '@/components/rulesets/Rulesets'
import { useEffect, useState } from 'react'
import { BedDouble, Brain, Coffee, Coins, Flame, Heart, HeartPulse, Minus, Pencil, Plus, ScrollText, Shield, Skull, Sparkles, Star, Swords, Trash2, TrendingUp, X, Zap } from 'lucide-react'
import { ABILITIES, checkBonus, conditionNote, conditionsFor, levelForXp, skillsFor, xpForLevel } from '@shared/checks'
import { EDITION_INFO, EDITIONS, editionOf, SAVES_35, SKILLS_35, type Edition } from '@shared/editions'
import { defaultSheet } from '@shared/notes'
import { modifier, signed } from '@shared/prompt'
import { classResources, deathSave, deathState, hitDie, levelUp, longRest, shortRest } from '@shared/sheet'
import type { Coins as CoinPurse, DndSheet } from '@shared/types'
import { askConfirm } from '@/components/AskDialog'
import { CharacterAvatar, hpColor } from '@/components/CharacterAvatar'
import { EmptyState } from '@/components/EmptyState'
import { HoodArt } from '@/components/illustrations'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/controls'
import { Input } from '@/components/ui/input'
import { Tip } from '@/components/ui/tooltip'
import { useActiveCharacterPath, useCharacterNote } from '@/hooks/useActiveCharacter'
import { changeSheetHp } from '@/lib/combat'
import { postRoll, rollCheckFor } from '@/lib/rolls'
import { invoke } from '@/lib/ipc'
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

/** The active campaign's rules edition (for new sheets). */
function useCampaignEdition(): Edition {
  const campaign = useVault((s) => s.activeCampaign)
  const [edition, setEdition] = useState<Edition>('5e')
  useEffect(() => {
    if (!campaign) return
    let stale = false
    invoke('campaigns:get', campaign)
      .then((r) => !stale && setEdition(editionOf(r.campaign)))
      .catch(() => {})
    return () => {
      stale = true
    }
  }, [campaign])
  return edition
}

const DND_TERMS = { race: 'Race', class: 'Class', level: 'Level', spells: 'Spells' }

const COIN_NAMES = { pp: 'Platinum pieces', gp: 'Gold pieces', ep: 'Electrum pieces', sp: 'Silver pieces', cp: 'Copper pieces' }

export function SheetPanel(): React.JSX.Element {
  const path = useActiveCharacterPath()
  const { note, updateSheet } = useCharacterNote(path)
  const rootFolder = useVault((s) => s.index?.rootFolder ?? 'DND Tavern')
  const hasSession = useChat((s) => !!s.session)
  const [amount, setAmount] = useState('')
  const [newItem, setNewItem] = useState('')
  const [newSpell, setNewSpell] = useState('')
  const [newFeat, setNewFeat] = useState('')
  const [newResource, setNewResource] = useState('')
  const campaignEdition = useCampaignEdition()
  const terms = useCampaignRuleset()?.terms ?? DND_TERMS

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
        description="Add a D&D sheet: it’s stored in the character note’s frontmatter under dnd:."
        action={
          <div className="flex gap-2">
            {EDITIONS.map((e) => (
              <Button key={e} variant={e === campaignEdition ? 'default' : 'outline'} onClick={() => void updateSheet(defaultSheet(e))}>
                Add {EDITION_INFO[e].short} sheet
              </Button>
            ))}
          </div>
        }
        className="pt-16"
      />
    )
  }

  const set = (patch: Partial<DndSheet>): void => void updateSheet(patch)
  const roll = (target: string, save = false): void => void rollCheckFor(target, undefined, { save }).catch((e) => toast.error(e))
  const hpRatio = sheet.max_hp ? sheet.hp / sheet.max_hp : 0
  const edition = editionOf(sheet)
  const is35 = edition === '3.5e'
  const levelXp = xpForLevel(sheet.level, edition)
  const nextXp = xpForLevel(Math.min(20, sheet.level + 1), edition)
  const canLevel = sheet.level < 20 && levelForXp(sheet.xp, edition) > sheet.level
  const switchEdition = async (e: Edition): Promise<void> => {
    if (e === edition) return
    if (!(await askConfirm({ title: `Switch to ${EDITION_INFO[e].label}?`, description: e === '3.5e' ? 'Adds base attack bonus, Fort/Ref/Will saves and skill ranks (fill them in for your class). Ability scores, HP, inventory and spells stay.' : 'Uses 5e proficiencies instead of skill ranks and base saves. Ability scores, HP, inventory and spells stay.', confirmLabel: 'Switch' }))) return
    set(e === '3.5e' ? { edition: '3.5e', bab: sheet.bab ?? 0, base_saves: sheet.base_saves ?? { fort: 0, ref: 0, will: 0 }, skill_ranks: sheet.skill_ranks ?? {}, feats: sheet.feats ?? [] } : { edition: '5e' })
  }
  const n = Math.max(0, Math.round(Number(amount) || 0))

  const doLevelUp = async (): Promise<void> => {
    const description = is35
      ? `Max HP rises by the average of a d${hitDie(sheet)} plus CON. Update base attack, saves and skill ranks for your class.`
      : `Max HP rises by the average of a d${hitDie(sheet)} plus CON; proficiency updates automatically.`
    if (!(await askConfirm({ title: `Level up to ${sheet.level + 1}?`, description, confirmLabel: 'Level up' }))) return
    const r = levelUp(sheet)
    set(r.sheet)
    void useChat.getState().post({ role: 'system', text: `${note.card.name} reached level ${r.sheet.level} (+${r.hpGain} max HP).`, swipes: [], swipeIndex: 0 })
  }

  const system = (text: string): void => void useChat.getState().post({ role: 'system', text, swipes: [], swipeIndex: 0 })
  const changeHp = (delta: number): void => {
    setAmount('')
    void changeSheetHp(note.card.name, sheet, delta, updateSheet).catch((e) => toast.error(e))
  }
  const dying = deathState(sheet)
  const saves = sheet.death_saves ?? { successes: 0, failures: 0 }
  const rollDeathSave = async (): Promise<void> => {
    const r = deathSave(sheet)
    set({ hp: r.sheet.hp, death_saves: r.sheet.death_saves })
    await postRoll(r.roll, note.card.name)
    if (r.outcome === 'revived') system(`${note.card.name} rolls a natural 20 and regains 1 HP!`)
    else if (r.outcome === 'stable') system(`${note.card.name} is stable.`)
    else if (r.outcome === 'dead') system(`${note.card.name} has died.`)
  }
  const resources = sheet.resources ?? []
  const suggested = resources.length ? [] : classResources(sheet)
  const setResource = (i: number, patch: Partial<(typeof resources)[number]>): void => set({ resources: resources.map((r, j) => (j === i ? { ...r, ...patch } : r)) })
  const shortRestable = !is35 && (((sheet.hit_dice ? sheet.hit_dice.max - sheet.hit_dice.used : sheet.level) > 0 && sheet.hp < sheet.max_hp) || resources.some((r) => r.reset === 'short' && r.used > 0))

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
            {!is35 && (
              <Tip label={sheet.inspiration ? 'Inspiration (click to spend)' : 'No inspiration (click to gain)'}>
                <button
                  type="button"
                  aria-label="Inspiration"
                  aria-pressed={!!sheet.inspiration}
                  onClick={() => {
                    set({ inspiration: sheet.inspiration ? undefined : true })
                    system(sheet.inspiration ? `${note.card.name} spends inspiration.` : `${note.card.name} gains inspiration.`)
                  }}
                  className={cn('rounded p-0.5', sheet.inspiration ? 'text-gold' : 'text-muted-foreground/50 hover:text-foreground')}
                >
                  <Star className={cn('size-3.5', sheet.inspiration && 'fill-current')} />
                </button>
              </Tip>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            <EditableText value={sheet.race} label={terms.race} placeholder={terms.race} onCommit={(v) => set({ race: v })} />{' '}
            <EditableText value={sheet.class} label={terms.class} placeholder={terms.class} onCommit={(v) => set({ class: v })} /> · {terms.level}{' '}
            <EditableNumber value={sheet.level} label={terms.level} min={1} max={20} onCommit={(v) => set({ level: v })} />
          </p>
        </div>
        <div>
          <NativeSelect value={edition} onChange={(e) => void switchEdition(e.target.value as Edition)} aria-label="Rules edition" className="h-7 w-[4.75rem] text-xs">
            {EDITIONS.map((e) => (
              <option key={e} value={e}>
                {EDITION_INFO[e].short}
              </option>
            ))}
          </NativeSelect>
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
          <Button size="sm" variant="outline" className="flex-1 border-crimson/50 text-crimson hover:bg-crimson/10" disabled={!n} onClick={() => changeHp(n)}>
            Damage
          </Button>
          <Button size="sm" variant="outline" className="flex-1 border-emerald/50 text-emerald hover:bg-emerald/10" disabled={!n} onClick={() => changeHp(-n)}>
            Heal
          </Button>
          <Tip label="Add temporary HP">
            <Button size="sm" variant="outline" disabled={!n} onClick={() => (set({ temp_hp: Math.max(sheet.temp_hp, n) }), setAmount(''))}>
              Temp
            </Button>
          </Tip>
        </div>
        {dying && (
          <div className={cn('mt-2 rounded-lg border px-2 py-1.5', dying === 'dead' ? 'border-crimson/60 bg-crimson/10' : 'border-gold/40 bg-card')}>
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1 font-medium">
                {dying === 'dead' ? <Skull className="size-3.5 text-crimson" /> : <HeartPulse className="size-3.5 text-crimson" />}
                {dying === 'dead' ? 'Dead' : dying === 'stable' ? 'Stable at 0 HP' : 'Dying: death saves'}
              </span>
              {dying === 'dying' && (
                <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => void rollDeathSave().catch((e) => toast.error(e))}>
                  Roll death save
                </Button>
              )}
            </div>
            <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
              {(['successes', 'failures'] as const).map((kind) => (
                <span key={kind} className="flex items-center gap-1">
                  {kind === 'successes' ? 'Successes' : 'Failures'}
                  {[0, 1, 2].map((k) => (
                    <button
                      key={k}
                      type="button"
                      aria-label={`Death save ${kind} ${k + 1}: ${k < saves[kind] ? 'marked' : 'empty'}`}
                      onClick={() => set({ death_saves: { ...saves, [kind]: k < saves[kind] ? k : k + 1 } })}
                      className={cn('size-3 rounded-full border-2', k < saves[kind] ? (kind === 'successes' ? 'border-emerald bg-emerald' : 'border-crimson bg-crimson') : 'border-muted-foreground')}
                    />
                  ))}
                </span>
              ))}
            </div>
          </div>
        )}
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
          is35
            ? { label: 'BAB', icon: Sparkles, node: <EditableNumber value={sheet.bab ?? 0} label="Base attack bonus" min={0} max={40} onCommit={(v) => set({ bab: v })} /> }
            : { label: 'Prof', icon: Sparkles, node: <span>{signed(sheet.proficiency_bonus)}</span> }
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
            <div className="h-full bg-gold" style={{ width: `${Math.min(100, Math.max(0, ((sheet.xp - levelXp) / Math.max(1, nextXp - levelXp)) * 100))}%` }} />
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
                <div className={cn('mt-0.5 flex items-center justify-center gap-1 text-[10px] text-muted-foreground', is35 && 'hidden')}>
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

      {/* 3.5 saves */}
      {is35 && (
        <Section title="Saves" icon={Shield}>
          <div className="grid grid-cols-3 gap-1.5">
            {SAVES_35.map((sv) => {
              const base = sheet.base_saves?.[sv.key] ?? 0
              const total = base + modifier(sheet[sv.ability])
              return (
                <div key={sv.key} className="rounded-lg border bg-card px-1 py-1.5 text-center">
                  <div className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{sv.name}</div>
                  <button type="button" onClick={() => roll(sv.name.toLowerCase())} className="font-display text-lg font-semibold tabular-nums hover:text-gold" aria-label={`Roll ${sv.name} save (${signed(total)})`}>
                    {signed(total)}
                  </button>
                  <div className="text-[10px] text-muted-foreground">
                    base <EditableNumber value={base} label={`${sv.name} base save`} min={0} max={30} onCommit={(v) => set({ base_saves: { ...(sheet.base_saves ?? { fort: 0, ref: 0, will: 0 }), [sv.key]: v } })} /> + {sv.ability.toUpperCase()}
                  </div>
                </div>
              )
            })}
          </div>
        </Section>
      )}

      {/* Skills */}
      <Section title={is35 ? 'Skills (ranks)' : 'Skills'} icon={Sparkles}>
        {is35 && (
          <ul className="grid grid-cols-1 gap-0.5">
            {SKILLS_35.map((s) => {
              const ranks = sheet.skill_ranks?.[s.key] ?? 0
              const total = ranks + modifier(sheet[s.ability])
              const unusable = s.trainedOnly && ranks === 0
              return (
                <li key={s.key} className={cn('flex items-center gap-2 rounded px-1 py-0.5 hover:bg-accent/60', unusable && 'opacity-50')}>
                  <span className="w-7 text-center font-mono text-[11px] tabular-nums">
                    <EditableNumber
                      value={ranks}
                      label={`${s.name} ranks`}
                      min={0}
                      max={30}
                      onCommit={(v) => {
                        const next = { ...(sheet.skill_ranks ?? {}) }
                        if (v > 0) next[s.key] = v
                        else delete next[s.key]
                        set({ skill_ranks: next })
                      }}
                    />
                  </span>
                  <button type="button" onClick={() => roll(s.key)} className="flex flex-1 items-center justify-between text-left" aria-label={`Roll ${s.name} (${signed(total)})`} title={s.trainedOnly ? 'Trained only' : undefined}>
                    <span className={cn('text-xs', ranks > 0 ? 'text-foreground' : 'text-muted-foreground')}>
                      {s.name} <span className="text-[10px] uppercase opacity-60">{s.ability}</span>
                    </span>
                    <span className="font-mono text-xs tabular-nums">{signed(total)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        <ul className={cn('grid grid-cols-1 gap-0.5', is35 && 'hidden')}>
          {skillsFor('5e').map((s) => {
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

      {/* Feats (3.5) */}
      {is35 && (
        <Section title="Feats" icon={Sparkles}>
          {(sheet.feats ?? []).length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {(sheet.feats ?? []).map((f) => (
                <span key={f} className="flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-xs">
                  {f}
                  <button type="button" aria-label={`Remove ${f}`} onClick={() => set({ feats: (sheet.feats ?? []).filter((x) => x !== f) })}>
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <form
            className="flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              if (newFeat.trim()) set({ feats: [...new Set([...(sheet.feats ?? []), newFeat.trim()])] })
              setNewFeat('')
            }}
          >
            <Input value={newFeat} onChange={(e) => setNewFeat(e.target.value)} placeholder="Add a feat (e.g. Power Attack)" aria-label="New feat" className="h-8" />
            <Button type="submit" size="sm" variant="outline" disabled={!newFeat.trim()}>
              <Plus />
            </Button>
          </form>
        </Section>
      )}

      {/* Conditions */}
      <Section
        title="Conditions"
        icon={Zap}
        action={
          <NativeSelect value="" aria-label="Add condition" className="w-32" onChange={(e) => e.target.value && set({ conditions: [...new Set([...sheet.conditions, e.target.value])] })}>
            <option value="">Add…</option>
            {conditionsFor(edition).filter((c) => !sheet.conditions.includes(c)).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </NativeSelect>
        }
      >
        {sheet.conditions.length === 0 && !sheet.concentration ? (
          <p className="text-xs text-muted-foreground">None.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {sheet.concentration && (
              <Tip label="Concentrating: taking damage calls for a CON save (DC 10 or half the damage). Dropping to 0 HP ends it.">
                <span className="flex items-center gap-1 rounded-full border border-gold/50 bg-gold/10 px-2 py-0.5 text-xs text-gold">
                  <Brain className="size-3" /> {sheet.concentration}
                  <button type="button" aria-label={`End concentration on ${sheet.concentration}`} onClick={() => (set({ concentration: undefined }), system(`${note.card.name} stops concentrating on ${sheet.concentration}.`))}>
                    <X className="size-3" />
                  </button>
                </span>
              </Tip>
            )}
            {sheet.conditions.map((c) => (
              <Tip key={c} label={conditionNote(c, edition) ?? c}>
                <span className="flex items-center gap-1 rounded-full border border-crimson/40 bg-crimson/10 px-2 py-0.5 text-xs capitalize text-crimson">
                  {c}
                  <button type="button" aria-label={`Remove ${c}`} onClick={() => set({ conditions: sheet.conditions.filter((x) => x !== c) })}>
                    <X className="size-3" />
                  </button>
                </span>
              </Tip>
            ))}
          </div>
        )}
      </Section>

      {/* Limited-use features */}
      <Section
        title="Features"
        icon={Flame}
        action={
          suggested.length > 0 && (
            <Tip label={`Add ${suggested.map((r) => r.name).join(', ')}`}>
              <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground" onClick={() => set({ resources: suggested })}>
                Fill for {sheet.class || 'class'}
              </button>
            </Tip>
          )
        }
      >
        {resources.length === 0 && <p className="mb-1.5 text-xs text-muted-foreground">Track uses of Rage, Ki, Channel Divinity and the like.</p>}
        <ul className="space-y-1">
          {resources.map((r, i) => (
            <li key={`${r.name}-${i}`} className="group flex items-center gap-1.5 rounded px-1 py-0.5 text-xs hover:bg-accent/60">
              <span className="min-w-0 flex-1 truncate">{r.name}</span>
              {r.max <= 10 ? (
                <span className="flex gap-1">
                  {Array.from({ length: r.max }, (_, k) => (
                    <button
                      key={k}
                      type="button"
                      aria-label={`${r.name} use ${k + 1}: ${k < r.used ? 'spent' : 'available'}`}
                      onClick={() => setResource(i, { used: k < r.used ? k : k + 1 })}
                      className={cn('size-3 rounded-full border-2', k < r.used ? 'border-muted-foreground' : 'border-gold bg-gold')}
                    />
                  ))}
                </span>
              ) : (
                <span className="flex items-center gap-1 font-mono tabular-nums">
                  <button type="button" aria-label={`Spend ${r.name}`} onClick={() => setResource(i, { used: Math.min(r.max, r.used + 1) })} className="text-muted-foreground hover:text-foreground">
                    <Minus className="size-3" />
                  </button>
                  {r.max - r.used}/{r.max}
                  <button type="button" aria-label={`Regain ${r.name}`} onClick={() => setResource(i, { used: Math.max(0, r.used - 1) })} className="text-muted-foreground hover:text-foreground">
                    <Plus className="size-3" />
                  </button>
                </span>
              )}
              <Tip label={is35 ? 'Per day' : `Recharges on a ${r.reset} rest (click to change)`}>
                <button type="button" aria-label={`${r.name} recharges on a ${r.reset} rest`} disabled={is35} onClick={() => setResource(i, { reset: r.reset === 'short' ? 'long' : 'short' })} className="w-4 text-center text-[10px] text-muted-foreground uppercase">
                  {is35 ? 'D' : r.reset[0]}
                </button>
              </Tip>
              <button type="button" aria-label={`Remove ${r.name}`} onClick={() => set({ resources: resources.filter((_, j) => j !== i) })} className="text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-crimson">
                <Trash2 className="size-3" />
              </button>
            </li>
          ))}
        </ul>
        <form
          className="mt-1.5 flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            const m = /^(.*?)\s+(\d+)(?:\s+(short|long))?$/i.exec(newResource.trim())
            const [name, max, reset] = m ? [m[1]!.trim(), Number(m[2]), m[3]?.toLowerCase()] : [newResource.trim(), 1, undefined]
            if (!name) return
            set({ resources: [...resources, { name, max: Math.max(1, max), used: 0, reset: reset === 'short' ? 'short' : 'long' }] })
            setNewResource('')
          }}
        >
          <Input value={newResource} onChange={(e) => setNewResource(e.target.value)} placeholder={is35 ? 'e.g. Turn Undead 5' : 'e.g. Rage 3 long, Ki 4 short'} className="h-7 text-xs" aria-label="New feature" />
          <Button type="submit" size="icon-sm" variant="outline" aria-label="Add feature" disabled={!newResource.trim()}>
            <Plus />
          </Button>
        </form>
      </Section>

      {/* Inventory */}
      <Section title="Inventory" icon={ScrollText}>
        <div className="mb-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground">
          <Coins className="size-3.5 text-gold" />
          {(['pp', 'gp', 'ep', 'sp', 'cp'] as const).map((k) => (
            <span key={k}>
              <EditableNumber
                value={k === 'gp' ? sheet.gold : (sheet.coins?.[k] ?? 0)}
                label={COIN_NAMES[k]}
                min={0}
                onCommit={(v) => set(k === 'gp' ? { gold: v } : { coins: { ...(sheet.coins ?? {}), [k]: v || undefined } as CoinPurse })}
                className={cn('font-mono', k === 'gp' && 'text-gold')}
              />
              {k}
            </span>
          ))}
        </div>
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
      <Section title={terms.spells} icon={Sparkles}>
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
              {!is35 && (
                <Tip label={sheet.concentration === sp.name ? 'Stop concentrating' : `Concentrate on ${sp.name}`}>
                  <button
                    type="button"
                    aria-label={sheet.concentration === sp.name ? `Stop concentrating on ${sp.name}` : `Concentrate on ${sp.name}`}
                    aria-pressed={sheet.concentration === sp.name}
                    onClick={() => {
                      const on = sheet.concentration !== sp.name
                      set({ concentration: on ? sp.name : undefined })
                      system(on ? `${note.card.name} concentrates on ${sp.name}.` : `${note.card.name} stops concentrating on ${sp.name}.`)
                    }}
                    className={cn(sheet.concentration === sp.name ? 'text-gold' : 'text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground')}
                  >
                    <Brain className="size-3" />
                  </button>
                </Tip>
              )}
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
            className={cn('flex-1', is35 && 'hidden')}
            onClick={() => {
              const r = shortRest(sheet, sheet.hp < sheet.max_hp ? 1 : 0)
              set(r.sheet)
              system(r.rolls.length ? `${note.card.name} takes a short rest and spends a hit die, regaining ${r.healed} HP.` : `${note.card.name} takes a short rest.`)
            }}
            disabled={!shortRestable}
          >
            <Coffee /> Short rest
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => {
              set(longRest(sheet))
              void useChat.getState().post({ role: 'system', text: is35 ? `${note.card.name} rests for the night (+${Math.max(1, sheet.level)} HP, spells restored).` : `${note.card.name} takes a long rest.`, swipes: [], swipeIndex: 0 })
            }}
          >
            <BedDouble /> {is35 ? 'Rest for the night' : 'Long rest'}
          </Button>
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {is35
            ? `A night’s rest heals ${Math.max(1, sheet.level)} HP (1 per level) and restores spells.`
            : `Hit dice: ${(sheet.hit_dice?.max ?? sheet.level) - (sheet.hit_dice?.used ?? 0)}/${sheet.hit_dice?.max ?? sheet.level} d${hitDie(sheet)}`}
        </p>
      </Section>
    </div>
  )
}
