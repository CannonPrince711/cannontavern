import { parseCheckArgs, resolveTarget, rollCheck } from '@shared/checks'
import { formatRoll, roll } from '@shared/dice'
import { editionOf } from '@shared/editions'
import type { RollMode, RollResult } from '@shared/types'
import { loadActiveSheet } from '@/hooks/useActiveCharacter'
import { useChat } from '@/stores/chat'
import { useDiceFx } from '@/stores/dice'
import { useApp } from '@/stores/app'
import { invoke } from '@/lib/ipc'
import { useVault } from '@/stores/vault'

/** Posts a roll as a [!roll] callout (after the dice animation). */
export async function postRoll(result: RollResult, who?: string): Promise<void> {
  await useDiceFx.getState().play(result)
  const name = [who, result.label].filter(Boolean).join(' · ') || undefined
  await useChat.getState().post({ role: 'roll', name, text: formatRoll(result), roll: result, swipes: [], swipeIndex: 0 })
}

/** The roller: a character by name (a party member's own check), else the active character. */
async function speaker(who?: string): Promise<{ name: string; sheet: Awaited<ReturnType<typeof loadActiveSheet>> }> {
  if (who?.trim()) {
    const index = useVault.getState().index
    const want = who.trim().toLowerCase()
    const all = (index?.characters ?? []).concat(index?.npcs ?? [])
    const hit = all.find((c) => c.displayName.trim().toLowerCase() === want) ?? all.find((c) => c.displayName.trim().toLowerCase().split(/\s+/)[0] === want.split(/\s+/)[0])
    if (hit) {
      const note = await invoke('characters:get', hit.path)
      return { name: note.card.name, sheet: { path: hit.path, note } }
    }
    return { name: who.trim(), sheet: null }
  }
  const active = await loadActiveSheet()
  const s = useChat.getState().session
  const name = active?.note.card.name ?? s?.frontmatter.persona ?? useApp.getState().settings?.general.playerName ?? 'Player'
  return { name, sheet: active }
}

export async function rollExpression(expr: string): Promise<void> {
  const r = roll(expr)
  const { name } = await speaker()
  await postRoll(r, name)
}

/**
 * Rolls a check or save with the active character's modifiers. With
 * `continueAfter`, the DM narrates the outcome right away (used by the
 * "Roll it" buttons on [CHECK …] requests).
 */
export async function rollCheckFor(targetRaw: string, dc: number | undefined, opts: { save?: boolean; mode?: RollMode; continueAfter?: boolean; who?: string } = {}): Promise<void> {
  const { name, sheet } = await speaker(opts.who)
  const edition = editionOf(sheet?.note.card.dnd)
  const target = resolveTarget(targetRaw, opts.save, edition) ?? (opts.save ? null : resolveTarget(targetRaw, true, edition))
  if (!target) throw new Error(`“${targetRaw}” isn’t an ability${opts.save ? '' : ' or skill'}. Try ${edition === '3.5e' ? 'dex, spot, move silently, reflex' : 'dex, wisdom, stealth, perception'}…`)
  const r = rollCheck(sheet?.note.card.dnd ?? null, target, dc, opts.mode ?? 'normal')
  await postRoll(r, name)
  if (opts.continueAfter) await useChat.getState().send('')
}

export function parseAndRollCheck(args: string, save: boolean): Promise<void> {
  const { target, dc, mode } = parseCheckArgs(args)
  if (!target) throw new Error(save ? 'Usage: /save wis 13' : 'Usage: /check dex 15')
  return rollCheckFor(target, dc, { save, mode })
}
