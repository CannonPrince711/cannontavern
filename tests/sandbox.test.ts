import { describe, expect, it } from 'vitest'
import { ExtensionSandbox, type HostCall } from '../src/main/extensions/sandbox'

/** A host that answers a few methods and records what was asked. */
function makeHost(log: string[] = []): HostCall {
  return (method, argsJson, resolve, reject) => {
    const args = JSON.parse(argsJson) as unknown[]
    log.push(`${method}:${argsJson}`)
    if (resolve === null) {
      if (method === 'roll') return JSON.stringify({ total: 17, expression: args[0] })
      if (method === 'boom') return JSON.stringify({ __error: 'nope' })
      return undefined
    }
    if (method === 'readNote') setTimeout(() => resolve(JSON.stringify(`contents of ${args[0]}`)), 1)
    else if (method === 'post') setTimeout(() => resolve(undefined), 1)
    else setTimeout(() => reject!('not allowed'), 1)
    return undefined
  }
}

describe('extension sandbox', () => {
  it('loads commands and hooks and calls them with JSON-only values', async () => {
    const log: string[] = []
    const sb = new ExtensionSandbox(
      'demo',
      `module.exports = {
        commands: { hello: async (args, ctx) => { await ctx.post('system', 'Hi ' + args + ' from ' + ctx.extensionId); return ctx.roll('1d20').total } },
        hooks: { onResponse: (text) => text.toUpperCase() }
      }`,
      makeHost(log)
    )
    expect(sb.describe()).toEqual({ commands: ['hello'], hooks: ['onResponse'] })
    expect(await sb.call('commands.hello', ['there'], { extensionId: 'demo' })).toBe(17)
    expect(log).toContain('post:["system","Hi there from demo",null]')
    expect(await sb.call('hooks.onResponse', ['quiet'], {})).toBe('QUIET')
    expect(sb.has('hooks.onPromptBuild')).toBe(false)
  })

  it('has no require, process, Buffer or timers', async () => {
    const sb = new ExtensionSandbox(
      'probe',
      `module.exports = { commands: { probe: () => [typeof require, typeof process, typeof Buffer, typeof setTimeout, typeof fetch, typeof globalThis.process] } }`,
      makeHost()
    )
    expect(await sb.call('commands.probe', [], {})).toEqual(['undefined', 'undefined', 'undefined', 'undefined', 'undefined', 'undefined'])
  })

  it('blocks eval and new Function', async () => {
    const sb = new ExtensionSandbox(
      'gen',
      `module.exports = { commands: {
        ev: () => { try { return eval('1+1') } catch (e) { return 'blocked: ' + e.name } },
        fn: () => { try { return new Function('return 1')() } catch (e) { return 'blocked: ' + e.name } }
      } }`,
      makeHost()
    )
    expect(await sb.call('commands.ev', [], {})).toMatch(/^blocked/)
    expect(await sb.call('commands.fn', [], {})).toMatch(/^blocked/)
  })

  it('cannot reach the host through the ctx, its functions, or returned values', async () => {
    const sb = new ExtensionSandbox(
      'escape',
      `const tryEscape = (label, f) => { try { const r = f(); return label + ':' + (typeof r === 'object' && r && r.versions ? 'ESCAPED' : 'safe') } catch (e) { return label + ':blocked' } }
       module.exports = { commands: { escape: async (args, ctx) => {
         const results = []
         results.push(tryEscape('ctx', () => ctx.constructor.constructor('return process')()))
         results.push(tryEscape('post', () => ctx.post.constructor('return process')()))
         results.push(tryEscape('store', () => ctx.store.get.constructor('return process')()))
         const note = await ctx.readNote('x.md')
         results.push(tryEscape('result', () => note.constructor.constructor('return process')()))
         results.push(tryEscape('promise', () => ctx.readNote('y').constructor.constructor('return process')()))
         try { await ctx.generateText('x') } catch (err) { results.push(tryEscape('error', () => err.constructor.constructor('return process')())) }
         results.push(tryEscape('global', () => globalThis.constructor.constructor('return process')()))
         results.push(tryEscape('init', () => typeof __tavernInit))
         return results
       } } }`,
      makeHost()
    )
    const results = (await sb.call<string[]>('commands.escape', [''], {}))!
    expect(results.length).toBe(8)
    for (const r of results) expect(r).not.toMatch(/ESCAPED/)
  })

  it('turns sync host failures into sandbox errors', async () => {
    const sb = new ExtensionSandbox('err', `module.exports = { commands: { go: (a, ctx) => { try { ctx.store.get('k'); return 'ok' } catch (e) { return e.message } } } }`, (m, _a, resolve) =>
      resolve === null ? JSON.stringify({ __error: `denied ${m}` }) : undefined
    )
    expect(await sb.call('commands.go', [''], {})).toBe('denied storeGet')
  })

  it('stops infinite loops at load time', () => {
    expect(() => new ExtensionSandbox('loop', 'while (true) {}', makeHost())).toThrow(/timed out/i)
  })

  it('times out hooks that never finish', async () => {
    const sb = new ExtensionSandbox('slow', `module.exports = { commands: { wait: () => new Promise(() => {}) } }`, makeHost())
    await expect(sb.call('commands.wait', [], {}, 50)).rejects.toThrow(/longer than/)
  })

  it('reports syntax errors with the extension file name', () => {
    expect(() => new ExtensionSandbox('bad', 'module.exports = {', makeHost())).toThrow()
  })
})
