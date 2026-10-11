import { useCallback, useEffect, useMemo } from 'react'
import { create } from 'zustand'
import type { CharacterNote, DndSheet } from '@shared/types'
import { invoke, on } from '@/lib/ipc'
import { useChat } from '@/stores/chat'
import { toast } from '@/stores/toasts'
import { useVault } from '@/stores/vault'

/** Loaded character notes, shared by the sheet, combat tracker and dice. */
const useNotes = create<{ notes: Record<string, CharacterNote> }>(() => ({ notes: {} }))

/** The character that "plays": the open session's character, else the one selected in the sidebar. */
export function useActiveCharacterPath(): string | null {
  const link = useChat((s) => s.session?.frontmatter.characters[0] ?? null)
  const hasSession = useChat((s) => !!s.session)
  const selected = useVault((s) => s.selectedCharacter)
  const index = useVault((s) => s.index)
  return useMemo(() => {
    if (hasSession) {
      if (!link || !index) return null
      const target = link.replace(/^\[\[|\]\]$/g, '').split('|')[0]!.replace(/\.md$/i, '').toLowerCase()
      const hit = index.characters.concat(index.npcs).find((c) => c.path.replace(/\.md$/i, '').toLowerCase() === target || c.name.toLowerCase() === target)
      return hit?.path ?? null
    }
    return selected
  }, [hasSession, link, index, selected])
}

export function useCharacterNote(path: string | null): {
  note: CharacterNote | null
  updateSheet: (patch: Partial<DndSheet> | null) => Promise<CharacterNote | null>
} {
  const note = useNotes((s) => (path ? (s.notes[path] ?? null) : null))

  const load = useCallback(() => {
    if (!path) return
    invoke('characters:get', path)
      .then((n) => useNotes.setState((s) => ({ notes: { ...s.notes, [path]: n } })))
      .catch(() => {})
  }, [path])

  useEffect(load, [load])
  useEffect(() => {
    if (!path) return
    return on('vault:changed', (e) => e.path === path && e.event !== 'unlink' && load())
  }, [path, load])

  const updateSheet = useCallback(
    async (patch: Partial<DndSheet> | null): Promise<CharacterNote | null> => {
      if (!path) return null
      const prev = useNotes.getState().notes[path]
      if (prev && patch) {
        // Optimistic update so steppers and toggles feel instant.
        const dnd = { ...(prev.card.dnd as DndSheet), ...patch }
        useNotes.setState((s) => ({ notes: { ...s.notes, [path]: { ...prev, card: { ...prev.card, dnd } } } }))
      }
      try {
        const saved = await invoke('characters:updateSheet', path, patch)
        useNotes.setState((s) => ({ notes: { ...s.notes, [path]: saved } }))
        return saved
      } catch (err) {
        if (prev) useNotes.setState((s) => ({ notes: { ...s.notes, [path]: prev } }))
        toast.error(err, 'Could not update the sheet')
        return null
      }
    },
    [path]
  )

  return { note, updateSheet }
}

/** For non-React code (slash commands, dice): the current character's sheet. */
export async function loadActiveSheet(): Promise<{ path: string; note: CharacterNote } | null> {
  const session = useChat.getState().session
  const index = useVault.getState().index
  let path: string | null = useVault.getState().selectedCharacter
  if (session) {
    const link = session.frontmatter.characters[0]
    path = null
    if (link && index) {
      const target = link.replace(/^\[\[|\]\]$/g, '').split('|')[0]!.replace(/\.md$/i, '').toLowerCase()
      path = index.characters.concat(index.npcs).find((c) => c.path.replace(/\.md$/i, '').toLowerCase() === target)?.path ?? null
    }
  }
  if (!path) return null
  const cached = useNotes.getState().notes[path]
  const note = cached ?? (await invoke('characters:get', path))
  return { path, note }
}

export async function updateActiveSheet(patch: Partial<DndSheet>): Promise<CharacterNote | null> {
  const active = await loadActiveSheet()
  if (!active) return null
  const saved = await invoke('characters:updateSheet', active.path, patch)
  useNotes.setState((s) => ({ notes: { ...s.notes, [active.path]: saved } }))
  return saved
}
