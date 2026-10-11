import { safeStorage } from 'electron'
import type { SecretInput, SecretStored, SecretView } from '@shared/settings'
import { AppError } from './errors'
import { registerSecret } from './redact'

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
      if (!safeStorage.isEncryptionAvailable()) {
        throw new AppError('SECRET_UNAVAILABLE', 'OS encryption (DPAPI) is not available; cannot store keys.')
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
          'A stored key could not be decrypted. It may have been saved by another Windows user; enter it again.'
        )
      }
    }
  }
}
