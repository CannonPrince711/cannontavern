/** Slash commands for dice, checks, combat and rests. Imported for its side effects. */
import { longRest, shortRest } from '@shared/sheet'
import { registerCommand } from './commands'
import { addPartyToCombat, combatActions, hurt } from './combat'
import { parseAndRollCheck, rollExpression } from './rolls'
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
    if (kind === 'long') {
      await updateActiveSheet(longRest(sheet))
      await useChat.getState().post({ role: 'system', text: `${active.note.card.name} takes a long rest: HP, spell slots and hit dice recovered.`, swipes: [], swipeIndex: 0 })
    } else {
      const r = shortRest(sheet, Number(n ?? 1) || 1)
      await updateActiveSheet(r.sheet)
      await useChat.getState().post({
        role: 'system',
        text: `${active.note.card.name} takes a short rest and spends ${r.rolls.length} hit ${r.rolls.length === 1 ? 'die' : 'dice'} (${r.rolls.join(' + ') || 0}), regaining ${r.healed} HP.`,
        swipes: [],
        swipeIndex: 0
      })
    }
  }
})
