import { safeStorage } from 'electron'
import type { SecretInput, SecretStored, SecretView } from '@shared/settings'
import { AppError } from './errors'
import { registerSecret } from './redact'

/**
 * Where keys are encrypted, for the UI ("Windows DPAPI", "the system
 * keyring"…), or null when there's nowhere safe. On Linux without GNOME
 * Keyring or KWallet, Electron falls back to a fixed password ("basic_text"),
 * which isn't encryption worth the name, so that counts as unavailable.
 */
export function keyStorage(): string | null {
  if (!safeStorage.isEncryptionAvailable()) return null
  if (process.platform === 'win32') return 'Windows DPAPI'
  if (process.platform === 'darwin') return 'the macOS Keychain'
  const backend = safeStorage.getSelectedStorageBackend()
  if (backend === 'basic_text' || backend === 'unknown') return null
  return backend.startsWith('kwallet') ? 'KWallet' : 'the system keyring'
}

export function toView(secret: SecretStored): SecretView {
  switch (secret.kind) {
    case 'encrypted':
      return { kind: 'stored' }
    default:
      return secret
  }
}

/** Resolves an input from the renderer against the currently stored value. */
export function fromInput(input: SecretInput, previous: SecretStored | undefined): SecretStored {
  switch (input.kind) {
    case 'keep':
      return previous ?? { kind: 'none' }
    case 'set': {
      if (!input.value) return { kind: 'none' }
      if (!keyStorage()) {
        throw new AppError(
          'SECRET_UNAVAILABLE',
          process.platform === 'linux'
            ? 'No system keyring is running (GNOME Keyring or KWallet), so the key can’t be stored encrypted. Start one, or type env:NAME to read the key from an environment variable.'
            : 'OS encryption is not available, so the key can’t be stored. Type env:NAME to read it from an environment variable instead.'
        )
      }
      registerSecret(input.value)
      return { kind: 'encrypted', data: safeStorage.encryptString(input.value).toString('base64') }
    }
    default:
      return input
  }
}

/** Returns the plaintext value, or '' when unset. Never send this to the renderer. */
export function reveal(secret: SecretStored): string {
  switch (secret.kind) {
    case 'none':
      return ''
    case 'plain':
      return secret.value
    case 'env': {
      const value = process.env[secret.name] ?? ''
      registerSecret(value)
      return value
    }
    case 'encrypted': {
      try {
        const value = safeStorage.decryptString(Buffer.from(secret.data, 'base64'))
        registerSecret(value)
        return value
      } catch {
        throw new AppError(
          'SECRET_DECRYPT_FAILED',
          process.platform === 'linux'
            ? 'A stored key could not be decrypted. The keyring may be locked, or the key was saved by another user; unlock it or enter the key again.'
            : 'A stored key could not be decrypted. It may have been saved by another Windows user; enter it again.'
        )
      }
    }
  }
}
