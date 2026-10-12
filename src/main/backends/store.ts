import { randomUUID } from 'node:crypto'
import {
  ImageBackendSchema,
  TextBackendSchema,
  type ImageBackend,
  type ImageBackendInput,
  type SecretInput,
  type SecretStored,
  type Settings,
  type TextBackend,
  type TextBackendInput
} from '@shared/settings'
import { AppError } from '../errors'
import { fromInput, reveal } from '../secrets'
import { findHeader } from './resolve'

type NetworkInput = TextBackendInput['network']
type NetworkStored = TextBackend['network']

function storeNetwork(input: NetworkInput, previous: NetworkStored | undefined): NetworkStored {
  return {
    ...input,
    headers: input.headers
      .filter((h) => h.name.trim())
      .map((h) => ({ name: h.name.trim(), value: fromInput(h.value, findHeader(previous, h.name)) }))
  }
}

/** Converts a form from the renderer into what is written to settings.json (secrets encrypted). */
export function storeTextBackend(input: TextBackendInput, previous: TextBackend | undefined): TextBackend {
  return TextBackendSchema.parse({
    ...input,
    id: input.id || randomUUID(),
    apiKey: fromInput(input.apiKey, previous?.apiKey),
    network: storeNetwork(input.network, previous?.network)
  })
}

export function storeImageBackend(input: ImageBackendInput, previous: ImageBackend | undefined): ImageBackend {
  return ImageBackendSchema.parse({
    ...input,
    id: input.id || randomUUID(),
    apiKey: fromInput(input.apiKey, previous?.apiKey),
    network: storeNetwork(input.network, previous?.network)
  })
}

type ListKey = 'textBackends' | 'imageBackends'
type DefaultKey = 'defaultTextBackendId' | 'defaultImageBackendId'

/** List operations shared by text and image backends. Each returns new settings. */
export const backendList = {
  upsert<K extends ListKey>(s: Settings, key: K, backend: Settings[K][number]): Settings {
    const list = [...s[key]] as Settings[K][number][]
    const i = list.findIndex((b) => b.id === backend.id)
    if (i === -1) list.push(backend)
    else list[i] = backend
    const next = { ...s, [key]: list } as Settings
    const def = defaultKey(key)
    if (!next[def] || !list.some((b) => b.id === next[def])) next[def] = backend.id
    return next
  },

  remove(s: Settings, key: ListKey, id: string): Settings {
    const list = (s[key] as { id: string }[]).filter((b) => b.id !== id)
    const next = { ...s, [key]: list } as Settings
    const def = defaultKey(key)
    if (next[def] === id) next[def] = list[0]?.id ?? null
    if (key === 'textBackends') {
      next.roles = Object.fromEntries(
        Object.entries(s.roles).map(([role, v]) => [role, v === id ? null : v])
      ) as Settings['roles']
    }
    return next
  },

  duplicate(s: Settings, key: ListKey, id: string): Settings {
    const list = [...s[key]] as { id: string; name: string }[]
    const i = list.findIndex((b) => b.id === id)
    if (i === -1) throw new AppError('NOT_FOUND', 'That backend no longer exists.')
    const copy = { ...structuredClone(list[i]!), id: randomUUID(), name: `${list[i]!.name} (copy)` }
    list.splice(i + 1, 0, copy)
    return { ...s, [key]: list } as Settings
  },

  reorder(s: Settings, key: ListKey, ids: string[]): Settings {
    const list = s[key] as { id: string }[]
    const byId = new Map(list.map((b) => [b.id, b]))
    const ordered = ids.map((id) => byId.get(id)).filter((b): b is { id: string } => !!b)
    for (const b of list) if (!ids.includes(b.id)) ordered.push(b)
    return { ...s, [key]: ordered } as Settings
  }
}

function defaultKey(key: ListKey): DefaultKey {
  return key === 'textBackends' ? 'defaultTextBackendId' : 'defaultImageBackendId'
}

/** Secret → export form: kept only when the user ticked "include keys". */
export function exportSecret(secret: SecretStored, includeKeys: boolean): SecretInput {
  switch (secret.kind) {
    case 'encrypted':
      // Without keys, the file says "keep": opening it keeps whatever key this PC has for that backend.
      return includeKeys ? { kind: 'set', value: reveal(secret) } : { kind: 'keep' }
    case 'plain':
      return { kind: 'plain', value: secret.value }
    case 'env':
      return { kind: 'env', name: secret.name }
    default:
      return { kind: 'none' }
  }
}
