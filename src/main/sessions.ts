/**
 * Session notes: create, read and edit. Every edit is a read-modify-write on
 * the current file (Vault.mutate), so changes made in Obsidian meanwhile are
 * kept, and only the affected callout's text range is rewritten.
 */
import { randomUUID } from 'node:crypto'
import {
  appendMessage,
  newMessageId,
  parseSessionBody,
  removeMessage,
  replaceMessage,
  swipesForFrontmatter,
  truncateAfter
} from '@shared/callouts'
import { CAMPAIGN_FILE, SESSIONS_FOLDER } from '@shared/layout'
import { formatDate, joinVaultPath, noteName, toWikilink } from '@shared/names'
import type { CombatState, Message, Session, SessionFrontmatter, VaultPath } from '@shared/types'
import { AppError } from './errors'
import { parseNote, serializeNote, updateNote } from './vault/frontmatter'
import type { Vault } from './vault/vault'

function frontmatterOf(data: Record<string, unknown>, path: VaultPath): SessionFrontmatter {
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  return {
    type: 'session',
    id: str(data.id) || path,
    title: str(data.title) || noteName(path),
    campaign: str(data.campaign),
    characters: Array.isArray(data.characters) ? data.characters.filter((c): c is string => typeof c === 'string') : [],
    persona: str(data.persona) || undefined,
    created: str(data.created),
    updated: str(data.updated),
    summary: str(data.summary) || undefined,
    summary_upto: str(data.summary_upto) || undefined,
    recap: str(data.recap) || undefined,
    recap_upto: str(data.recap_upto) || undefined,
    recap_at: str(data.recap_at) || undefined,
    combat: data.combat && typeof data.combat === 'object' ? (data.combat as CombatState) : undefined,
    swipes: data.swipes && typeof data.swipes === 'object' ? (data.swipes as Record<string, string[]>) : undefined,
    tags: Array.isArray(data.tags) ? data.tags.filter((t): t is string => typeof t === 'string') : undefined
  }
}

export function parseSession(path: VaultPath, content: string, state: { mtimeMs: number; hash: string }): Session {
  const { data, body } = parseNote(content)
  const frontmatter = frontmatterOf(data, path)
  return {
    path,
    // <campaign folder>/Sessions/<file>.md
    campaignPath: path.split('/').slice(0, -2).join('/'),
    frontmatter,
    messages: parseSessionBody(body, frontmatter.swipes ?? {}).map((b) => b.message),
    mtimeMs: state.mtimeMs,
    hash: state.hash
  }
}

export async function readSession(vault: Vault, path: VaultPath): Promise<Session> {
  const file = await vault.readIfExists(path)
  if (!file) throw new AppError('NOT_FOUND', `The session note “${path}” no longer exists.`)
  return parseSession(path, file.content, file.state)
}

export interface NewSession {
  campaignPath: VaultPath
  characterPath?: VaultPath
  characterName?: string
  title?: string
  persona?: string
  dateFormat: string
  firstMessage?: string
}

