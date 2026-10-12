import type { Settings, TextBackend } from '@shared/settings'

/** The backends to try, in order: the chat role (or default) first, then the rest if the fallback chain is on. */
/**
 * The chain with a campaign's model put into its first backend, the one that answers first.
 * Fallbacks keep their own models.
 */
export function withModel(chain: TextBackend[], model: string | undefined): TextBackend[] {
  const first = chain[0]
  if (!model || !first) return chain
  return [{ ...first, model }, ...chain.slice(1)]
}

export function backendChain(s: Settings, role: 'chat' | 'character' | 'summary' | 'imagePrompt' = 'chat'): TextBackend[] {
  // Characters fall back to the DM's backend, then the default.
  const primaryId = (role === 'character' ? (s.roles.character ?? s.roles.chat) : s.roles[role]) ?? s.defaultTextBackendId
  const primary = s.textBackends.find((b) => b.id === primaryId) ?? s.textBackends[0]
  if (!primary) return []
  if (!s.fallbackChain) return [primary]
  return [primary, ...s.textBackends.filter((b) => b.id !== primary.id)]
}
