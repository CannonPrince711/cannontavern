import type { SecretInput, SecretStored } from '@shared/settings'
import type { NetConfig } from '../http'
import { registerSecret } from '../redact'
import { reveal } from '../secrets'

type HeaderRow<S> = { name: string; value: S }

interface NetworkStored {
  headers: HeaderRow<SecretStored>[]
  proxy: string
  allowSelfSigned: boolean
  timeoutMs: number
  retries: number
}

interface NetworkInput {
  headers: HeaderRow<SecretInput>[]
  proxy: string
  allowSelfSigned: boolean
  timeoutMs: number
  retries: number
}

export function netFromStored(n: NetworkStored): NetConfig {
  return {
    headers: Object.fromEntries(n.headers.filter((h) => h.name.trim()).map((h) => [h.name.trim(), reveal(h.value)])),
    proxy: n.proxy.trim(),
    allowSelfSigned: n.allowSelfSigned,
    timeoutMs: n.timeoutMs,
    retries: n.retries
  }
}

/** Plaintext value of an unsaved form's secret; "keep" falls back to what is stored. */
export function revealInput(input: SecretInput, previous: SecretStored | undefined): string {
  switch (input.kind) {
    case 'none':
      return ''
    case 'plain':
    case 'set':
      registerSecret(input.value)
      return input.value
    case 'env': {
      const v = process.env[input.name] ?? ''
      registerSecret(v)
      return v
    }
    case 'keep':
      return previous ? reveal(previous) : ''
  }
}

export function netFromInput(n: NetworkInput, previous: NetworkStored | undefined): NetConfig {
  return {
    headers: Object.fromEntries(
      n.headers
        .filter((h) => h.name.trim())
        .map((h) => [h.name.trim(), revealInput(h.value, findHeader(previous, h.name))])
    ),
    proxy: n.proxy.trim(),
    allowSelfSigned: n.allowSelfSigned,
    timeoutMs: n.timeoutMs,
    retries: n.retries
  }
}

export function findHeader(previous: NetworkStored | undefined, name: string): SecretStored | undefined {
  return previous?.headers.find((h) => h.name.trim().toLowerCase() === name.trim().toLowerCase())?.value
}
