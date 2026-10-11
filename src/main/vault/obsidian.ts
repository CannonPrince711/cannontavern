import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import type { DetectedVault, VaultValidation } from '@shared/types'

/**
 * Reads Obsidian's own vault list (%APPDATA%\obsidian\obsidian.json). Only that
 * file is read; nothing inside any vault's .obsidian/ is touched.
 */
export async function detectObsidianVaults(appDataDir: string): Promise<DetectedVault[]> {
  let raw: string
  try {
    raw = await fs.readFile(join(appDataDir, 'obsidian', 'obsidian.json'), 'utf8')
  } catch {
    return []
  }
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return []
  }
  const vaults = (json as { vaults?: Record<string, { path?: unknown; ts?: unknown; open?: unknown }> }).vaults
  if (!vaults || typeof vaults !== 'object') return []

  const found: DetectedVault[] = []
  for (const v of Object.values(vaults)) {
    if (typeof v?.path !== 'string') continue
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
