import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { fetch as undiciFetch } from 'undici'
import { newMessageId } from '@shared/callouts'
import { roll } from '@shared/dice'
import { joinVaultPath } from '@shared/names'
import { ExtensionManifestSchema } from '@shared/settings'
import type { ExtensionInfo, ExtensionManifest, ExtensionPermission, MessageRole, PromptBlock, RollResult, VaultPath } from '@shared/types'
import { writeFileAtomic, readJson } from '../atomic'
import { getDispatcher } from '../http'
import { send } from '../ipc'
import { readCampaign, readCharacter, resolveCharacterLink } from '../library'
import { paths } from '../paths'
import { redact } from '../redact'
import { postMessage, readSession } from '../sessions'
import { settingsStore } from '../settings-store'
import { vaultService } from '../vault/service'
import { getMainWindow } from '../window'
import { ExtensionSandbox, type HostCall } from './sandbox'

interface Loaded {
  info: ExtensionInfo
  sandbox?: ExtensionSandbox
  hooks: string[]
}

const PERMISSION_FOR: Record<string, ExtensionPermission> = {
  readNote: 'vault:read',
  writeNote: 'vault:write',
  fetch: 'network',
  generateText: 'generate:text',
  generateImage: 'generate:image'
}

/** Late-bound services (avoids import cycles with chat/images). */
export interface ExtensionServices {
  generateText: (prompt: string, opts: { system?: string; maxTokens?: number }) => Promise<string>
  generateImage: (prompt: string, sessionPath: VaultPath | undefined, opts: Record<string, unknown>) => Promise<unknown>
}

class ExtensionHost {
  private loaded = new Map<string, Loaded>()
  private stores = new Map<string, Record<string, unknown>>()
  private storeTimers = new Map<string, NodeJS.Timeout>()
  private lastErrorToast = new Map<string, number>()
  services: ExtensionServices | null = null

  // ─── Discovery ──────────────────────────────────────────────────────────

  /** Copies bundled example extensions to userData the first time each appears. */
  async installBundled(): Promise<void> {
    const markerFile = join(paths.extensionsDir, '.bundled.json')
    await fs.mkdir(paths.extensionsDir, { recursive: true })
    const installed = new Set(((await readJson(markerFile).catch(() => undefined)) as string[] | undefined) ?? [])
    let entries: string[] = []
    try {
      entries = (await fs.readdir(paths.bundledExtensionsDir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name)
    } catch {
      return
    }
    for (const name of entries) {
      if (installed.has(name)) continue
      const target = join(paths.extensionsDir, name)
      const exists = await fs.stat(target).then(() => true, () => false)
      if (!exists) await fs.cp(join(paths.bundledExtensionsDir, name), target, { recursive: true })
      installed.add(name)
    }
    await writeFileAtomic(markerFile, JSON.stringify([...installed], null, 2))
  }

  async reload(): Promise<ExtensionInfo[]> {
    this.loaded.clear()
    const bundled = new Set<string>()
    try {
      for (const e of await fs.readdir(paths.bundledExtensionsDir, { withFileTypes: true })) if (e.isDirectory()) bundled.add(e.name)
    } catch {
      /* no bundled folder in this build */
    }
    let dirs: string[] = []
    try {
      dirs = (await fs.readdir(paths.extensionsDir, { withFileTypes: true })).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name)
    } catch {
      dirs = []
    }
    const enabled = settingsStore.get().extensions.enabled
    for (const dirName of dirs) {
      const dir = join(paths.extensionsDir, dirName)
      let manifest: ExtensionManifest
      try {
        manifest = ExtensionManifestSchema.parse(JSON.parse(await fs.readFile(join(dir, 'extension.json'), 'utf8'))) as ExtensionManifest
      } catch (err) {
        console.warn(`[extensions] skipping ${dirName}: invalid extension.json`, (err as Error).message)
        continue
      }
      const mainFile = manifest.main ?? 'main.js'
      const uiFile = manifest.ui ?? 'ui.js'
      const hasMain = await fs.stat(join(dir, mainFile)).then((s) => s.isFile(), () => false)
      const hasUi = await fs.stat(join(dir, uiFile)).then((s) => s.isFile(), () => false)
      const grant = enabled[manifest.id]
      const info: ExtensionInfo = {
        manifest,
        dir,
        enabled: !!grant,
        granted: (grant?.granted ?? []).filter((p): p is ExtensionPermission => manifest.permissions.includes(p as ExtensionPermission)),
        status: grant ? 'loaded' : 'disabled',
        hasMain,
        hasUi,
        values: this.values(manifest),
        bundled: bundled.has(dirName)
      }
      const entry: Loaded = { info, hooks: [] }
      if (grant && hasMain) {
        try {
          const code = await fs.readFile(join(dir, mainFile), 'utf8')
          entry.sandbox = new ExtensionSandbox(manifest.id, code, this.hostCall(manifest.id))
          entry.hooks = entry.sandbox.describe().hooks
        } catch (err) {
          info.status = 'error'
          info.error = redact((err as Error).message)
        }
      }
      this.loaded.set(manifest.id, entry)
    }
    return this.list()
  }

