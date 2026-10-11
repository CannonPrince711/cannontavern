// Mature Mode panel: the 18+ confirmation, an on/off switch, and the stat
// blocks (bars with − / + buttons). Changes go through the extension's
// commands, so main.js stays the single source of truth.

const COLORS = [
  [/arous|lust|desire|heat/i, '#e0457b'],
  [/affection|love|trust|bond/i, '#f08fb1'],
  [/stamina|energy|endurance|health/i, '#34c38f'],
  [/corrupt|shame|dominan|submiss/i, '#a855f7']
]

function colorFor(stat) {
  const hit = COLORS.find(([re]) => re.test(stat))
  return hit ? hit[1] : '#d4a843'
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag)
  Object.assign(node, props)
  if (props.style) node.setAttribute('style', props.style)
  for (const c of children) node.append(c)
  return node
}

export default {
  panel(root, tavern) {
    const run = (cmd, args) => tavern.runCommand(cmd, args).catch((e) => tavern.notify(e.message))

    const render = (state) => {
      root.innerHTML = ''
      const store = (state && state.store) || {}
      const settings = (state && state.settings) || {}
      const confirmed = store.confirmed === true
      const on = store.on !== false
      const card = el('div', { className: 'card' })
      card.append(el('h3', { textContent: 'Mature mode (18+)' }))

      if (!confirmed) {
        card.append(
          el('p', { className: 'muted', textContent: 'Allows adult content between consenting adult characters and tracks stat blocks for them. Off until you confirm.' }),
          el('button', { textContent: 'I am 18 or older, turn it on', onclick: () => run('mature', 'confirm') })
        )
        root.append(card)
        return
      }

      const toggle = el('button', { className: on ? '' : 'secondary', textContent: on ? 'On · turn off' : 'Off · turn on', onclick: () => run('mature', on ? 'off' : 'on') })
      card.append(el('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:6px' }, toggle, el('span', { className: 'muted', textContent: settings.intensity === 'suggestive' ? 'Suggestive' : 'Explicit' })))
      root.append(card)

      const campaign = state && state.campaign ? state.campaign.path : 'none'
      const all = store[`stats:${campaign}`] || {}
      const names = Object.keys(all)
      const max = Number(settings.max) > 0 ? Number(settings.max) : 100
      if (!names.length) {
        root.append(el('p', { className: 'muted', textContent: 'Stats appear here once a session runs with mature mode on (or use /stat).' }))
      }
      for (const name of names) {
        const block = el('div', { className: 'card', style: 'margin-top:8px' })
        block.append(el('h3', { textContent: name }))
        for (const [stat, value] of Object.entries(all[name])) {
          const pct = Math.max(0, Math.min(100, (value / max) * 100))
          const bar = el(
            'div',
            { style: 'flex:1;height:8px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden' },
            el('div', { style: `height:100%;width:${pct}%;background:${colorFor(stat)};transition:width .3s` })
          )
          const quoted = `"${name}"`
          block.append(
            el(
              'div',
              { style: 'display:flex;align-items:center;gap:6px;margin:4px 0' },
              el('span', { textContent: stat, style: 'width:72px;font-size:12px' }),
              bar,
              el('span', { textContent: `${value}`, className: 'muted', style: 'width:28px;text-align:right;font-variant-numeric:tabular-nums' }),
              el('button', { className: 'secondary', textContent: '−', title: `${stat} −5`, onclick: () => run('stat', `${quoted} ${stat} -5`) }),
              el('button', { className: 'secondary', textContent: '+', title: `${stat} +5`, onclick: () => run('stat', `${quoted} ${stat} +5`) })
            )
          )
        }
        root.append(block)
      }

      const recent = (store.log || []).slice(0, 5)
      if (recent.length) {
        const list = el('div', { className: 'muted', style: 'margin-top:8px;font-size:12px' })
        for (const e of recent) list.append(el('div', { textContent: `${e.name}: ${e.stat} ${e.delta > 0 ? '+' : ''}${e.delta} → ${e.value}` }))
        root.append(list)
      }
    }
    tavern.onState(render)
  }
}
