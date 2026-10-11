import { parseCheckArgs, resolveTarget, rollCheck } from '@shared/checks'
import { formatRoll, roll } from '@shared/dice'
import type { RollMode, RollResult } from '@shared/types'
import { loadActiveSheet } from '@/hooks/useActiveCharacter'
import { useChat } from '@/stores/chat'
import { useDiceFx } from '@/stores/dice'
import { useApp } from '@/stores/app'

/** Posts a roll as a [!roll] callout (after the dice animation). */
export async function postRoll(result: RollResult, who?: string): Promise<void> {
  await useDiceFx.getState().play(result)
  const name = [who, result.label].filter(Boolean).join(' · ') || undefined
  await useChat.getState().post({ role: 'roll', name, text: formatRoll(result), roll: result, swipes: [], swipeIndex: 0 })
}

async function speaker(): Promise<{ name: string; sheet: Awaited<ReturnType<typeof loadActiveSheet>> }> {
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
export async function rollCheckFor(targetRaw: string, dc: number | undefined, opts: { save?: boolean; mode?: RollMode; continueAfter?: boolean } = {}): Promise<void> {
  const target = resolveTarget(targetRaw, opts.save) ?? (opts.save ? null : resolveTarget(targetRaw, true))
  if (!target) throw new Error(`“${targetRaw}” isn’t an ability${opts.save ? '' : ' or skill'}. Try dex, wisdom, stealth, perception…`)
  const { name, sheet } = await speaker()
  const r = rollCheck(sheet?.note.card.dnd ?? null, target, dc, opts.mode ?? 'normal')
  await postRoll(r, name)
  if (opts.continueAfter) await useChat.getState().send('')
}

export function parseAndRollCheck(args: string, save: boolean): Promise<void> {
  const { target, dc, mode } = parseCheckArgs(args)
  if (!target) throw new Error(save ? 'Usage: /save wis 13' : 'Usage: /check dex 15')
  return rollCheckFor(target, dc, { save, mode })
}
