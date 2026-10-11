export default {
  panel(root, tavern) {
    const render = (state) => {
      const campaign = state && state.campaign
      const pins = (state && state.store && campaign && state.store[`pins:${campaign.path}`]) || []
      root.innerHTML = ''
      const card = document.createElement('div')
      card.className = 'card'
      const h = document.createElement('h3')
      h.textContent = campaign ? `${campaign.name} map` : 'Map pins'
      card.appendChild(h)
      if (!pins.length) {
        const p = document.createElement('p')
        p.className = 'muted'
        p.textContent = 'No pins yet. Type /pin <location> in the chat.'
        card.appendChild(p)
      }
      for (const pin of pins) {
        const row = document.createElement('div')
        row.style.margin = '4px 0'
        const b = document.createElement('strong')
        b.textContent = pin.location
        row.appendChild(b)
        if (pin.note) {
          const n = document.createElement('div')
          n.className = 'muted'
          n.textContent = pin.note
          row.appendChild(n)
        }
        card.appendChild(row)
      }
      root.appendChild(card)
    }
    tavern.onState(render)
  },

  // Message decorations are shown as plain text under DM messages.
  onMessageRender(el, msg) {
    const state = window.tavern.getState()
    const campaign = state && state.campaign
    const pins = (state && state.store && campaign && state.store[`pins:${campaign.path}`]) || []
    const hits = pins.filter((p) => msg.text.toLowerCase().includes(p.location.toLowerCase()))
    if (hits.length) el.textContent = `📍 ${hits.map((p) => p.location).join(', ')}`
  }
}
