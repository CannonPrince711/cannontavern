import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import type { DetectedVault, VaultValidation } from '@shared/types'

/**
 * Where Obsidian keeps its vault list: %APPDATA%\obsidian on Windows,
 * ~/.config/obsidian on Linux, plus the Flatpak and Snap sandboxes.
 */
export function obsidianConfigFiles(appDataDir: string, home: string, platform: NodeJS.Platform = process.platform): string[] {
  const files = [join(appDataDir, 'obsidian', 'obsidian.json')]
  if (platform === 'linux') {
    files.push(join(home, '.var', 'app', 'md.obsidian.Obsidian', 'config', 'obsidian', 'obsidian.json'))
    files.push(join(home, 'snap', 'obsidian', 'current', '.config', 'obsidian', 'obsidian.json'))
  }
  return files
}

/**
 * Reads Obsidian's own vault list (obsidian.json; see obsidianConfigFiles).
 * Only that file is read; nothing inside any vault's .obsidian/ is touched.
 */
export async function detectObsidianVaults(configFiles: string | string[]): Promise<DetectedVault[]> {
  const files = typeof configFiles === 'string' ? [join(configFiles, 'obsidian', 'obsidian.json')] : configFiles
  const entries: { path?: unknown; ts?: unknown; open?: unknown }[] = []
  for (const file of files) {
    try {
      const json = JSON.parse(await fs.readFile(file, 'utf8')) as { vaults?: Record<string, { path?: unknown; ts?: unknown; open?: unknown }> }
      if (json.vaults && typeof json.vaults === 'object') entries.push(...Object.values(json.vaults))
    } catch {
      // not installed this way, or unreadable
    }
  }

  const found: DetectedVault[] = []
  const seen = new Set<string>()
  for (const v of entries) {
    if (typeof v?.path !== 'string' || seen.has(v.path)) continue
    seen.add(v.path)
    try {
      if (!(await fs.stat(v.path)).isDirectory()) continue
    } catch {
      continue
    }
    found.push({
      path: v.path,
      name: basename(v.path),
      open: v.open === true,
      lastOpened: typeof v.ts === 'number' ? v.ts : undefined
    })
  }
  return found.sort((a, b) => Number(b.open) - Number(a.open) || (b.lastOpened ?? 0) - (a.lastOpened ?? 0))
}

export async function validateVault(path: string): Promise<VaultValidation> {
  const result: VaultValidation = { exists: false, writable: false, isObsidianVault: false, name: basename(path) }
  try {
    if (!(await fs.stat(path)).isDirectory()) return result
  } catch {
    return result
  }
  result.exists = true
  try {
    result.isObsidianVault = (await fs.stat(join(path, '.obsidian'))).isDirectory()
  } catch {
    /* plain folder */
  }
  // fs.access(W_OK) is unreliable for folders on Windows; try a real write.
  const probe = join(path, `.dnd-tavern-probe-${randomBytes(4).toString('hex')}`)
  try {
    await fs.writeFile(probe, '')
    result.writable = true
  } catch {
    result.writable = false
  } finally {
    await fs.rm(probe, { force: true }).catch(() => {})
  }
  return result
}

/** obsidian://open?vault=<name>&file=<path> (the .md extension is optional). */
export function obsidianUri(vaultName: string, path: string): string {
  return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(path.replace(/\.md$/i, ''))}`
}