export async function createSession(vault: Vault, opts: NewSession): Promise<Session> {
  const sessionsDir = joinVaultPath(opts.campaignPath, SESSIONS_FOLDER)
  await vault.mkdir(sessionsDir)
  const existing = (await vault.list(sessionsDir)).filter((e) => !e.isDir && e.name.endsWith('.md')).length
  const number = String(existing + 1).padStart(2, '0')
  const title = opts.title?.trim() || `Session ${number}`
  const date = formatDate(new Date(), opts.dateFormat || 'YYYY-MM-DD')
  const path = await vault.uniquePath(sessionsDir, `${date} ${title}`.replace(/[\\/:*?"<>|#^[\]]/g, ' ').trim(), '.md')
  const now = new Date().toISOString()

  const frontmatter: Record<string, unknown> = {
    type: 'session',
    id: `s-${randomUUID().slice(0, 8)}`,
    title,
    campaign: toWikilink(joinVaultPath(opts.campaignPath, CAMPAIGN_FILE), { full: true, alias: noteName(opts.campaignPath) }),
    characters: opts.characterPath ? [toWikilink(opts.characterPath, { full: true, alias: opts.characterName })] : [],
    persona: opts.persona || undefined,
    created: now,
    updated: now,
    tags: ['dnd-session']
  }
  let body = ''
  if (opts.firstMessage?.trim()) {
    body = appendMessage('', {
      id: newMessageId(),
      role: 'dm',
      text: opts.firstMessage.trim(),
      swipes: [opts.firstMessage.trim()],
      swipeIndex: 0,
      createdAt: now
    })
  }
  await vault.write(path, serializeNote(frontmatter, body ? `\n${body}` : '\n'), { baseHash: null })
  return readSession(vault, path)
}

/**
 * Read-modify-write of a session's messages and frontmatter. `edit` returns
 * the new body, the swipe map to read it with, and any other frontmatter
 * changes; the stored swipe map is then re-derived from the result, so
 * entries for deleted messages disappear automatically.
 */
async function editSession(
  vault: Vault,
  path: VaultPath,
  edit: (body: string, fm: SessionFrontmatter) => { body: string; swipes?: Record<string, string[]>; patch?: Record<string, unknown> }
): Promise<Session> {
  let notFound = false
  const result = await vault.mutate(path, (cur) => {
    if (cur === null) {
      notFound = true
      return null
    }
    const { data, body } = parseNote(cur)
    const fm = frontmatterOf(data, path)
    const next = edit(body, fm)
    const messages = parseSessionBody(next.body, next.swipes ?? fm.swipes ?? {}).map((b) => b.message)
    return updateNote(cur, { ...next.patch, swipes: swipesForFrontmatter(messages), updated: new Date().toISOString() }, next.body)
  })
  if (notFound) throw new AppError('NOT_FOUND', `The session note “${path}” no longer exists.`)
  if (!result) return readSession(vault, path)
  return parseSession(path, result.content, result.state)
}

function currentMessages(body: string, fm: SessionFrontmatter): Message[] {
  return parseSessionBody(body, fm.swipes ?? {}).map((b) => b.message)
}

export function postMessage(vault: Vault, path: VaultPath, message: Message): Promise<Session> {
  return editSession(vault, path, (body, fm) => ({
    body: appendMessage(body, message),
    swipes: { ...(fm.swipes ?? {}), [message.id]: message.swipes }
  }))
}

/** Replaces one message using `fn` (which receives the current version from disk). */
export function updateMessage(vault: Vault, path: VaultPath, id: string, fn: (m: Message) => Message): Promise<Session> {
  return editSession(vault, path, (body, fm) => {
    const current = currentMessages(body, fm).find((m) => m.id === id)
    if (!current) throw new AppError('NOT_FOUND', 'That message is no longer in the session note.')
    const next = fn(current)
    return { body: replaceMessage(body, id, next), swipes: { ...(fm.swipes ?? {}), [next.id]: next.swipes } }
  })
}

export function deleteMessage(vault: Vault, path: VaultPath, id: string): Promise<Session> {
  return editSession(vault, path, (body) => ({ body: removeMessage(body, id) }))
}

export function updateFrontmatter(vault: Vault, path: VaultPath, patch: Record<string, unknown>): Promise<Session> {
  return editSession(vault, path, (body) => ({ body, patch }))
}

/** New session note containing everything up to and including `messageId`. */
export async function forkSession(vault: Vault, path: VaultPath, messageId: string): Promise<Session> {
  const file = await vault.readIfExists(path)
  if (!file) throw new AppError('NOT_FOUND', `The session note “${path}” no longer exists.`)
  const { data, body } = parseNote(file.content)
  const fm = frontmatterOf(data, path)
  const kept = truncateAfter(body, messageId)
  const keptIds = new Set(parseSessionBody(kept).map((b) => b.message.id))
  const swipes = Object.fromEntries(Object.entries(fm.swipes ?? {}).filter(([id]) => keptIds.has(id)))
  const dir = path.split('/').slice(0, -1).join('/')
  const title = `${fm.title} (fork)`
  const newPath = await vault.uniquePath(dir, `${noteName(path)} (fork)`, '.md')
  const now = new Date().toISOString()
  const content = serializeNote(
    {
      ...data,
      id: `s-${randomUUID().slice(0, 8)}`,
      title,
      created: now,
      updated: now,
      forked_from: toWikilink(path, { full: true, alias: fm.title }),
      swipes: Object.keys(swipes).length ? swipes : undefined,
      summary: undefined,
      summary_upto: undefined,
      recap: undefined,
      recap_upto: undefined,
      recap_at: undefined
    },
    kept.startsWith('\n') ? kept : `\n${kept}`
  )
  await vault.write(newPath, content, { baseHash: null })
  return readSession(vault, newPath)
}
