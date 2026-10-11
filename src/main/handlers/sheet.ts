import { z } from 'zod'
import { newMessageId } from '@shared/callouts'
import { cardToFrontmatter, defaultSheet, normalizeCard } from '@shared/notes'
import { applyStateChanges, describeChange, normalizeStateChange, undoStateChanges } from '@shared/sheet'
import type { CharacterNote, DndSheet, StateChange, VaultPath } from '@shared/types'
import { chatService } from '../chat'
import { AppError } from '../errors'
import { handle, send } from '../ipc'
import { readCharacter, resolveCharacterLink } from '../library'
import { postMessage, readSession, updateMessage } from '../sessions'
import { parseNote, updateNote } from '../vault/frontmatter'
import { vaultService } from '../vault/service'
import type { Vault } from '../vault/vault'
import { getMainWindow } from '../window'

/**
 * Applies `fn` to the sheet in the latest version of the note on disk, so
 * edits from Obsidian made meanwhile are kept (field-level merge).
 */
export async function mutateSheet(vault: Vault, path: VaultPath, fn: (sheet: DndSheet | undefined) => DndSheet | null): Promise<CharacterNote> {
  let missing = false
  await vault.mutate(path, (cur) => {
    if (cur === null) {
      missing = true
      return null
    }
    const { data } = parseNote(cur)
    const card = normalizeCard(data, '')
    const next = fn(card.dnd)
    return updateNote(cur, { dnd: next === null ? undefined : cardToFrontmatter({ ...card, dnd: next }).dnd })
  })
  if (missing) throw new AppError('NOT_FOUND', 'The character note no longer exists.')
  const note = await readCharacter(vault, path)
  void vaultService.reindex(path)
  return note
}

async function sessionCharacter(vault: Vault, sessionPath: VaultPath): Promise<VaultPath | null> {
  const session = await readSession(vault, sessionPath)
  const link = session.frontmatter.characters[0]
  return link ? resolveCharacterLink(vault, link) : null
}

function publish(session: Awaited<ReturnType<typeof readSession>>): void {
  send(getMainWindow(), 'session:updated', session)
  void vaultService.reindex(session.path)
}

export function registerSheetHandlers(): void {
  handle(
    'characters:updateSheet',
    (_e, path, patch) =>
      mutateSheet(vaultService.require(), path, (sheet) => (patch === null ? null : { ...(sheet ?? defaultSheet()), ...patch })),
    z.tuple([z.string().min(1), z.record(z.string(), z.unknown()).nullable()]) as unknown as z.ZodType<[string, Partial<DndSheet> | null]>
  )

  handle(
    'sessions:undoState',
    async (_e, sessionPath, messageId) => {
      const vault = vaultService.require()
      const session = await readSession(vault, sessionPath)
      const msg = session.messages.find((m) => m.id === messageId)
      if (!msg?.stateChanges?.length) throw new AppError('NOTHING_TO_UNDO', 'That message has no sheet changes to undo.')
      if (msg.text.endsWith('(undone)')) throw new AppError('ALREADY_UNDONE', 'Those changes were already undone.')
      const characterPath = await sessionCharacter(vault, sessionPath)
      if (!characterPath) throw new AppError('NO_CHARACTER', 'This session has no character sheet.')
      await mutateSheet(vault, characterPath, (sheet) => undoStateChanges(sheet ?? defaultSheet(), msg.stateChanges!))
      const updated = await updateMessage(vault, sessionPath, messageId, (m) => {
        const text = `~~${m.text}~~ (undone)`
        return { ...m, text, swipes: [text], swipeIndex: 0 }
      })
      publish(updated)
      return updated
    },
    z.tuple([z.string().min(1), z.string().min(1)])
  )

  // Auto-state: the model's hidden <state>{…}</state> blocks update the sheet.
  chatService.onStateChanges = (sessionPath, _messageId, raw) => {
    void (async () => {
      const vault = vaultService.require()
      const characterPath = await sessionCharacter(vault, sessionPath)
      if (!characterPath) return
      const changes: StateChange[] = raw.map(normalizeStateChange).filter((c) => Object.keys(c).length)
      if (!changes.length) return
      let applied: StateChange[] = []
      const note = await mutateSheet(vault, characterPath, (sheet) => {
        if (!sheet) return sheet ?? null
        const r = applyStateChanges(sheet, changes)
        applied = r.applied
        return r.sheet
      })
      if (!applied.length || !note.card.dnd) return
      const text = `${note.card.name}: ${applied.map(describeChange).join('; ')} (HP ${note.card.dnd.hp}/${note.card.dnd.max_hp})`
      const session = await postMessage(vault, sessionPath, {
        id: newMessageId(),
        role: 'system',
        text,
        swipes: [text],
        swipeIndex: 0,
        createdAt: new Date().toISOString(),
        hidden: true,
        stateChanges: applied
      })
      publish(session)
    })().catch((err) => console.warn('[sheet] auto-state failed:', err))
  }
}
