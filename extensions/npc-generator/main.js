// NPC Generator — /npc [role]
// Writes a note to NPCs/ with ctx.writeNote() (needs "vault:write"), and, if
// "generate:text" was granted, asks the model for a richer description.

const FIRST = ['Mira', 'Tobin', 'Alder', 'Sera', 'Bram', 'Wynn', 'Isolde', 'Corvin', 'Elsbeth', 'Garrick', 'Nessa', 'Orrin', 'Pell', 'Rhosyn', 'Talia', 'Ulric']
const LAST = ['Ashdown', 'Brightwater', 'Coldbrook', 'Duskmantle', 'Emberfall', 'Fenwick', 'Greyhollow', 'Hartley', 'Ironwood', 'Marsh', 'Saltmere', 'Thornby']
const ANCESTRY = ['human', 'human', 'dwarf', 'elf', 'halfling', 'half-orc', 'gnome', 'tiefling', 'dragonborn']
const ROLES = ['innkeeper', 'blacksmith', 'priest', 'fisher', 'guard captain', 'merchant', 'smuggler', 'scholar', 'herbalist', 'bard']
const TRAITS = ['speaks in whispers', 'laughs too loudly', 'never makes eye contact', 'collects odd trinkets', 'quotes old proverbs', 'is fiercely loyal', 'distrusts magic', 'hums sea shanties']
const LOOKS = ['a scar across one cheek', 'ink-stained fingers', 'a patched green cloak', 'silver rings on every finger', 'a missing tooth', 'braided grey hair', 'sun-browned skin']
const WANTS = ['to pay off an old debt', 'to find a missing sibling', 'to leave town for good', 'revenge on a rival', 'to protect a secret', 'recognition from the guild']
const SECRETS = ['once served a cult', 'is hiding a fugitive', 'knows where the bell sank', 'is not who they claim to be', 'owes money to smugglers', 'can hear the dead']

function pick(list, ctx) {
  return list[ctx.roll(`1d${list.length}`).total - 1]
}

module.exports = {
  commands: {
    async npc(args, ctx) {
      const name = `${pick(FIRST, ctx)} ${pick(LAST, ctx)}`
      const words = args.trim().toLowerCase()
      const ancestry = ANCESTRY.find((a) => words.includes(a)) || pick(ANCESTRY, ctx)
      const role = words.replace(ancestry, '').trim() || pick(ROLES, ctx)
      const trait = pick(TRAITS, ctx)
      const look = pick(LOOKS, ctx)
      const want = pick(WANTS, ctx)
      const secret = pick(SECRETS, ctx)

      let description = `${name} is a ${ancestry} ${role} with ${look}, who ${trait}.`
      if (ctx.settings.useAi) {
        try {
          const setting = ctx.campaign ? ` in the campaign “${ctx.campaign.name}”${ctx.campaign.setting ? ` (${ctx.campaign.setting})` : ''}` : ''
          description = (await ctx.generateText(`Write two vivid sentences describing ${name}, a ${ancestry} ${role}${setting}. They have ${look} and ${trait}. Plain prose, no lists.`, { maxTokens: 160 })).trim() || description
        } catch (err) {
          // No "generate:text" permission or no backend: keep the template text.
        }
      }

      const note = [
        '---',
        'type: npc',
        `name: ${JSON.stringify(name)}`,
        `description: ${JSON.stringify(description)}`,
        `personality: ${JSON.stringify(trait)}`,
        `tags: [npc, ${JSON.stringify(ancestry)}, ${JSON.stringify(role)}]`,
        '---',
        '',
        `# ${name}`,
        '',
        description,
        '',
        `- **Wants:** ${want}`,
        `- **Secret:** ${secret}`,
        ctx.session ? `- **First met:** [[${ctx.session.path.replace(/\.md$/, '')}|${ctx.session.title}]]` : '',
        ''
      ].join('\n')
      await ctx.writeNote(`NPCs/${name}.md`, note)
      await ctx.post('system', `New NPC: [[${name}]], a ${ancestry} ${role}. ${description}`)
    }
  }
}
