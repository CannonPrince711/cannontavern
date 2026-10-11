/**
 * Runs an extension's main.js in a separate V8 context.
 *
 * Node's `vm` is not a hard security boundary, so the design keeps host
 * objects out of reach entirely:
 *  - the context has no require, process, Buffer or timers, and code
 *    generation from strings (eval, new Function) is disabled;
 *  - the only host function in the context (the bridge) is captured inside a
 *    bootstrap closure that extension code cannot see;
 *  - every value crossing the boundary is JSON text, parsed by the receiving
 *    realm, so the extension never holds a host-realm object (whose
 *    `.constructor.constructor` would be the host's Function).
 * Extensions are still disabled by default and every capability is gated by
 * the permissions the user granted.
 */
import vm from 'node:vm'

/**
 * Host side of the bridge. Sync calls return JSON text (a failure is
 * `{"__error": "…"}`); async calls settle through the callbacks with strings.
 * It must never throw: a host Error object would leak into the sandbox.
 */
export type HostCall = (method: string, argsJson: string, resolve: ((json: string | undefined) => void) | null, reject: ((message: string) => void) | null) => string | undefined

interface SandboxHelpers {
  run: (path: string, argsJson: string, ctxJson: string) => Promise<string | undefined>
  exportsJson: () => string
  callable: (path: string) => boolean
}

const BOOTSTRAP = `(function (hostCall) {
  'use strict'
  const call = (method, args) => new Promise((resolve, reject) => {
    hostCall(method, JSON.stringify(args === undefined ? [] : args),
      (r) => resolve(r === undefined ? undefined : JSON.parse(r)),
      (msg) => reject(new Error(String(msg))))
  })
  const callSync = (method, args) => {
    const r = hostCall(method, JSON.stringify(args === undefined ? [] : args), null, null)
    const v = r === undefined ? undefined : JSON.parse(r)
    if (v && typeof v === 'object' && typeof v.__error === 'string') throw new Error(v.__error)
    return v
  }
  const log = (level) => (...a) => { callSync('log', [level, a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')]) }
  const console = Object.freeze({ log: log('log'), info: log('log'), warn: log('warn'), error: log('error') })
  const makeCtx = (snap) => Object.freeze({
    extensionId: snap.extensionId,
    session: snap.session, character: snap.character, campaign: snap.campaign, sheet: snap.sheet, settings: snap.settings,
    post: (role, text) => call('post', [role, text, snap.sessionPath]),
    generateText: (prompt, opts) => call('generateText', [prompt, opts]),
    generateImage: (prompt, opts) => call('generateImage', [prompt, opts, snap.sessionPath]),
    roll: (expr) => callSync('roll', [expr]),
    readNote: (path) => call('readNote', [path]),
    writeNote: (path, content) => call('writeNote', [path, content]),
    notify: (message) => { callSync('notify', [message]) },
    fetch: (url, opts) => call('fetch', [url, opts]),
    store: Object.freeze({ get: (key) => callSync('storeGet', [key]), set: (key, value) => { callSync('storeSet', [key, value]) } })
  })
  const module = { exports: {} }
  const get = (path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), module.exports)
  const helpers = Object.freeze({
    callable: (path) => typeof get(path) === 'function',
    exportsJson: () => JSON.stringify({
      commands: Object.keys((module.exports && module.exports.commands) || {}),
      hooks: Object.keys((module.exports && module.exports.hooks) || {})
    }),
    run: async (path, argsJson, ctxJson) => {
      const fn = get(path)
      if (typeof fn !== 'function') return undefined
      const args = JSON.parse(argsJson)
      const result = await fn(...args, makeCtx(JSON.parse(ctxJson)))
      return result === undefined ? undefined : JSON.stringify(result)
    }
  })
  // Built here so it belongs to the sandbox realm (a host-made object would leak the host's Function).
  const init = Object.freeze({ module, console })
  return { module, console, helpers, init }
})`

export class ExtensionSandbox {
  private helpers: SandboxHelpers

  constructor(readonly id: string, code: string, host: HostCall) {
    const context = vm.createContext(Object.create(null), {
      name: `extension:${id}`,
      codeGeneration: { strings: false, wasm: false }
    })
    const bootstrap = new vm.Script(BOOTSTRAP, { filename: 'tavern-bootstrap.js' }).runInContext(context) as (h: HostCall) => {
      module: { exports: unknown }
      console: unknown
      helpers: SandboxHelpers
      init: unknown
    }
    const { helpers, init } = bootstrap(host)
    this.helpers = helpers
    // The extension's top-level code runs inside the context, under a time limit.
    const ctxObj = context as Record<string, unknown>
    ctxObj.__tavernInit = init
    try {
      new vm.Script(
        `(function (module, exports, console) {
${code}
})(__tavernInit.module, __tavernInit.module.exports, __tavernInit.console)`,
        { filename: `${id}/main.js` }
      ).runInContext(context, { timeout: 2000 })
    } finally {
      delete ctxObj.__tavernInit
    }
  }

  /** Command and hook names the extension exports. */
  describe(): { commands: string[]; hooks: string[] } {
    return JSON.parse(this.helpers.exportsJson()) as { commands: string[]; hooks: string[] }
  }

  has(path: string): boolean {
    return this.helpers.callable(path)
  }

  /** Calls `module.exports.<path>(...args, ctx)`; everything crosses as JSON. Times out after `ms`. */
  async call<T>(path: string, args: unknown[], ctx: unknown, ms = 15_000): Promise<T | undefined> {
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${path} took longer than ${Math.round(ms / 1000)} s`)), ms)
    })
    try {
      const json = await Promise.race([this.helpers.run(path, JSON.stringify(args), JSON.stringify(ctx ?? null)), timeout])
      return json === undefined ? undefined : (JSON.parse(json) as T)
    } finally {
      clearTimeout(timer)
    }
  }
}
