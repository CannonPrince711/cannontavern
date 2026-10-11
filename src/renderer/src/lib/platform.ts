import { useApp } from '@/stores/app'

/** Where API keys are encrypted, for the key fields: "Windows DPAPI", "the system keyring"… */
export function keyStorageName(): string {
  return useApp.getState().info?.keyStorage ?? 'the OS key store'
}

/** One sentence for the API key fields. */
export function keyStorageHint(): string {
  const info = useApp.getState().info
  if (info && !info.keyStorage) return 'No system keyring is running, so keys can’t be saved encrypted here.'
  return `Encrypted with ${keyStorageName()} and never shown again.`
}
