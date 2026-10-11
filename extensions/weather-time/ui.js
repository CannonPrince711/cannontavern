// UI panels run in a sandboxed frame. `tavern` offers: notify(text),
// runCommand(name, args), getState(), onState(fn). getState().store holds
// what main.js saved with ctx.store.set().

export default {
  panel(root, tavern) {
    root.innerHTML = `
      <div class="card">
        <h3>Weather &amp; Time</h3>
        <div id="clock" style="font-size:20px;font-family:Cinzel,Georgia,serif"></div>
        <div id="weather" class="muted"></div>
        <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
          <button data-adv="1h">+1 hour</button>
          <button data-adv="8h" class="secondary">+8 hours</button>
          <button data-adv="1d" class="secondary">+1 day</button>
          <button id="weatherBtn" class="secondary">New weather</button>
        </div>
      </div>`
    const render = (state) => {
      const clock = (state && state.store && state.store.clock) || { day: 1, minutes: 480, weather: 'clear skies' }
      const h = String(Math.floor(clock.minutes / 60)).padStart(2, '0')
      const m = String(clock.minutes % 60).padStart(2, '0')
      root.querySelector('#clock').textContent = `Day ${clock.day} · ${h}:${m}`
      root.querySelector('#weather').textContent = clock.weather
    }
    tavern.onState(render)
    root.querySelectorAll('[data-adv]').forEach((b) =>
      b.addEventListener('click', () => tavern.runCommand('time', `advance ${b.dataset.adv}`).catch((e) => tavern.notify(e.message)))
    )
    root.querySelector('#weatherBtn').addEventListener('click', () => tavern.runCommand('weather', ''))
  }
}
