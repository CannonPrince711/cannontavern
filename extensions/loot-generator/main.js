// Loot Generator — /loot cr 3 [hoard]
// Uses ctx.roll() so every die is a real roll; posts the result as a note
// the DM can see.

const TIERS = [
  { max: 4, coins: { single: '5d6 cp, 4d6 sp', hoard: '6d6x100 cp, 3d6x100 sp, 2d6x10 gp' }, gems: '10 gp gems', items: ['Potion of Healing', 'Spell Scroll (cantrip)', 'Bag of Holding', 'Driftglobe', 'Potion of Climbing', 'Cloak of Protection'] },
  { max: 10, coins: { single: '4d6x10 sp, 2d6 gp', hoard: '2d6x100 sp, 6d6x10 gp, 3d6 pp' }, gems: '50 gp gems', items: ['Potion of Greater Healing', '+1 Weapon', 'Boots of Elvenkind', 'Wand of Magic Missiles', 'Ring of Protection', 'Spell Scroll (3rd level)'] },
  { max: 16, coins: { single: '4d6x10 gp, 1d6x10 pp', hoard: '4d6x1000 gp, 5d6x100 pp' }, gems: '500 gp gems', items: ['+2 Weapon', 'Potion of Superior Healing', 'Amulet of Health', 'Flame Tongue', 'Ring of Spell Storing', 'Cloak of Displacement'] },
  { max: 99, coins: { single: '8d6x100 gp, 3d6x10 pp', hoard: '12d6x1000 gp, 8d6x1000 pp' }, gems: '1,000 gp gems', items: ['+3 Weapon', 'Ring of Regeneration', 'Holy Avenger', 'Staff of Power', 'Potion of Supreme Healing', 'Robe of the Archmagi'] }
]

function rollCoins(spec, ctx) {
  // "6d6x100 cp" → roll and multiply.
  return spec.split(',').map((part) => {
    const m = /^\s*(\d+d\d+)(?:x([\d,]+))?\s+(\w+)\s*$/.exec(part)
    if (!m) return part.trim()
    const mult = Number((m[2] || '1').replace(/,/g, ''))
    return `${(ctx.roll(m[1]).total * mult).toLocaleString()} ${m[3]}`
  })
}

module.exports = {
  commands: {
    async loot(args, ctx) {
      const m = /cr\s*(\d+(?:\/\d)?)/i.exec(args)
      if (!m) throw new Error('Usage: /loot cr 3 [hoard]')
      const cr = m[1].includes('/') ? 0 : Number(m[1])
      const hoard = /hoard/i.test(args)
      const tier = TIERS.find((t) => cr <= t.max)
      const lines = [`**Treasure (CR ${m[1]}${hoard ? ', hoard' : ''})**`, `Coins: ${rollCoins(hoard ? tier.coins.hoard : tier.coins.single, ctx).join(', ')}`]
      if (hoard || ctx.roll('1d6').total === 6) lines.push(`Gems: ${ctx.roll(hoard ? '2d6' : '1d4').total} × ${tier.gems}`)
      const magicCount = hoard ? ctx.roll('1d4').total : ctx.roll('1d20').total >= 17 ? 1 : 0
      for (let i = 0; i < magicCount; i++) lines.push(`Magic item: ${tier.items[ctx.roll(`1d${tier.items.length}`).total - 1]}`)
      await ctx.post('system', lines.join('\n'))
    }
  }
}
