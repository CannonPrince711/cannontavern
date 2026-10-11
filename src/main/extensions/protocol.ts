/**
 * ext://<id>/panel.html  — the page hosting an extension's UI (loaded in a
 *                          sandboxed iframe with an opaque origin, so it can
 *                          never reach window.api).
 * ext://<id>/ui.js       — the extension's UI module.
 * ext://host/bridge.js   — the postMessage bridge offered to every panel.
 */
import { protocol } from 'electron'
import { promises as fs } from 'node:fs'
import { join, normalize, relative, isAbsolute } from 'node:path'
import { extensionHost } from './host'

export const EXT_SCHEME = 'ext'

export function registerExtensionScheme(): Electron.CustomScheme {
  return { scheme: EXT_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
}

const BRIDGE = `
(() => {
  let seq = 0
  const pending = new Map()
  const listeners = { state: [] }
  let state = null
  const send = (type, payload) => parent.postMessage({ __tavern: true, type, payload }, '*')
  const request = (type, payload) => new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    parent.postMessage({ __tavern: true, type, payload, id }, '*')
  })
  window.addEventListener('message', (ev) => {
    const m = ev.data
    if (!m || !m.__tavern) return
    if (m.type === 'reply' && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id)
      m.error ? p.reject(new Error(m.error)) : p.resolve(m.payload)
    } else if (m.type === 'state') {
      state = m.payload
      const vars = (m.payload && m.payload.theme) || {}
      for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v)
      listeners.state.forEach((f) => { try { f(state) } catch (e) { console.error(e) } })
    } else if (m.type === 'decorate' && api.__onMessageRender) {
      const el = document.createElement('div')
      Promise.resolve(api.__onMessageRender(el, m.payload.message, { extensionId: m.payload.extensionId }))
        .then(() => send('decoration', { messageId: m.payload.message.id, text: el.textContent || '' }))
        .catch(() => send('decoration', { messageId: m.payload.message.id, text: '' }))
    }
  })
  const api = {
    notify: (message) => send('notify', String(message)),
    runCommand: (command, args) => request('runCommand', { command, args: args || '' }),
    getState: () => state,
    onState: (fn) => { listeners.state.push(fn); if (state) fn(state) },
    resize: (height) => send('resize', Number(height) || 0)
  }
  window.tavern = api
  const params = new URLSearchParams(location.search)
  import('ext://' + location.host + '/ui.js').then((mod) => {
    const ext = (mod && mod.default) || mod || {}
    if (typeof ext.onMessageRender === 'function') api.__onMessageRender = ext.onMessageRender
    if (typeof ext.panel === 'function' && params.get('mode') !== 'worker') ext.panel(document.getElementById('root'), api)
    send('ready', { hasPanel: typeof ext.panel === 'function', decorates: typeof ext.onMessageRender === 'function' })
    new ResizeObserver(() => send('resize', document.documentElement.scrollHeight)).observe(document.body)
  }).catch((err) => {
    document.getElementById('root').textContent = 'This extension’s UI failed to load: ' + err.message
    send('error', String(err && err.message || err))
  })
})()
`

const PANEL_CSS = `
:root { color-scheme: dark; font: 13px/1.5 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif; }
html, body { margin: 0; background: transparent; color: var(--foreground, #ece6dc); }
#root { padding: 2px; }
button { font: inherit; color: var(--primary-foreground, #1a1405); background: var(--primary, #c9a227); border: 0; border-radius: 6px; padding: 4px 10px; cursor: pointer; }
button.secondary { color: var(--foreground, #ece6dc); background: var(--secondary, #2a2530); }
input, select, textarea { font: inherit; color: inherit; background: var(--background, #121014); border: 1px solid var(--input, #3a3341); border-radius: 6px; padding: 4px 8px; }
.muted { color: var(--muted-foreground, #a99f92); }
.card { border: 1px solid var(--border, #2f2935); background: var(--card, #1b181f); border-radius: 8px; padding: 8px 10px; }
h1, h2, h3 { font-family: Cinzel, Georgia, serif; letter-spacing: .04em; margin: 0 0 6px; font-size: 14px; }
`

/** The panel page: no inline script; the bridge loads ext://<id>/ui.js itself. */
function page(): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ext:; style-src 'unsafe-inline' ext:; img-src data: ext:; connect-src 'none'">
<link rel="stylesheet" href="ext://host/panel.css"></head>
<body><div id="root"></div><script src="ext://host/bridge.js"></script></body></html>`
}

export function handleExtensionProtocol(): void {
  protocol.handle(EXT_SCHEME, async (req) => {
    const url = new URL(req.url)
    const headers = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' }
    if (url.host === 'host') {
      if (url.pathname === '/bridge.js') return new Response(BRIDGE, { headers: { ...headers, 'Content-Type': 'text/javascript' } })
      if (url.pathname === '/panel.css') return new Response(PANEL_CSS, { headers: { ...headers, 'Content-Type': 'text/css' } })
      return new Response('Not found', { status: 404 })
    }
    const info = extensionHost.info(url.host)
    if (!info?.enabled || !info.hasUi) return new Response('Not found', { status: 404 })
    if (url.pathname === '/panel.html') {
      return new Response(page(), { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } })
    }
    // Any other file inside the extension folder (ui.js, images, css).
    const requested = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
    const rel = normalize(requested === 'ui.js' ? (info.manifest.ui ?? 'ui.js') : requested)
    const abs = join(info.dir, rel)
    const r = relative(info.dir, abs)
    if (!rel || r.startsWith('..') || isAbsolute(r) || rel === 'main.js' || rel === (info.manifest.main ?? 'main.js')) return new Response('Not found', { status: 404 })
    try {
      const data = await fs.readFile(abs)
      const type = rel.endsWith('.js') || rel.endsWith('.mjs') ? 'text/javascript' : rel.endsWith('.css') ? 'text/css' : rel.endsWith('.png') ? 'image/png' : rel.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream'
      return new Response(data, { headers: { ...headers, 'Content-Type': type } })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}
