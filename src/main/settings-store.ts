import { EventEmitter } from 'node:events'
import {
  SettingsSchema,
  defaultSettings,
  type ImageBackend,
  type PublicSettings,
  type Settings,
  type SettingsPatch,
  type TextBackend
} from '@shared/settings'
import { readJson, writeFileAtomic } from './atomic'
import { paths } from './paths'
import { toView } from './secrets'

type Listener = (settings: Settings, previous: Settings) => void

class SettingsStore {
  private current: Settings = defaultSettings()
  private events = new EventEmitter()
  private writing: Promise<void> = Promise.resolve()

  async load(): Promise<void> {
    const raw = await readJson(paths.settingsFile).catch((err) => {
      console.error('[settings] could not read settings.json, using defaults:', err)
      return undefined
    })
    const parsed = SettingsSchema.safeParse(raw ?? {})
    if (parsed.success) {
      this.current = parsed.data
    } else {
      console.error('[settings] settings.json failed validation, using defaults:', parsed.error.message)
      this.current = defaultSettings()
    }
  }

  get(): Settings {
    return this.current
  }

  getPublic(): PublicSettings {
    return toPublic(this.current)
  }

  /** Replaces the whole settings object (used by backend and import operations). */
  async set(next: Settings): Promise<Settings> {
    const previous = this.current
    this.current = SettingsSchema.parse(next)
    await this.persist()
    this.events.emit('change', this.current, previous)
    return this.current
  }

  async patch(patch: SettingsPatch): Promise<Settings> {
    const next = structuredClone(this.current)
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue
      const k = key as keyof Settings
      const prev = next[k]
      if (value !== null && typeof value === 'object' && !Array.isArray(value) && typeof prev === 'object' && prev !== null) {
        Object.assign(prev, stripUndefined(value as Record<string, unknown>))
      } else {
        ;(next as Record<string, unknown>)[k] = value
      }
    }
    return this.set(next)
  }

  onChange(listener: Listener): () => void {
    this.events.on('change', listener)
    return () => this.events.off('change', listener)
  }

  private persist(): Promise<void> {
    const snapshot = JSON.stringify(this.current, null, 2)
    // Serialise writes so an older snapshot can never land after a newer one.
    this.writing = this.writing.then(() => writeFileAtomic(paths.settingsFile, snapshot))
    return this.writing
  }
}

function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined))
}

function textToView(b: TextBackend): PublicSettings['textBackends'][number] {
  return {
    ...b,
    apiKey: toView(b.apiKey),
    network: { ...b.network, headers: b.network.headers.map((h) => ({ name: h.name, value: toView(h.value) })) }
  }
}

function imageToView(b: ImageBackend): PublicSettings['imageBackends'][number] {
  return {
    ...b,
    apiKey: toView(b.apiKey),
    network: { ...b.network, headers: b.network.headers.map((h) => ({ name: h.name, value: toView(h.value) })) }
  }
}

export function toPublic(s: Settings): PublicSettings {
  return {
    ...s,
    textBackends: s.textBackends.map(textToView),
    imageBackends: s.imageBackends.map(imageToView)
  }
}

export const settingsStore = new SettingsStore()
