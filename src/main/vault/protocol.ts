import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import { IMAGE_EXTENSIONS } from '@shared/layout'
import { vaultService } from './service'

/**
 * vault://file/<vault path> serves images from inside the root folder to the
 * renderer (avatars, generated images) without base64-encoding them over IPC.
 * Only image files inside the root folder are served.
 */
export const VAULT_SCHEME = 'vault'

export function vaultSchemeConfig(): Electron.CustomScheme {
  return { scheme: VAULT_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
}

export function handleVaultProtocol(): void {
  protocol.handle(VAULT_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      const path = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
      const vault = vaultService.vault
      const ext = path.split('.').pop()?.toLowerCase() ?? ''
      if (!vault || !vault.isInRoot(path) || !IMAGE_EXTENSIONS.includes(ext)) {
        return new Response('Not found', { status: 404 })
      }
      const res = await net.fetch(pathToFileURL(vault.resolve(path)).href)
      return new Response(res.body, {
        status: res.status,
        headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/octet-stream', 'Cache-Control': 'no-cache' }
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}
