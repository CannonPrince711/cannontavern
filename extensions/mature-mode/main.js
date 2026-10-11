// Mature Mode (18+): opt-in adult content plus its own stat blocks.
//
// Nothing happens until the user confirms they are 18 or older (/mature
// confirm, or the button in the panel) and mode is on. Then:
// - a prompt block tells the model mature content between consenting adult
//   characters is allowed (never minors), at the chosen level, with limits;
// - per-character stats (e.g. Arousal, Affection, Stamina) are kept per
//   campaign, shown to the model, and updated from a hidden
//   <stats>{"Name": {"Stat": 10}}</stats> line the model may add, which is
//   stripped from the reply before it is saved.

const STATS_RE = /<stats>([\s\S]*?)<\/stats>/gi

function statNames(ctx) {
  const names = String(ctx.settings.stats || 'Arousal, Affection, Stamina')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return names.length ? names.slice(0, 8) : ['Arousal', 'Affection', 'Stamina']
}

function maxOf(ctx) {
  const m = Number(ctx.settings.max)
  return Number.isFinite(m) && m > 0 ? m : 100
}

function key(ctx) {
  return `stats:${ctx.campaign ? ctx.campaign.path : 'none'}`
}

function clamp(v, max) {
  return Math.max(0, Math.min(max, Math.round(v)))
}

/** Stats start empty, except stamina-like ones, which start full. */
function fresh(ctx) {
  const max = maxOf(ctx)
  const out = {}
  for (const s of statNames(ctx)) out[s] = /stamina|energy|endurance|health/i.test(s) ? max : 0
  return out
}

function load(ctx) {
  const all = ctx.store.get(key(ctx)) || {}
  const lead = ctx.character && ctx.character.name
  if (lead && !all[lead]) all[lead] = fresh(ctx)
  // Keep every block in line with the configured stat list.
  for (const name of Object.keys(all)) {
    const base = fresh(ctx)
    for (const s of Object.keys(base)) if (typeof all[name][s] !== 'number') all[name][s] = base[s]
  }
  return all
}

function save(ctx, all) {
  ctx.store.set(key(ctx), all)
}

function log(ctx, entries) {
  if (!entries.length) return
  const prev = ctx.store.get('log') || []
  ctx.store.set('log', [...entries, ...prev].slice(0, 20))
}

function active(ctx) {
  return ctx.store.get('confirmed') === true && ctx.store.get('on') !== false
}

function findName(all, wanted) {
  const w = wanted.trim().toLowerCase()
  return Object.keys(all).find((n) => n.toLowerCase() === w) || Object.keys(all).find((n) => n.toLowerCase().split(/\s+/)[0] === w)
}

function findStat(ctx, wanted) {
  const w = String(wanted).trim().toLowerCase()
  return statNames(ctx).find((s) => s.toLowerCase() === w)
}

/** Applies {"Name": {"Stat": delta}} changes; returns log entries. */
function apply(ctx, all, changes) {
  const max = maxOf(ctx)
  const entries = []
  for (const [rawName, stats] of Object.entries(changes || {})) {
    if (!stats || typeof stats !== 'object') continue
    const name = findName(all, rawName) || String(rawName).trim().slice(0, 60)
    if (!name) continue
    // Only tracked stats with real numbers count; anything else is ignored.
    const valid = Object.entries(stats)
      .map(([rawStat, delta]) => [findStat(ctx, rawStat), Number(delta)])
      .filter(([stat, d]) => stat && Number.isFinite(d) && d !== 0)
    if (!valid.length) continue
    if (!all[name]) all[name] = fresh(ctx)
    for (const [stat, d] of valid) {
      const before = all[name][stat]
      all[name][stat] = clamp(before + d, max)
      if (all[name][stat] !== before) entries.push({ name, stat, delta: all[name][stat] - before, value: all[name][stat] })
    }
  }
  return entries
}

function describe(ctx, all) {
  const max = maxOf(ctx)
  return Object.entries(all)
    .map(([name, stats]) => `- ${name}: ${statNames(ctx).map((s) => `${s} ${stats[s]}/${max}`).join(', ')}`)
    .join('\n')
}

