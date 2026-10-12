/**
 * The multiplayer host. While hosting, a small HTTP + WebSocket server serves
 * the player page and relays the hosted session: players see the story as it
 * is written, claim a character, act as it and roll its checks (rolls happen
 * here, on the host). Players never get the vault, settings, prompts or hidden
 * notes. Bound to 127.0.0.1 ("this PC only") or to the network.
 */
import { app } from 'electron'
import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import { extname, join, normalize, sep } from 'node:path'
import { WebSocketServer, type WebSocket } from 'ws'
import { newMessageId } from '@shared/callouts'
import { checkBonus, resolveTarget, rollCheck, skillsFor, ABILITIES } from '@shared/checks'
import { DiceError, formatRoll, roll } from '@shared/dice'
import { editionOf, SAVES_35 } from '@shared/editions'
import { FOLDERS, IMAGES_FOLDER, IMAGE_EXTENSIONS } from '@shared/layout'
import { joinVaultPath, toWikilink } from '@shared/names'
import { findChecks, playModeOf } from '@shared/play'
import {
  everyoneActed,
  makeJoinCode,
  playerSafe,
  sameCode,
  TABLE_DEFAULT_PORT,
  type AutoRespond,
  type ClientMessage,
  type ServerMessage,
  type TableCharacter,
  type TablePlayer,
  type TableState,
  type TableStatus
} from '@shared/table'
import type { CharacterNote, Message, Session, VaultPath } from '@shared/types'
import { chatService } from '../chat'
import { AppError, toErrorInfo } from '../errors'
import { outbound, send } from '../ipc'
import { readCampaign, readCharacter, resolveCharacterLink } from '../library'
import { postMessage, readSession, updateFrontmatter } from '../sessions'
import { vaultService } from '../vault/service'
import { openExternalSafe } from '../security'
import { startFunnel, stopFunnel, stopFunnelSync } from './funnel'
import { getMainWindow } from '../window'

interface Player extends TablePlayer {
  token: string
  sockets: Set<WebSocket>
  lastAction: number
  view: 'player' | 'screen'
}

const MIME: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp'
}

const PLAYER_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"

function lanAddresses(): string[] {
  const out: string[] = []
  for (const list of Object.values(networkInterfaces())) for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address)
  return out
}

function clean(text: unknown, max: number): string {
  return typeof text === 'string' ? text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max) : ''
}

class TableHost {
  private server: Server | null = null
  private wss: WebSocketServer | null = null
  private code = ''
  /** Key in media URLs, so images are only served to joined players. */
  private mediaKey = ''
  private scope: 'local' | 'network' = 'local'
  private port = TABLE_DEFAULT_PORT
  private players = new Map<string, Player>()
  private banned = new Set<string>()
  private sessionPath: VaultPath | null = null
  private autoRespond: AutoRespond = 'each'
  private pendingRespond = false
  private stream: { requestId: string; text: string; speaker: 'dm' | 'player'; speakerName?: string; at: number } | null = null
  private broadcastTimer: ReturnType<typeof setTimeout> | undefined
  private busy = false
  /** Tailscale Funnel address while the table is shared online. */
  private funnel = ''
  private readonly onEvent = (channel: string, payload: unknown): void => this.event(channel, payload)

  get hosting(): boolean {
    return !!this.server
  }

  status(): TableStatus {
    const query = `/?code=${this.code}`
    const urls = !this.server ? [] : this.scope === 'local' ? [`http://127.0.0.1:${this.port}${query}`] : lanAddresses().map((ip) => `http://${ip}:${this.port}${query}`)
    return {
      hosting: !!this.server,
      scope: this.scope,
      port: this.port,
      code: this.code,
      urls,
      ...(this.server && this.funnel ? { publicUrl: `${this.funnel}${query}` } : {}),
      sessionPath: this.sessionPath,
      autoRespond: this.autoRespond,
      players: [...this.players.values()].map(({ id, name, characterPath, connected }) => ({ id, name, characterPath, connected }))
    }
  }

  private notifyHost(): void {
    send(getMainWindow(), 'table:changed', this.status())
  }