  list(): ExtensionInfo[] {
    return [...this.loaded.values()].map((l) => ({ ...l.info, values: this.values(l.info.manifest) })).sort((a, b) => a.manifest.name.localeCompare(b.manifest.name))
  }

  info(id: string): ExtensionInfo | undefined {
    return this.loaded.get(id)?.info
  }

  private values(manifest: ExtensionManifest): Record<string, unknown> {
    const saved = settingsStore.get().extensions.settings[manifest.id] ?? {}
    return Object.fromEntries((manifest.settings ?? []).map((d) => [d.key, saved[d.key] ?? d.default]))
  }

  async setEnabled(id: string, enabled: boolean, granted: ExtensionPermission[]): Promise<ExtensionInfo[]> {
    const entry = this.loaded.get(id)
    if (!entry) throw new Error(`Unknown extension “${id}”.`)
    const s = settingsStore.get()
    const next = { ...s.extensions.enabled }
    if (enabled) next[id] = { granted: granted.filter((p) => entry.info.manifest.permissions.includes(p)) }
    else delete next[id]
    await settingsStore.set({ ...s, extensions: { ...s.extensions, enabled: next } })
    return this.reload()
  }

  async saveSettings(id: string, values: Record<string, unknown>): Promise<ExtensionInfo[]> {
    const s = settingsStore.get()
    await settingsStore.set({ ...s, extensions: { ...s.extensions, settings: { ...s.extensions.settings, [id]: values } } })
    return this.list()
  }

  // ─── The bridge (every capability is checked here) ──────────────────────

  private hostCall(id: string): HostCall {
    return (method, argsJson, resolve, reject) => {
      const name = this.loaded.get(id)?.info.manifest.name ?? id
      let args: unknown[]
      try {
        args = JSON.parse(argsJson) as unknown[]
      } catch {
        args = []
      }
      const needed = PERMISSION_FOR[method]
      const granted = this.loaded.get(id)?.info.granted ?? []
      const denied = needed && !granted.includes(needed) ? `${name} was not granted the “${needed}” permission.` : null

      // Synchronous calls: return JSON text, never throw.
      if (resolve === null) {
        try {
          if (denied) return JSON.stringify({ __error: denied })
          switch (method) {
            case 'log': {
              const [level, text] = args as [string, string]
              const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
              fn(`[ext:${id}]`, String(text).slice(0, 2000))
              return undefined
            }
            case 'notify':
              send(getMainWindow(), 'toast', { level: 'info', title: String(args[0] ?? '').slice(0, 300), source: name })
              send(getMainWindow(), 'extensions:notify', { extensionId: id, message: String(args[0] ?? '') })
              return undefined
            case 'roll':
              return JSON.stringify(roll(String(args[0] ?? '1d20')))
            case 'storeGet':
              return JSON.stringify(this.store(id)[String(args[0])] ?? null)
            case 'storeSet':
              this.store(id)[String(args[0])] = args[1] ?? null
              this.persistStore(id)
              return undefined
            default:
              return JSON.stringify({ __error: `Unknown method ${method}` })
          }
        } catch (err) {
          return JSON.stringify({ __error: redact((err as Error).message ?? String(err)) })
        }
      }

      // Asynchronous calls.
      if (denied) {
        reject?.(denied)
        return undefined
      }
      this.asyncCall(method, args)
        .then((result) => resolve(result === undefined ? undefined : JSON.stringify(result)))
        .catch((err: unknown) => reject?.(redact((err as Error)?.message ?? String(err))))
      return undefined
    }
  }