function guidance(ctx) {
  const lines = [
    'Mature content is enabled for this story. Every character in any sexual content is an adult (18 or older) and consenting. Never sexualise minors or characters who seem young, and never portray sexual violence approvingly.'
  ]
  lines.push(
    ctx.settings.intensity === 'suggestive'
      ? 'Romance, flirtation and sensuality are welcome, but fade to black before explicit sexual detail.'
      : 'Romance and explicit sexual content may be depicted when the story and the characters lead there. Keep it in character, consensual and well written.'
  )
  const limits = String(ctx.settings.limits || '').trim()
  if (limits) lines.push(`Hard limits (never include): ${limits}.`)
  return lines.join(' ')
}

module.exports = {
  commands: {
    async mature(args, ctx) {
      const a = args.trim().toLowerCase()
      if (a === 'confirm') {
        ctx.store.set('confirmed', true)
        ctx.store.set('on', true)
        return ctx.notify('Mature mode is on.')
      }
      if (a === 'on' || a === 'off') {
        if (a === 'on' && ctx.store.get('confirmed') !== true) throw new Error('Confirm you are 18 or older first: /mature confirm')
        ctx.store.set('on', a === 'on')
        return ctx.notify(a === 'on' ? 'Mature mode is on.' : 'Mature mode is off.')
      }
      throw new Error('Usage: /mature confirm | on | off')
    },

    async stats(args, ctx) {
      if (ctx.store.get('confirmed') !== true) throw new Error('Confirm you are 18 or older first: /mature confirm')
      const all = load(ctx)
      save(ctx, all)
      await ctx.post('system', `**Stats**\n${describe(ctx, all) || 'No one is tracked yet.'}`)
    },

    // /stat Kestrel Vane Arousal +5   ·   /stat Kestrel Affection =50
    async stat(args, ctx) {
      if (ctx.store.get('confirmed') !== true) throw new Error('Confirm you are 18 or older first: /mature confirm')
      const m = /^(.+?)\s+(\S+)\s+([+\-=]?)(\d+)$/.exec(args.trim().replace(/^"(.+)"/, '$1'))
      if (!m) throw new Error('Usage: /stat <character> <stat> <+n | -n | =n>')
      const all = load(ctx)
      const stat = findStat(ctx, m[2])
      if (!stat) throw new Error(`Unknown stat “${m[2]}”. Tracked: ${statNames(ctx).join(', ')}`)
      const name = findName(all, m[1].replace(/^"|"$/g, '')) || m[1].replace(/^"|"$/g, '').trim()
      if (!all[name]) all[name] = fresh(ctx)
      const n = Number(m[4])
      const target = m[3] === '=' ? n : all[name][stat] + (m[3] === '-' ? -n : n)
      const entries = apply(ctx, all, { [name]: { [stat]: target - all[name][stat] } })
      save(ctx, all)
      log(ctx, entries)
      ctx.notify(`${name}: ${stat} ${all[name][stat]}/${maxOf(ctx)}`)
    }
  },

  hooks: {
    onPromptBuild(blocks, ctx) {
      if (!active(ctx)) return blocks
      let content = guidance(ctx)
      if (ctx.settings.aiStats !== false) {
        const all = load(ctx)
        save(ctx, all)
        content +=
          `\n\nStat blocks (0 to ${maxOf(ctx)}):\n${describe(ctx, all)}` +
          `\nWhen these change during a scene, end your reply with one hidden line in exactly this form: <stats>{"Name": {"${statNames(ctx)[0]}": 10}}</stats> (numbers are changes, e.g. 10 or -5; use the names above). Leave it out when nothing changed.`
      }
      const block = { id: 'ext:mature-mode', label: 'Mature mode', role: 'system', content }
      return [...blocks.filter((b) => b.id !== 'history'), block, ...blocks.filter((b) => b.id === 'history')]
    },

    // Strip the hidden stats line (always) and apply it (when mode is on).
    onResponse(text, ctx) {
      if (!STATS_RE.test(text)) return text
      STATS_RE.lastIndex = 0
      const all = active(ctx) ? load(ctx) : null
      const entries = []
      const clean = text.replace(STATS_RE, (_, json) => {
        if (all) {
          try {
            entries.push(...apply(ctx, all, JSON.parse(json)))
          } catch {
            // Malformed line: drop it silently.
          }
        }
        return ''
      })
      if (all) {
        save(ctx, all)
        log(ctx, entries)
      }
      return clean.replace(/\n{3,}/g, '\n\n').trim()
    }
  }
}
