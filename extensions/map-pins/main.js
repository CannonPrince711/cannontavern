// Map Pins — /pin <location> [— note], /pins
// Keeps the pins in ctx.store (so the panel can show them) and mirrors them to
// a "<Campaign> Map.md" note next to Campaign.md.

function key(ctx) {
  return `pins:${ctx.campaign ? ctx.campaign.path : 'none'}`
}

function mapNote(ctx, pins) {
  const name = ctx.campaign ? ctx.campaign.name : 'World'
  const lines = ['---', 'type: map', `campaign: "[[${name}]]"`, '---', '', `# ${name} Map`, '']
  if (ctx.settings.mapNote) lines.push(`![[${ctx.settings.mapNote}]]`, '')
  lines.push('## Pins', '')
  for (const p of pins) lines.push(`- [[${p.location}]]${p.note ? ` — ${p.note}` : ''}${p.session ? ` · first noted in [[${p.session}]]` : ''}`)
  return lines.join('\n') + '\n'
}

module.exports = {
  commands: {
    async pin(args, ctx) {
      if (!ctx.campaign) throw new Error('Open a session first.')
      const [location, ...rest] = args.split(/\s+[—-]{1,2}\s+/)
      if (!location || !location.trim()) throw new Error('Usage: /pin The Drowned Bell — under the harbour')
      const pins = ctx.store.get(key(ctx)) || []
      const existing = pins.find((p) => p.location.toLowerCase() === location.trim().toLowerCase())
      if (existing) existing.note = rest.join(' — ') || existing.note
      else pins.push({ location: location.trim(), note: rest.join(' — '), session: ctx.session ? ctx.session.title : '' })
      ctx.store.set(key(ctx), pins)
      await ctx.writeNote(`${ctx.campaign.path}/${ctx.campaign.name} Map.md`, mapNote(ctx, pins))
      ctx.notify(`Pinned ${location.trim()} on the map`)
    },

    async pins(args, ctx) {
      const pins = ctx.store.get(key(ctx)) || []
      if (!pins.length) return ctx.notify('No map pins yet. Try /pin <location>.')
      await ctx.post('system', `**Map pins**\n${pins.map((p) => `- [[${p.location}]]${p.note ? ` — ${p.note}` : ''}`).join('\n')}`)
    }
  }
}