  private async asyncCall(method: string, args: unknown[]): Promise<unknown> {
    const vault = vaultService.require()
    switch (method) {
      case 'post': {
        const [role, text, sessionPath] = args as [MessageRole, string, string | undefined]
        if (!sessionPath) throw new Error('No session is open.')
        if (!['player', 'dm', 'roll', 'system'].includes(role)) throw new Error(`Invalid role “${role}”.`)
        const body = String(text ?? '').slice(0, 50_000)
        const session = await postMessage(vault, sessionPath, { id: newMessageId(), role, text: body, swipes: [body], swipeIndex: 0, createdAt: new Date().toISOString() })
        send(getMainWindow(), 'session:updated', session)
        void vaultService.reindex(sessionPath)
        return undefined
      }
      case 'readNote': {
        const path = this.notePath(String(args[0] ?? ''))
        return (await vault.read(path)).content
      }
      case 'writeNote': {
        const path = this.notePath(String(args[0] ?? ''))
        const content = String(args[1] ?? '')
        if (content.length > 1_000_000) throw new Error('Note content is too large (1 MB max).')
        await vault.mutate(path, () => content)
        void vaultService.reindex(path)
        return undefined
      }
      case 'generateText': {
        if (!this.services) throw new Error('Text generation is unavailable.')
        const [prompt, opts] = args as [string, { system?: string; maxTokens?: number } | undefined]
        return this.services.generateText(String(prompt ?? ''), opts ?? {})
      }
      case 'generateImage': {
        if (!this.services) throw new Error('Image generation is unavailable.')
        const [prompt, opts, sessionPath] = args as [string, Record<string, unknown> | undefined, string | undefined]
        return this.services.generateImage(String(prompt ?? ''), sessionPath, opts ?? {})
      }
      case 'fetch': {
        const [url, opts] = args as [string, { method?: string; headers?: Record<string, string>; body?: string } | undefined]
        const u = new URL(String(url))
        if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only http(s) URLs can be fetched.')
        const res = await undiciFetch(u.href, {
          method: opts?.method ?? 'GET',
          headers: opts?.headers,
          body: opts?.body,
          signal: AbortSignal.timeout(20_000),
          dispatcher: getDispatcher({ proxy: '', allowSelfSigned: false })
        })
        const text = (await res.text()).slice(0, 2_000_000)
        return { status: res.status, ok: res.ok, text }
      }
      default:
        throw new Error(`Unknown method ${method}`)
    }
  }

  /** Extension note paths are relative to the root folder and must stay inside it. */
  private notePath(rel: string): VaultPath {
    const vault = vaultService.require()
    const clean = joinVaultPath(rel)
    const path = clean.toLowerCase().startsWith(`${vault.rootFolder.toLowerCase()}/`) ? clean : vault.rootPath(clean)
    if (!path.toLowerCase().endsWith('.md')) throw new Error('Extensions can only read and write .md notes.')
    if (!vault.isInRoot(path)) throw new Error('Extensions can only use notes inside the DND Tavern folder.')
    vault.resolve(path) // rejects traversal and .obsidian
    return path
  }

  private store(id: string): Record<string, unknown> {
    let s = this.stores.get(id)
    if (!s) {
      s = {}
      this.stores.set(id, s)
      void readJson(join(paths.userData, 'extension-data', `${id}.json`))
        .then((data) => {
          if (data && typeof data === 'object') Object.assign(s!, data as Record<string, unknown>, s)
        })
        .catch(() => {})
    }
    return s
  }

  /** Loads an extension's stored data before it runs (so storeGet sees saved values). */
  private async warmStore(id: string): Promise<void> {
    if (this.stores.has(id)) return
    const data = (await readJson(join(paths.userData, 'extension-data', `${id}.json`)).catch(() => undefined)) as Record<string, unknown> | undefined
    this.stores.set(id, data && typeof data === 'object' ? data : {})
  }

  /** The extension's stored data, for its UI panel. */
  async storeSnapshot(id: string): Promise<Record<string, unknown>> {
    await this.warmStore(id)
    return { ...(this.stores.get(id) ?? {}) }
  }

  private persistStore(id: string): void {
    clearTimeout(this.storeTimers.get(id))
    this.storeTimers.set(
      id,
      setTimeout(() => {
        void writeFileAtomic(join(paths.userData, 'extension-data', `${id}.json`), JSON.stringify(this.stores.get(id) ?? {}, null, 2)).catch(() => {})
      }, 300)
    )
  }

  // ─── Context snapshots ──────────────────────────────────────────────────

