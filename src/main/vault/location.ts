import { isAbsolute, join, relative, resolve } from 'node:path'

/** True when `child` is `parent` itself or somewhere inside it. */
export function isInsideFolder(child: string, parent: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Whether the vault's data folder sits inside the app's install folder.
 * Updates and uninstalls replace that folder, deleting everything in it.
 * `installFolder` is null when running unpackaged (development).
 */
export function vaultInInstallFolder(vaultPath: string, rootFolder: string, installFolder: string | null): boolean {
  return !!installFolder && isInsideFolder(join(vaultPath, rootFolder), installFolder)
}

export function installFolderWarning(installFolder: string): string {
  return `DND Tavern’s install folder (${installFolder}) is replaced on every update, which would delete your campaigns. Choose a vault folder outside it, such as Documents\\DND Vault.`
}
