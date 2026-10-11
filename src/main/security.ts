import { app, session, shell } from 'electron'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

const DEV_URL = process.env['ELECTRON_RENDERER_URL']

export function rendererIndexFile(): string {
  return join(__dirname, '../renderer/index.html')
}

/** True for our own renderer page (dev server or packaged file). */
export function isTrustedRendererUrl(url: string): boolean {
  if (!url) return false
  if (!app.isPackaged && DEV_URL && url.startsWith(DEV_URL)) return true
  const indexUrl = pathToFileURL(rendererIndexFile()).href
  return url.split('#')[0]?.split('?')[0] === indexUrl
}

const EXTERNAL_PROTOCOLS = new Set(['https:', 'obsidian:'])

/** Only https: and obsidian: links ever leave the app. */
export async function openExternalSafe(url: string): Promise<boolean> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (!EXTERNAL_PROTOCOLS.has(parsed.protocol)) return false
  await shell.openExternal(parsed.href)
  return true
}

export function installSecurity(): void {
  // No web permission (camera, notifications, geolocation...) is granted,
  // except writing to the clipboard for "Copy details" buttons.
  const allowed = new Set(['clipboard-sanitized-write'])
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)))
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission))

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      if (!isTrustedRendererUrl(url)) {
        event.preventDefault()
        void openExternalSafe(url)
      }
    })
    contents.on('will-redirect', (event, url) => {
      if (!isTrustedRendererUrl(url)) event.preventDefault()
    })
    contents.on('will-attach-webview', (event) => event.preventDefault())
    contents.setWindowOpenHandler(({ url }) => {
      void openExternalSafe(url)
      return { action: 'deny' }
    })
  })
}
