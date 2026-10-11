/**
 * Decides whether a backend URL deserves the "unencrypted connection" warning:
 * plain http:// to anything that isn't this machine, a private LAN, or a
 * Tailscale/VPN address.
 */
export function isInsecureUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'ws:') return false
  return !isPrivateHost(url.hostname)
}

export function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  // mDNS / home-network / Tailscale MagicDNS names.
  if (/\.(local|lan|home|internal|home\.arpa|ts\.net)$/.test(host)) return true
  if (!host.includes('.') && !host.includes(':')) return true // single-label LAN name

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    return (
      a === 127 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      // Tailscale / carrier-grade NAT range 100.64.0.0/10.
      (a === 100 && b >= 64 && b <= 127)
    )
  }
  if (host.includes(':')) {
    return (
      host === '::1' ||
      host.startsWith('fc') ||
      host.startsWith('fd') || // unique local, includes Tailscale fd7a:115c:a1e0::/48
      host.startsWith('fe80')
    )
  }
  return false
}

/** "http://host:port/path" → "host:port" for messages. */
export function hostOf(raw: string): string {
  try {
    return new URL(raw).host
  } catch {
    return raw
  }
}
