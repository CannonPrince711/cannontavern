import type { Settings, TextBackend } from '@shared/settings'

/** The backends to try, in order: the chat role (or default) first, then the rest if the fallback chain is on. */
export function backendChain(s: Settings, role: 'chat' | 'summary' | 'imagePrompt' = 'chat'): TextBackend[] {
  const primaryId = s.roles[role] ?? s.defaultTextBackendId
  const primary = s.textBackends.find((b) => b.id === primaryId) ?? s.textBackends[0]
  if (!primary) return []
  if (!s.fallbackChain) return [primary]
  return [primary, ...s.textBackends.filter((b) => b.id !== primary.id)]
}