  async start(opts: { scope: 'local' | 'network'; port: number; sessionPath: VaultPath | null; funnel?: boolean }): Promise<TableStatus> {
    if (this.server) await this.stop()
    this.scope = opts.scope
    this.port = opts.port
    this.code = makeJoinCode(randomBytes(8))
    this.mediaKey = randomBytes(18).toString('base64url')
    this.sessionPath = opts.sessionPath
    const server = createServer((req, res) => void this.http(req, res).catch(() => this.reply(res, 500, 'Server error')))
    const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 })
    server.on('upgrade', (req, socket, head) => {
      if (new URL(req.url ?? '/', 'http://x').pathname !== '/ws') return socket.destroy()
      wss.handleUpgrade(req, socket, head, (ws) => this.connection(ws))
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', (err: NodeJS.ErrnoException) =>
        reject(err.code === 'EADDRINUSE' ? new AppError('PORT_IN_USE', `Port ${opts.port} is already in use. Pick another port.`) : err)
      )
      server.listen(opts.port, opts.scope === 'local' ? '127.0.0.1' : '0.0.0.0', () => resolve())
    })
    this.server = server
    this.wss = wss
    outbound.on('event', this.onEvent)
    if (opts.funnel) {
      try {
        this.funnel = await startFunnel(opts.port)
      } catch (err) {
        await this.stop()
        // Funnel has to be allowed once in the Tailscale admin console: open the page for it.
        const link = (err as AppError).detail
        if ((err as AppError).code === 'FUNNEL_NOT_ALLOWED' && link) void openExternalSafe(link).catch(() => {})
        throw err
      }
    }
    this.notifyHost()
    return this.status()
  }

  async stop(): Promise<TableStatus> {
    outbound.off('event', this.onEvent)
    for (const p of this.players.values()) for (const ws of p.sockets) this.sendTo(ws, { type: 'kicked', reason: 'The host stopped the game.' })
    for (const p of this.players.values()) for (const ws of p.sockets) ws.close()
    this.players.clear()
    this.banned.clear()
    this.wss?.close()
    await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()))
    this.server = null
    this.wss = null
    this.code = ''
    if (this.funnel) {
      this.funnel = ''
      await stopFunnel().catch(() => {})
    }
    this.notifyHost()
    return this.status()
  }

  /** App quit: turn Funnel off right away (no time for async work). */
  stopFunnelNow(): void {
    if (!this.funnel) return
    this.funnel = ''
    stopFunnelSync()
  }

  setSession(path: VaultPath | null): void {
    if (path === this.sessionPath) return
    this.sessionPath = path
    this.stream = null
    this.notifyHost()
    this.scheduleBroadcast()
  }

  setAutoRespond(mode: AutoRespond): TableStatus {
    this.autoRespond = mode
    this.notifyHost()
    return this.status()
  }

  kick(playerId: string): TableStatus {
    const p = this.players.get(playerId)
    if (p) {
      for (const ws of p.sockets) {
        this.sendTo(ws, { type: 'kicked', reason: 'The host removed you from the table.' })
        ws.close()
      }
      this.banned.add(p.token)
      this.players.delete(playerId)
      this.scheduleBroadcast()
      this.notifyHost()
    }
    return this.status()
  }

  /** Local URL for the player screen window. */
  screenUrl(): string {
    if (!this.server) throw new AppError('NOT_HOSTING', 'Start hosting first.')
    const dev = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined
    const params = `code=${encodeURIComponent(this.code)}&view=screen`
    return dev ? `${dev}/player.html?${params}&ws=${encodeURIComponent(`ws://127.0.0.1:${this.port}/ws`)}` : `http://127.0.0.1:${this.port}/?${params}`
  }

  // ── HTTP: the player page, its assets, and session images ─────────────────

  private reply(res: ServerResponse, status: number, text: string): void {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' })
    res.end(text)
  }

  private async http(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://x')
    if (req.method !== 'GET') return this.reply(res, 405, 'Method not allowed')
    const headers = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' }
    const rendererDir = join(__dirname, '../renderer')

    if (url.pathname === '/' || url.pathname === '/index.html') {
      const dev = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined
      if (dev) {
        // Dev: the page comes from the Vite server and connects back here.
        const ws = `ws://${req.headers.host ?? `127.0.0.1:${this.port}`}/ws`
        res.writeHead(302, { Location: `${dev}/player.html${url.search}${url.search ? '&' : '?'}ws=${encodeURIComponent(ws)}` })
        return void res.end()
      }
      const html = await fs.readFile(join(rendererDir, 'player.html')).catch(() => null)
      if (!html) return this.reply(res, 500, 'The player page is missing from this build.')
      res.writeHead(200, { ...headers, 'Content-Type': MIME['.html']!, 'Content-Security-Policy': PLAYER_CSP, 'Cache-Control': 'no-cache' })
      return void res.end(html)
    }

    if (url.pathname.startsWith('/assets/')) {
      const file = normalize(join(rendererDir, decodeURIComponent(url.pathname)))
      if (!file.startsWith(join(rendererDir, 'assets') + sep)) return this.reply(res, 404, 'Not found')
      const data = await fs.readFile(file).catch(() => null)
      if (!data) return this.reply(res, 404, 'Not found')
      res.writeHead(200, { ...headers, 'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable' })
      return void res.end(data)
    }

    if (url.pathname === '/media') {
      if (url.searchParams.get('k') !== this.mediaKey) return this.reply(res, 403, 'Forbidden')
      const path = url.searchParams.get('path') ?? ''
      const vault = vaultService.vault
      const ext = path.split('.').pop()?.toLowerCase() ?? ''
      const session = this.sessionPath ? await readSession(vault!, this.sessionPath).catch(() => null) : null
      // Only the hosted campaign's images and character avatars.
      const allowed = !!vault && !!session && IMAGE_EXTENSIONS.includes(ext) && !path.includes('..') &&
        (path.startsWith(`${joinVaultPath(session.campaignPath, IMAGES_FOLDER)}/`) || path.startsWith(`${vault.rootPath(FOLDERS.avatars)}/`))
      if (!allowed) return this.reply(res, 404, 'Not found')
      const data = await vault!.readBinary(path).catch(() => null)
      if (!data) return this.reply(res, 404, 'Not found')
      res.writeHead(200, { ...headers, 'Content-Type': MIME[`.${ext}`] ?? 'application/octet-stream', 'Cache-Control': 'private, max-age=3600' })
      return void res.end(data)
    }

    return this.reply(res, 404, 'Not found')
  }

  // ── WebSocket ─────────────────────────────────────────────────────────────

  private sendTo(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
  }

  private broadcast(msg: ServerMessage): void {
    for (const p of this.players.values()) for (const ws of p.sockets) this.sendTo(ws, msg)
  }

  private connection(ws: WebSocket): void {
    let player: Player | null = null
    const fail = (message: string): void => this.sendTo(ws, { type: 'error', message })
    // Unauthenticated sockets get a few seconds to say hello.
    const helloTimer = setTimeout(() => !player && ws.close(), 10_000)

    ws.on('message', (raw) => {
      let msg: ClientMessage
      try {
        msg = JSON.parse(String(raw)) as ClientMessage
      } catch {
        return fail('Bad message.')
      }
      if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return fail('Bad message.')
      if (msg.type === 'ping') return this.sendTo(ws, { type: 'pong' })
      if (msg.type === 'hello') {
        if (player) return
        if (typeof msg.code !== 'string' || !sameCode(msg.code, this.code)) {
          fail('That join code is not right.')
          return void ws.close()
        }
        if (msg.token && this.banned.has(msg.token)) {
          this.sendTo(ws, { type: 'kicked', reason: 'The host removed you from the table.' })
          return void ws.close()
        }
        clearTimeout(helloTimer)
        const existing = msg.token ? [...this.players.values()].find((p) => p.token === msg.token) : undefined
        player = existing ?? {
          id: randomBytes(6).toString('hex'),
          token: randomBytes(24).toString('base64url'),
          name: clean(msg.name, 40) || 'Player',
          connected: true,
          sockets: new Set(),
          lastAction: 0,
          view: msg.view === 'screen' ? 'screen' : 'player'
        }
        if (!existing) this.players.set(player.id, player)
        player.sockets.add(ws)
        player.connected = true
        const me = player
        void this.state()
          .then((state) => this.sendTo(ws, { type: 'welcome', token: me.token, you: { id: me.id, name: me.name, characterPath: me.characterPath, connected: true }, state }))
          .catch((err) => fail(toErrorInfo(err).message))
        if (!existing && player.view === 'player') send(getMainWindow(), 'toast', { level: 'info', title: `${player.name} joined the table` })
        this.scheduleBroadcast()
        this.notifyHost()
        return
      }
      if (!player) return fail('Say hello first.')
      if (player.view === 'screen') return fail('The player screen is read-only.')
      void this.action(player, msg).catch((err) => fail(toErrorInfo(err).message))
    })

    ws.on('close', () => {
      clearTimeout(helloTimer)
      if (!player) return
      player.sockets.delete(ws)
      if (player.sockets.size === 0) {
        player.connected = false
        this.scheduleBroadcast()
        this.notifyHost()
      }
    })
    ws.on('error', () => ws.close())
  }

  private async action(player: Player, msg: ClientMessage): Promise<void> {
    if (!this.sessionPath) throw new AppError('NO_SESSION', 'The host has no session open.')
    const vault = vaultService.require()
    const now = Date.now()
    // Light rate limit on story actions (claiming a character doesn't count).
    if (msg.type !== 'claim') {
      if (now - player.lastAction < 800) throw new AppError('SLOW_DOWN', 'One thing at a time.')
      player.lastAction = now
    }

    if (msg.type === 'claim') {
      if (msg.characterPath === null) {
        player.characterPath = undefined
      } else {
        const index = vaultService.getIndex()
        const c = index?.characters.find((x) => x.path === msg.characterPath)
        if (!c) throw new AppError('NOT_FOUND', 'That character is not available.')
        if ([...this.players.values()].some((p) => p !== player && p.characterPath === c.path)) throw new AppError('TAKEN', `${c.displayName} is already taken.`)
        player.characterPath = c.path
        // Make sure the character is in the session's party.
        const session = await readSession(vault, this.sessionPath)
        const paths = await Promise.all(session.frontmatter.characters.map((l) => resolveCharacterLink(vault, l)))
        if (!paths.includes(c.path)) {
          const updated = await updateFrontmatter(vault, this.sessionPath, { characters: [...session.frontmatter.characters, toWikilink(c.path, { full: true, alias: c.displayName })] })
          this.publish(updated)
        }
      }
      this.scheduleBroadcast()
      this.notifyHost()
      return
    }

    const session = await readSession(vault, this.sessionPath)
    const mode = playModeOf(session.frontmatter)
    const character = player.characterPath ? await readCharacter(vault, player.characterPath).catch(() => null) : null
    const who = character?.card.name ?? player.name

    if (msg.type === 'say') {
      if (mode === 'ai-only') throw new AppError('WATCH_ONLY', 'This table is AI only: you’re watching the story.')
      if (!character) throw new AppError('NO_CHARACTER', 'Pick a character first.')
      const text = clean(msg.text, 4000)
      if (!text) return
      await this.post({ id: newMessageId(), role: 'player', name: who, text, swipes: [text], swipeIndex: 0, createdAt: new Date().toISOString() })
      await this.maybeRespond()
      return
    }

    if (msg.type === 'check') {
      if (!character) throw new AppError('NO_CHARACTER', 'Pick a character first.')
      const sheet = character.card.dnd ?? null
      const edition = editionOf(sheet)
      const target = resolveTarget(clean(msg.target, 60), false, edition) ?? resolveTarget(clean(msg.target, 60), true, edition)
      if (!target) throw new AppError('BAD_CHECK', `“${msg.target}” isn’t a skill or save.`)
      const dc = typeof msg.dc === 'number' && msg.dc > 0 && msg.dc < 100 ? Math.round(msg.dc) : undefined
      const result = rollCheck(sheet, target, dc)
      await this.post({ id: newMessageId(), role: 'roll', name: `${who} · ${target.name}`, text: formatRoll(result), roll: result, swipes: [], swipeIndex: 0, createdAt: new Date().toISOString() })
      // A roll the DM asked for gets narrated.
      const lastDm = [...session.messages].reverse().find((m) => m.role === 'dm')
      if (lastDm && findChecks(lastDm.text).length) await this.maybeRespond(true)
      return
    }

    if (msg.type === 'roll') {
      const expr = clean(msg.expr, 80)
      let result
      try {
        result = roll(expr)
      } catch (err) {
        throw new AppError('BAD_ROLL', err instanceof DiceError ? err.message : 'That isn’t a dice expression.')
      }
      await this.post({ id: newMessageId(), role: 'roll', name: who, text: formatRoll(result), roll: result, swipes: [], swipeIndex: 0, createdAt: new Date().toISOString() })
    }
  }

  private publish(session: Session): void {
    send(getMainWindow(), 'session:updated', session)
    void vaultService.reindex(session.path)
  }

  private async post(message: Message): Promise<void> {
    const vault = vaultService.require()
    this.publish(await postMessage(vault, this.sessionPath!, message))
  }

  /** Lets the AI DM answer, depending on the table's setting. */
  private async maybeRespond(afterRoll = false): Promise<void> {
    if (!this.sessionPath) return
    const vault = vaultService.require()
    const session = await readSession(vault, this.sessionPath)
    if (playModeOf(session.frontmatter) !== 'ai-dm' || this.autoRespond === 'manual') return
    if (this.autoRespond === 'all' && !afterRoll) {
      const names = new Map<string, string>()
      for (const p of this.players.values()) {
        if (!p.characterPath) continue
        const c = await readCharacter(vault, p.characterPath).catch(() => null)
        if (c) names.set(p.characterPath, c.card.name)
      }
      if (!everyoneActed(session.messages, [...this.players.values()], (path) => names.get(path))) return
    }
    if (this.responding || chatService.isBusy(this.sessionPath)) {
      this.pendingRespond = true
      return
    }
    this.responding = true
    try {
      // AI companions act first, one after another, then the DM answers everyone.
      for (const as of session.frontmatter.companions ?? []) {
        if (!(await chatService.replyAndWait(this.sessionPath, 'player', as))) return
      }
      await chatService.replyAndWait(this.sessionPath, 'dm')
    } finally {
      this.responding = false
    }
    if (this.pendingRespond) {
      this.pendingRespond = false
      void this.maybeRespond().catch(() => {})
    }
  }

  /** True while a party turn (companions, then the DM) is under way. */
  private responding = false

  // ── State for players ─────────────────────────────────────────────────────

  private mediaUrl(path: string): string {
    return `/media?k=${encodeURIComponent(this.mediaKey)}&path=${encodeURIComponent(path)}`
  }

  private character(note: CharacterNote): TableCharacter {
    const sheet = note.card.dnd
    const edition = editionOf(sheet)
    const avatar = note.card.avatar ? (note.card.avatar.includes('/') ? note.card.avatar : vaultService.require().rootPath(FOLDERS.avatars, note.card.avatar)) : undefined
    const checks: TableCharacter['checks'] = []
    if (sheet) {
      for (const s of skillsFor(edition)) {
        const t = resolveTarget(s.key, false, edition)
        if (t) checks.push({ target: s.key, label: s.name, bonus: checkBonus(sheet, t).bonus, kind: 'skill' })
      }
      const saves = edition === '3.5e' ? SAVES_35.map((s) => ({ raw: s.name.toLowerCase(), label: s.name })) : ABILITIES.map((a) => ({ raw: `${a.key} save`, label: `${a.name} save` }))
      for (const s of saves) {
        const t = resolveTarget(s.raw, false, edition)
        if (t) checks.push({ target: s.raw, label: s.label, bonus: checkBonus(sheet, t).bonus, kind: 'save' })
      }
    }
    return {
      path: note.path,
      name: note.card.name,
      ...(avatar ? { avatarUrl: this.mediaUrl(avatar) } : {}),
      race: sheet?.race ?? '',
      class: sheet?.class ?? '',
      level: sheet?.level ?? 0,
      hp: sheet?.hp ?? 0,
      max_hp: sheet?.max_hp ?? 0,
      temp_hp: sheet?.temp_hp ?? 0,
      ac: sheet?.ac ?? 0,
      conditions: sheet?.conditions ?? [],
      edition,
      checks,
      claimedBy: [...this.players.values()].find((p) => p.characterPath === note.path)?.id
    }
  }

  private async state(): Promise<TableState> {
    const players = [...this.players.values()].filter((p) => p.view === 'player').map(({ id, name, characterPath, connected }) => ({ id, name, characterPath, connected }))
    const vault = vaultService.vault
    const empty: TableState = { sessionTitle: null, campaignName: null, mode: 'ai-dm', messages: [], party: [], available: [], players, busy: false }
    if (!vault || !this.sessionPath) return empty
    const session = await readSession(vault, this.sessionPath).catch(() => null)
    if (!session) return empty
    const { campaign } = await readCampaign(vault, session.campaignPath).catch(() => ({ campaign: null }))
    const paths = (await Promise.all(session.frontmatter.characters.map((l) => resolveCharacterLink(vault, l).catch(() => null)))).filter((p): p is string => !!p)
    const notes = (await Promise.all(paths.map((p) => readCharacter(vault, p).catch(() => null)))).filter((n): n is CharacterNote => !!n)
    const index = vaultService.getIndex()
    const claimed = new Set([...this.players.values()].map((p) => p.characterPath).filter(Boolean))
    return {
      sessionTitle: session.frontmatter.title,
      campaignName: campaign?.name ?? null,
      mode: playModeOf(session.frontmatter),
      messages: playerSafe(session.messages.slice(-200), (file) => this.mediaUrl(joinVaultPath(session.campaignPath, IMAGES_FOLDER, file))),
      party: notes.map((n) => this.character(n)),
      available: (index?.characters ?? []).filter((c) => !claimed.has(c.path)).map((c) => ({ path: c.path, name: c.displayName })),
      players,
      busy: this.busy
    }
  }

  private scheduleBroadcast(): void {
    clearTimeout(this.broadcastTimer)
    this.broadcastTimer = setTimeout(() => {
      if (!this.server) return
      void this.state()
        .then((state) => this.broadcast({ type: 'state', state }))
        .catch(() => {})
    }, 120)
  }

  // ── Events from the app ───────────────────────────────────────────────────

  private event(channel: string, payload: unknown): void {
    const p = payload as Record<string, unknown>
    switch (channel) {
      case 'session:updated':
        if (p.path === this.sessionPath) this.scheduleBroadcast()
        break
      case 'chat:started':
        if (p.sessionPath === this.sessionPath) {
          this.busy = true
          this.stream = { requestId: String(p.requestId), text: '', speaker: p.speaker === 'player' ? 'player' : 'dm', speakerName: p.speakerName as string | undefined, at: 0 }
          this.scheduleBroadcast()
        }
        break
      case 'chat:token':
        if (this.stream && p.requestId === this.stream.requestId) {
          this.stream.text += String(p.delta ?? '')
          const now = Date.now()
          if (now - this.stream.at > 80) {
            this.stream.at = now
            const visible = this.stream.text.replace(/<(state|stats)>[\s\S]*?(?:<\/\1>|$)/gi, '')
            this.broadcast({ type: 'stream', text: visible, speaker: this.stream.speaker, speakerName: this.stream.speakerName })
          }
        }
        break
      case 'chat:done':
      case 'chat:error':
        if (this.stream && p.requestId === this.stream.requestId) {
          this.stream = null
          this.busy = false
          this.broadcast({ type: 'stream-end' })
          this.scheduleBroadcast()
          // A party turn picks up anything that arrived meanwhile when it ends.
          if (this.pendingRespond && !this.responding) {
            this.pendingRespond = false
            void this.maybeRespond().catch(() => {})
          }
        }
        break
      case 'vault:changed':
      case 'vault:index':
        this.scheduleBroadcast()
        break
    }
  }
}

export const tableHost = new TableHost()
