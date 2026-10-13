/** Slash commands for dice, checks, combat, rests and sheet tracking. Imported for its side effects. */
import { conditionNote } from '@shared/checks'
import { editionOf } from '@shared/editions'
import { deathSave, longRest, shortRest, spendResource } from '@shared/sheet'
import type { DndSheet } from '@shared/types'
import { registerCommand } from './commands'
import { addPartyToCombat, combatActions, hurt } from './combat'
import { parseAndRollCheck, postRoll, rollExpression } from './rolls'
import { loadActiveSheet, updateActiveSheet } from '@/hooks/useActiveCharacter'
import { useChat } from '@/stores/chat'
import { toast } from '@/stores/toasts'

registerCommand({
  name: 'roll',
  usage: '/roll 2d6+3',
  description: 'Roll dice: 1d20 adv, 4d6kh3, 2d8+1d6+4 Fire damage',
  run: ({ args }) => rollExpression(args || '1d20')
})

registerCommand({
  name: 'check',
  usage: '/check dex 15',
  description: 'Ability or skill check with your modifiers (add adv/dis)',
  run: ({ args }) => parseAndRollCheck(args, false)
})

registerCommand({
  name: 'save',
  usage: '/save wis 13',
  description: 'Saving throw with your modifiers and proficiency',
  run: ({ args }) => parseAndRollCheck(args, true)
})

registerCommand({
  name: 'add',
  usage: '/add Goblin hp 7 ac 15 init +2',
  description: 'Add combatants (3 Goblins hp 2d6 … adds three)',
  run: async ({ args }) => {
    await combatActions.add(args)
  }
})

registerCommand({
  name: 'party',
  usage: '/party',
  description: 'Add your character to the combat tracker',
  run: () => addPartyToCombat()
})

registerCommand({
  name: 'init',
  usage: '/init',
  description: 'Roll initiative for everyone and start combat',
  run: async () => {
    const c = await combatActions.initiative()
    if (c?.combatants.length) {
      const order = c.combatants.map((x) => `${x.name} ${x.initiative}`).join(', ')
      await useChat.getState().post({ role: 'system', text: `Combat begins! Initiative: ${order}.`, swipes: [], swipeIndex: 0 })
    }
  }
})

registerCommand({
  name: 'next',
  usage: '/next',
  description: 'Next turn in combat',
  run: async () => {
    const c = await combatActions.next()
    const who = c?.combatants[c.turn]
    if (who) toast.info(`Round ${c!.round}: ${who.name}’s turn`)
  }
})

registerCommand({ name: 'prev', usage: '/prev', description: 'Previous turn in combat', run: async () => void (await combatActions.prev()) })

registerCommand({
  name: 'endcombat',
  usage: '/endcombat',
  description: 'End combat and clear the tracker',
  run: async () => {
    await combatActions.end()
    await useChat.getState().post({ role: 'system', text: 'Combat ends.', swipes: [], swipeIndex: 0 })
  }
})

function nameAndAmount(args: string, usage: string): { name: string; amount: number } {
  const m = /^(.*?)\s+(\d+)$/.exec(args.trim())
  if (!m) throw new Error(`Usage: ${usage}`)
  return { name: m[1]!, amount: Number(m[2]) }
}

registerCommand({
  name: 'dmg',
  usage: '/dmg Goblin 5',
  description: 'Damage a combatant or your character',
  run: ({ args }) => {
    const { name, amount } = nameAndAmount(args, '/dmg Goblin 5')
    return hurt(name, amount)
  }
})

registerCommand({
  name: 'heal',
  usage: '/heal Aria 4',
  description: 'Heal a combatant or your character',
  run: ({ args }) => {
    const { name, amount } = nameAndAmount(args, '/heal Aria 4')
    return hurt(name, -amount)
  }
})

registerCommand({
  name: 'rest',
  usage: '/rest short 2 | /rest long',
  description: 'Short rest (spend hit dice) or long rest',
  run: async ({ args }) => {
    const active = await loadActiveSheet()
    const sheet = active?.note.card.dnd
    if (!active || !sheet) throw new Error('Your character has no D&D sheet.')
    const [kind, n] = args.trim().split(/\s+/)
    if (sheet.edition === '3.5e') {
      if (kind !== 'long') throw new Error('D&D 3.5 has no short rests. Use /rest long for a night’s rest.')
      await updateActiveSheet(longRest(sheet))
      await useChat.getState().post({ role: 'system', text: `${active.note.card.name} rests for the night: +${Math.max(1, sheet.level)} HP, spells restored.`, swipes: [], swipeIndex: 0 })
    } else if (kind === 'long') {
      await updateActiveSheet(longRest(sheet))
      await useChat.getState().post({ role: 'system', text: `${active.note.card.name} takes a long rest: HP, spell slots, hit dice and features recovered.`, swipes: [], swipeIndex: 0 })
    } else {
      // At full HP a short rest only recharges features; don't spend hit dice.
      const r = shortRest(sheet, sheet.hp >= sheet.max_hp ? 0 : Number(n ?? 1) || 1)
      await updateActiveSheet(r.sheet)
      await useChat.getState().post({
        role: 'system',
        text: r.rolls.length
          ? `${active.note.card.name} takes a short rest and spends ${r.rolls.length} hit ${r.rolls.length === 1 ? 'die' : 'dice'} (${r.rolls.join(' + ')}), regaining ${r.healed} HP.`
          : `${active.note.card.name} takes a short rest.`,
        swipes: [],
        swipeIndex: 0
      })
    }
  }
})

