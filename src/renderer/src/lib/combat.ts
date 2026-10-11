import { addCombatants, applyHp, emptyCombat, findCombatant, nextTurn, parseAddArgs, prevTurn, rollInitiative } from '@shared/combat'
import { modifier } from '@shared/prompt'
import { damage, heal } from '@shared/sheet'
import type { CombatState } from '@shared/types'
import { loadActiveSheet, updateActiveSheet } from '@/hooks/useActiveCharacter'
import { useChat } from '@/stores/chat'
import { invoke } from './ipc'

export function currentCombat(): CombatState {
  return useChat.getState().session?.frontmatter.combat ?? emptyCombat()
}

/** Applies `fn` to the session's combat state and saves it to the note's frontmatter. */
export async function updateCombat(fn: (c: CombatState) => CombatState | null): Promise<CombatState | null> {
  const session = useChat.getState().session
  if (!session) throw new Error('Open a session first.')
  const next = fn(session.frontmatter.combat ?? emptyCombat())
  // Optimistic: reflect immediately, then persist.
  useChat.setState({ session: { ...session, frontmatter: { ...session.frontmatter, combat: next ?? undefined } } })
  const saved = await invoke('sessions:saveCombat', session.path, next)
  useChat.setState({ session: saved })
  return next
}

/** Adds the session's character as a player combatant (HP from the sheet). */
export async function addPartyToCombat(): Promise<void> {
  const active = await loadActiveSheet()
  if (!active?.note.card.dnd) throw new Error('This session’s character has no D&D sheet yet.')
  const sheet = active.note.card.dnd
  await updateCombat((c) =>
    c.combatants.some((x) => x.character === active.path)
      ? c
      : addCombatants(c, [{ name: active.note.card.name, count: 1, hp: sheet.hp, ac: sheet.ac, initMod: modifier(sheet.dex) }], {
          is_player: true,
          character: active.path,
          max_hp: sheet.max_hp
        })
  )
}

/** Damage (positive) or healing (negative); a player combatant's sheet is updated too. */
export async function hurt(name: string, amount: number): Promise<void> {
  const c = currentCombat()
  const target = findCombatant(c, name)
  if (target) {
    await updateCombat((s) => applyHp(s, target.id, amount))
    if (target.is_player && target.character) {
      const active = await loadActiveSheet()
      if (active?.path === target.character && active.note.card.dnd) {
        const sheet = amount > 0 ? damage(active.note.card.dnd, amount) : heal(active.note.card.dnd, -amount)
        await updateActiveSheet({ hp: sheet.hp, temp_hp: sheet.temp_hp })
      }
    }
    return
  }
  // Not in combat: apply to the active character's sheet by name.
  const active = await loadActiveSheet()
  if (active?.note.card.dnd && active.note.card.name.toLowerCase().startsWith(name.trim().toLowerCase())) {
    const sheet = amount > 0 ? damage(active.note.card.dnd, amount) : heal(active.note.card.dnd, -amount)
    await updateActiveSheet({ hp: sheet.hp, temp_hp: sheet.temp_hp })
    return
  }
  throw new Error(`No combatant or character called “${name}”.`)
}

export const combatActions = {
  add: (args: string) => updateCombat((c) => addCombatants(c, parseAddArgs(args))),
  initiative: () => updateCombat((c) => rollInitiative(c)),
  next: () => updateCombat((c) => nextTurn(c)),
  prev: () => updateCombat((c) => prevTurn(c)),
  end: () => updateCombat(() => null)
}