  async snapshot(id: string, sessionPath?: VaultPath): Promise<Record<string, unknown>> {
    const vault = vaultService.vault
    const base: Record<string, unknown> = { extensionId: id, sessionPath, session: null, character: null, campaign: null, sheet: null, settings: this.values(this.loaded.get(id)!.info.manifest) }
    if (!vault || !sessionPath) return base
    try {
      const session = await readSession(vault, sessionPath)
      base.session = { path: session.path, title: session.frontmatter.title, frontmatter: { ...session.frontmatter, swipes: undefined }, messages: session.messages.slice(-60).map((m) => ({ id: m.id, role: m.role, name: m.name, text: m.text, roll: m.roll })) }
      const charPath = session.frontmatter.characters[0] ? await resolveCharacterLink(vault, session.frontmatter.characters[0]) : null
      if (charPath) {
        const c = await readCharacter(vault, charPath)
        base.character = { path: c.path, ...c.card, dnd: undefined }
        base.sheet = c.card.dnd ?? null
      }
      base.campaign = (await readCampaign(vault, session.campaignPath)).campaign
    } catch {
      /* partial context is fine */
    }
    return base
  }

  // ─── Calls and hooks ────────────────────────────────────────────────────

  private reportError(id: string, what: string, err: unknown): void {
    const name = this.loaded.get(id)?.info.manifest.name ?? id
    const message = redact((err as Error)?.message ?? String(err))
    console.warn(`[ext:${id}] ${what} failed:`, message)
    const last = this.lastErrorToast.get(`${id}:${what}`) ?? 0
    if (Date.now() - last > 10_000) {
      this.lastErrorToast.set(`${id}:${what}`, Date.now())
      send(getMainWindow(), 'toast', { level: 'error', title: `${name}: ${what} failed`, detail: message, source: name })
    }
  }

  async runCommand(id: string, command: string, args: string, sessionPath?: VaultPath): Promise<void> {
    const entry = this.loaded.get(id)
    if (!entry?.sandbox) throw new Error(`The extension “${id}” isn’t enabled.`)
    await this.warmStore(id)
    if (!entry.sandbox.has(`commands.${command}`)) throw new Error(`${entry.info.manifest.name} has no command /${command}.`)
    try {
      await entry.sandbox.call(`commands.${command}`, [args], await this.snapshot(id, sessionPath), 120_000)
    } catch (err) {
      throw new Error(`${entry.info.manifest.name}: ${redact((err as Error).message)}`)
    }
  }

  private withHook(name: string): Loaded[] {
    return [...this.loaded.values()].filter((l) => l.sandbox && l.hooks.includes(name))
  }

  /** onPromptBuild(blocks, ctx) → blocks, chained through enabled extensions. */
  async applyPromptBuild(blocks: PromptBlock[], sessionPath?: VaultPath): Promise<PromptBlock[]> {
    let current = blocks
    for (const ext of this.withHook('onPromptBuild')) {
      const id = ext.info.manifest.id
      try {
        await this.warmStore(id)
        const out = await ext.sandbox!.call<PromptBlock[]>('hooks.onPromptBuild', [current], await this.snapshot(id, sessionPath), 8000)
        if (Array.isArray(out) && out.every((b) => b && typeof b.content === 'string' && typeof b.id === 'string')) {
          current = out.map((b) => ({ id: String(b.id), label: String(b.label ?? b.id), role: b.role === 'user' || b.role === 'assistant' ? b.role : 'system', content: b.content, tokens: Math.ceil(b.content.length / 4) }))
        } else if (out !== undefined) {
          throw new Error('onPromptBuild must return an array of blocks.')
        }
      } catch (err) {
        this.reportError(id, 'onPromptBuild', err)
      }
    }
    return current
  }

  async applyResponse(text: string, sessionPath?: VaultPath): Promise<string> {
    let current = text
    for (const ext of this.withHook('onResponse')) {
      const id = ext.info.manifest.id
      try {
        const out = await ext.sandbox!.call<string>('hooks.onResponse', [current], await this.snapshot(id, sessionPath), 8000)
        if (typeof out === 'string') current = out
      } catch (err) {
        this.reportError(id, 'onResponse', err)
      }
    }
    return current
  }

  /** Fire-and-forget notifications: onBeforeSend, onDiceRoll, onSessionStart. */
  notify(hook: 'onBeforeSend' | 'onDiceRoll' | 'onSessionStart', payload: unknown, sessionPath?: VaultPath): void {
    for (const ext of this.withHook(hook)) {
      const id = ext.info.manifest.id
      void (async () => {
        try {
          await this.warmStore(id)
          const args = hook === 'onSessionStart' ? [] : [payload]
          await ext.sandbox!.call(`hooks.${hook}`, args, await this.snapshot(id, sessionPath), 15_000)
        } catch (err) {
          this.reportError(id, hook, err)
        }
      })()
    }
  }

  diceRolled(result: RollResult, sessionPath: VaultPath): void {
    this.notify('onDiceRoll', result, sessionPath)
  }
}

export const extensionHost = new ExtensionHost()
