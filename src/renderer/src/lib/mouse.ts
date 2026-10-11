/**
 * Mouse shortcuts:
 * - back/forward buttons: previous/next reply (or session history), per settings
 * - Ctrl+wheel: interface zoom (Ctrl+0 resets)
 * Right-click menus use showMenu(), which pops up a native menu from the main process.
 */
import type { ContextMenuItem } from '@shared/ipc'
import { lastAiMessage, playModeOf } from '@shared/play'
import { invoke } from '@/lib/ipc'
import { useApp } from '@/stores/app'
import { useChat } from '@/stores/chat'
import { useUi } from '@/stores/ui'
import { useVault } from '@/stores/vault'

export type MenuEntry = (Omit<ContextMenuItem, 'id'> & { id?: string; run?: () => void }) | false | null | undefined

/** Shows a native menu and runs the chosen entry. Falsy entries are skipped (handy for conditions). */
export async function showMenu(entries: MenuEntry[]): Promise<void> {
  const list = entries.filter((e): e is Exclude<MenuEntry, false | null | undefined> => !!e)
  // Drop separators at the ends and doubled ones.
  const clean = list.filter((e, i) => e.type !== 'separator' || (i > 0 && i < list.length - 1 && list[i - 1]!.type !== 'separator'))
  const items: ContextMenuItem[] = clean.map((e, i) => ({ id: e.id ?? String(i), label: e.label, enabled: e.enabled, accelerator: e.accelerator, type: e.type }))
  const chosen = await invoke('app:contextMenu', items).catch(() => null)
  if (chosen !== null) clean[items.findIndex((it) => it.id === chosen)]?.run?.()
}

export const separator: MenuEntry = { label: '', type: 'separator' }

function settings(): { shortcuts: boolean; side: 'replies' | 'sessions' | 'off' } {
  const b = useApp.getState().settings?.behavior
  return { shortcuts: b?.mouseShortcuts ?? true, side: b?.mouseSideButtons ?? 'replies' }
}

// ── Session history for the back/forward buttons ──
const history: string[] = []
let cursor = -1
let navigating = false

function goHistory(dir: -1 | 1): void {
  const next = cursor + dir
  const index = useVault.getState().index
  // Skip sessions that no longer exist.
  for (let i = next; i >= 0 && i < history.length; i += dir) {
    const path = history[i]!
    const s = index?.sessions.find((x) => x.path === path)
    if (!s) continue
    cursor = i
    navigating = true
    useVault.getState().setActiveCampaign(s.campaignPath)
    useVault.getState().selectSession(path)
    navigating = false
    return
  }
}

function sideButton(dir: -1 | 1): void {
  const { side } = settings()
  if (side === 'off' || useUi.getState().settingsOpen) return
  if (side === 'sessions') return goHistory(dir)
  const chat = useChat.getState()
  const session = chat.session
  if (!session || chat.streaming) return
  const last = lastAiMessage(playModeOf(session.frontmatter), session.messages)
  if (last) void chat.swipe(last.id, dir)
}

let zoomAt = 0
function zoom(delta: number | null): void {
  const app = useApp.getState()
  const current = app.settings?.appearance.uiScale ?? 1
  const next = delta === null ? 1 : Math.round(Math.min(1.3, Math.max(0.9, current + delta)) * 100) / 100
  if (next !== current) void app.updateSettings({ appearance: { uiScale: next } })
}

export function initMouseShortcuts(): () => void {
  const onMouseDown = (e: MouseEvent): void => {
    // Stop Chromium treating the side buttons as history navigation.
    if (e.button === 3 || e.button === 4) e.preventDefault()
  }
  const onMouseUp = (e: MouseEvent): void => {
    if (e.button !== 3 && e.button !== 4) return
    e.preventDefault()
    sideButton(e.button === 3 ? -1 : 1)
  }
  const onWheel = (e: WheelEvent): void => {
    if (!e.ctrlKey || !settings().shortcuts) return
    e.preventDefault()
    const now = Date.now()
    if (now - zoomAt < 90) return
    zoomAt = now
    zoom(e.deltaY < 0 ? 0.05 : -0.05)
  }
  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key === '0' && settings().shortcuts) {
      e.preventDefault()
      zoom(null)
    }
  }
  window.addEventListener('mousedown', onMouseDown)
  window.addEventListener('mouseup', onMouseUp)
  window.addEventListener('wheel', onWheel, { passive: false })
  window.addEventListener('keydown', onKey)
  const unsub = useVault.subscribe((s, prev) => {
    if (s.selectedSession === prev.selectedSession || !s.selectedSession || navigating) return
    history.splice(cursor + 1)
    if (history[history.length - 1] !== s.selectedSession) history.push(s.selectedSession)
    if (history.length > 50) history.shift()
    cursor = history.length - 1
  })
  return () => {
    window.removeEventListener('mousedown', onMouseDown)
    window.removeEventListener('mouseup', onMouseUp)
    window.removeEventListener('wheel', onWheel)
    window.removeEventListener('keydown', onKey)
    unsub()
  }
}

/** Double-click to edit, middle-click to open in Obsidian, Ctrl+wheel zoom. */
export function mouseShortcutsOn(): boolean {
  return settings().shortcuts
}

/** The selected text inside an element, if any. */
export function selectionWithin(el: Element | null): string {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || !el) return ''
  const node = sel.anchorNode
  return node && el.contains(node) ? sel.toString() : ''
}