const system = (text: string): Promise<void> => useChat.getState().post({ role: 'system', text, swipes: [], swipeIndex: 0 })

async function requireSheet(): Promise<{ name: string; sheet: DndSheet }> {
  const active = await loadActiveSheet()
  const sheet = active?.note.card.dnd
  if (!active || !sheet) throw new Error('Your character has no D&D sheet.')
  return { name: active.note.card.name, sheet }
}

registerCommand({
  name: 'deathsave',
  usage: '/deathsave',
  description: 'Roll a death saving throw at 0 HP',
  run: async () => {
    const { name, sheet } = await requireSheet()
    if (editionOf(sheet) !== '5e') throw new Error('Death saves are a 5e rule. In 3.5, a dying character loses 1 HP a round unless stabilized.')
    if (sheet.hp > 0) throw new Error(`${name} isn’t at 0 HP.`)
    const ds = sheet.death_saves ?? { successes: 0, failures: 0 }
    if (ds.failures >= 3) throw new Error(`${name} has died.`)
    if (ds.successes >= 3) throw new Error(`${name} is already stable.`)
    const r = deathSave(sheet)
    await updateActiveSheet({ hp: r.sheet.hp, death_saves: r.sheet.death_saves })
    await postRoll(r.roll, name)
    if (r.outcome === 'revived') await system(`${name} rolls a natural 20 and regains 1 HP!`)
    else if (r.outcome === 'stable') await system(`${name} is stable.`)
    else if (r.outcome === 'dead') await system(`${name} has died.`)
  }
})

registerCommand({
  name: 'inspire',
  usage: '/inspire [use]',
  description: 'Gain inspiration, or spend it with /inspire use',
  run: async ({ args }) => {
    const { name, sheet } = await requireSheet()
    const spend = /^(use|spend|off)$/i.test(args.trim()) || (!args.trim() && !!sheet.inspiration)
    if (spend && !sheet.inspiration) throw new Error(`${name} has no inspiration to spend.`)
    await updateActiveSheet({ inspiration: spend ? undefined : true })
    await system(spend ? `${name} spends inspiration.` : `${name} gains inspiration.`)
  }
})

registerCommand({
  name: 'conc',
  usage: '/conc Bless | /conc end',
  description: 'Start or end concentrating on a spell',
  run: async ({ args }) => {
    const { name, sheet } = await requireSheet()
    const spell = args.trim()
    if (!spell || /^(end|stop|none|off)$/i.test(spell)) {
      if (!sheet.concentration) throw new Error(`${name} isn’t concentrating on anything.`)
      await updateActiveSheet({ concentration: undefined })
      return system(`${name} stops concentrating on ${sheet.concentration}.`)
    }
    await updateActiveSheet({ concentration: spell })
    await system(sheet.concentration ? `${name} drops ${sheet.concentration} to concentrate on ${spell}.` : `${name} concentrates on ${spell}.`)
  }
})

registerCommand({
  name: 'use',
  usage: '/use Rage [n]',
  description: 'Spend uses of a limited feature (Rage, Ki, Channel Divinity…)',
  run: async ({ args }) => {
    const { name, sheet } = await requireSheet()
    const m = /^(.*?)(?:\s+(\d+))?$/.exec(args.trim())
    const feature = m?.[1]?.trim()
    if (!feature) {
      const list = (sheet.resources ?? []).map((r) => `${r.name} ${r.max - r.used}/${r.max}`)
      return toast.info(list.length ? list.join(' · ') : 'No limited features on this sheet. Add them in the sheet’s Features section.')
    }
    const n = Number(m?.[2] ?? 1)
    const r = spendResource(sheet, feature, n)
    if (!r) throw new Error(`No feature called “${feature}” on ${name}’s sheet.`)
    if (r.changed < n) throw new Error(`${name} has only ${r.resource.max - r.resource.used + r.changed} ${r.resource.name} left.`)
    await updateActiveSheet({ resources: r.sheet.resources })
    await system(`${name} uses ${r.resource.name}${n > 1 ? ` ×${n}` : ''} (${r.resource.max - r.resource.used}/${r.resource.max} left).`)
  }
})

registerCommand({
  name: 'cond',
  usage: '/cond poisoned',
  description: 'What a condition does (no name: your current conditions)',
  run: async ({ args }) => {
    const active = await loadActiveSheet()
    const sheet = active?.note.card.dnd
    const edition = editionOf(sheet)
    const names = args.trim() ? [args.trim()] : (sheet?.conditions ?? [])
    if (!names.length) return toast.info('No conditions.', 'Try /cond prone')
    for (const c of names) {
      const note = conditionNote(c, edition)
      if (!note && args.trim()) throw new Error(`No ${edition} condition called “${c}”.`)
      toast.info(c.replace(/^./, (x) => x.toUpperCase()), note ?? 'No reminder for this condition.')
    }
  }
})
