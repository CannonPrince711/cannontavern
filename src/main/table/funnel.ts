/**
 * Tailscale Funnel for the table: shares the local table server at
 * https://<this-pc>.<tailnet>.ts.net so players can join from any browser,
 * without port forwarding. Started and stopped with hosting. Uses the
 * tailscale CLI; nothing is installed or configured here beyond the funnel.
 */
import { execFile, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { AppError } from '../errors'

const CANDIDATES =
  process.platform === 'win32'
    ? ['C:\\Program Files\\Tailscale\\tailscale.exe', 'C:\\Program Files (x86)\\Tailscale\\tailscale.exe', 'tailscale']
    : process.platform === 'darwin'
      ? ['/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/usr/local/bin/tailscale', '/opt/homebrew/bin/tailscale', 'tailscale']
      : ['/usr/bin/tailscale', '/usr/local/bin/tailscale', 'tailscale']

function cli(): string {
  return CANDIDATES.find((c) => c === 'tailscale' || existsSync(c)) ?? 'tailscale'
}

function run(args: string[], timeoutMs = 20_000): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    execFile(cli(), args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      const out = `${stdout ?? ''}${stderr ?? ''}`
      resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, out })
    })
  })
}

/** A Tailscale admin link the CLI prints when Funnel or HTTPS still has to be allowed. */
export function enableLink(out: string): string | null {
  return /https:\/\/login\.tailscale\.com\/\S+/.exec(out)?.[0].replace(/[).,]+$/, '') ?? null
}

/** This PC's public Funnel address, e.g. https://seth.tailf47d02.ts.net. */
async function publicBase(): Promise<string> {
  const { code, out } = await run(['status', '--json'])
  if (code !== 0) throw new AppError('TAILSCALE_DOWN', 'Tailscale isn’t running or isn’t signed in. Open Tailscale, sign in, then try again.')
  let dns = ''
  try {
    dns = String((JSON.parse(out) as { Self?: { DNSName?: string } }).Self?.DNSName ?? '')
  } catch {
    /* fall through */
  }
  if (!dns) throw new AppError('TAILSCALE_NO_DNS', 'Tailscale has no name for this PC. Turn on MagicDNS in the Tailscale admin console (DNS page).')
  return `https://${dns.replace(/\.$/, '')}`
}

/**
 * Shares 127.0.0.1:<port> through Funnel and returns the public address.
 * When Funnel (or HTTPS) isn't allowed yet, throws with the admin link to allow it.
 */
export async function startFunnel(port: number): Promise<string> {
  const base = await publicBase()
  // The CLI waits for approval when Funnel isn't allowed yet; a short timeout catches that.
  const { code, out } = await run(['funnel', '--bg', String(port)], 15_000)
  const link = enableLink(out)
  if (link) {
    throw new AppError('FUNNEL_NOT_ALLOWED', 'Funnel isn’t allowed on your Tailscale account yet. Approve it on the page that opened, then start hosting again.', link)
  }
  if (code !== 0) throw new AppError('FUNNEL_FAILED', `Tailscale couldn’t start Funnel: ${out.trim().split('\n').slice(-3).join(' ') || 'no details'}`)
  return base
}

/** Turns the table's Funnel off (only the https:443 share it made). */
export async function stopFunnel(): Promise<void> {
  await run(['funnel', '--https=443', 'off'], 10_000)
}

/** For app quit, when there's no time for async work. */
export function stopFunnelSync(): void {
  spawnSync(cli(), ['funnel', '--https=443', 'off'], { timeout: 5_000, windowsHide: true })
}
