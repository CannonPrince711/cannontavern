// Session Recap — /recap
// Reads the session from ctx.session, asks the model for a recap, then
// appends it under "## Session recaps" in the campaign note.

module.exports = {
  commands: {
    async recap(args, ctx) {
      if (!ctx.session || !ctx.campaign) throw new Error('Open a session first.')
      const transcript = ctx.session.messages
        .filter((m) => m.role === 'dm' || m.role === 'player' || m.role === 'roll')
        .map((m) => `${m.role === 'dm' ? 'DM' : m.name || 'Player'}: ${m.text}`)
        .join('\n\n')
        .slice(-24000)
      if (!transcript) throw new Error('Nothing has happened in this session yet.')

      const recap = (
        await ctx.generateText(
          `Write a recap of this Dungeons & Dragons session for the campaign journal: one paragraph of what happened, then a short bullet list of loose threads. Past tense, third person.\n\n${transcript}`,
          { system: 'You are the chronicler of a fantasy campaign.', maxTokens: 700 }
        )
      ).trim()

      const notePath = `${ctx.campaign.path}/Campaign.md`
      let note = ''
      try {
        note = await ctx.readNote(notePath)
      } catch (err) {
        note = `# ${ctx.campaign.name}\n`
      }
      const date = new Date().toISOString().slice(0, 10)
      const entry = `### ${ctx.session.title} (${date})\n\n${recap}\n\nSource: [[${ctx.session.path.replace(/\.md$/, '')}|${ctx.session.title}]]\n`
      const heading = '## Session recaps'
      note = note.includes(heading) ? note.replace(heading, `${heading}\n\n${entry}`) : `${note.replace(/\s*$/, '')}\n\n${heading}\n\n${entry}`
      await ctx.writeNote(notePath, note)
      await ctx.post('system', `Recap added to [[${ctx.campaign.name}]] → Session recaps.`)
    }
  }
}
