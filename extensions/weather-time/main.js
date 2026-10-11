// Weather & Time — an in-world clock added to every prompt.
//
// main.js runs in a sandbox: there is no require(), no Node APIs and no
// network. Everything goes through `ctx` (see the README's extension guide).
// `module.exports` lists commands (/name args) and hooks.

const WEATHER = {
  temperate: ['clear skies', 'light rain', 'overcast and grey', 'thick fog', 'a brisk wind', 'a heavy downpour', 'warm sunshine'],
  coastal: ['sea fog rolling in', 'salt spray and gusts', 'drizzle off the water', 'a calm, glassy sea', 'a squall on the horizon'],
  arctic: ['biting cold', 'a howling blizzard', 'pale, clear sky', 'drifting snow', 'ice fog'],
  desert: ['blistering heat', 'a dust storm', 'still, dry air', 'a cold, clear night sky', 'heat shimmer'],
  tropical: ['humid haze', 'a sudden downpour', 'thunder in the distance', 'steaming heat', 'a gentle sea breeze']
}

function partOfDay(minutes) {
  const h = Math.floor(minutes / 60)
  if (h < 5) return 'deep night'
  if (h < 8) return 'dawn'
  if (h < 12) return 'morning'
  if (h < 14) return 'midday'
  if (h < 18) return 'afternoon'
  if (h < 21) return 'evening'
  return 'night'
}

function load(ctx) {
  return ctx.store.get('clock') || { day: 1, minutes: 8 * 60, weather: 'clear skies' }
}

function describe(clock) {
  const h = String(Math.floor(clock.minutes / 60)).padStart(2, '0')
  const m = String(clock.minutes % 60).padStart(2, '0')
  return `Day ${clock.day}, ${h}:${m} (${partOfDay(clock.minutes)}). Weather: ${clock.weather}.`
}

function rollWeather(ctx) {
  const list = WEATHER[ctx.settings.climate] || WEATHER.temperate
  return list[ctx.roll(`1d${list.length}`).total - 1]
}

module.exports = {
  commands: {
    async time(args, ctx) {
      const clock = load(ctx)
      const adv = /^advance\s+(\d+)\s*(m|min|h|hr|d|day)s?$/i.exec(args.trim())
      const set = /^set\s+(\d+)\s+(\d{1,2}):(\d{2})$/i.exec(args.trim())
      if (adv) {
        const n = Number(adv[1])
        const unit = adv[2].toLowerCase()
        const minutes = unit.startsWith('d') ? n * 1440 : unit.startsWith('h') ? n * 60 : n
        const total = clock.minutes + minutes
        clock.day += Math.floor(total / 1440)
        clock.minutes = total % 1440
        // Weather has a chance to change every few hours.
        if (minutes >= 180 && ctx.roll('1d6').total >= 4) clock.weather = rollWeather(ctx)
      } else if (set) {
        clock.day = Number(set[1])
        clock.minutes = Number(set[2]) * 60 + Number(set[3])
      } else if (args.trim()) {
        throw new Error('Usage: /time, /time advance 2h, /time set 3 08:00')
      }
      ctx.store.set('clock', clock)
      if (args.trim() && ctx.settings.announce) await ctx.post('system', `Time passes. ${describe(clock)}`)
      else ctx.notify(describe(clock))
    },

    async weather(args, ctx) {
      const clock = load(ctx)
      clock.weather = rollWeather(ctx)
      ctx.store.set('clock', clock)
      await ctx.post('system', `The weather turns: ${clock.weather}.`)
    }
  },

  hooks: {
    // Add a small block to the prompt so the DM keeps time and weather consistent.
    onPromptBuild(blocks, ctx) {
      return [...blocks.filter((b) => b.id !== 'history'), { id: 'ext:weather-time', label: 'Weather & time', role: 'system', content: `In-world time and weather: ${describe(load(ctx))}` }, ...blocks.filter((b) => b.id === 'history')]
    }
  }
}
