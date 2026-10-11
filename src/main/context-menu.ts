/**
 * Right-click menus. Text fields and selected text get the usual edit menu
 * (with spelling suggestions); the UI asks for its own menus (messages,
 * sessions, characters) through app:contextMenu and gets back the chosen id.
 */
import { BrowserWindow, Menu, type ContextMenuParams, type MenuItemConstructorOptions } from 'electron'
import type { ContextMenuItem } from '@shared/ipc'

export function installEditMenu(win: BrowserWindow): void {
  win.webContents.on('context-menu', (_e, params: ContextMenuParams) => {
    const items: MenuItemConstructorOptions[] = []
    if (params.isEditable) {
      if (params.misspelledWord) {
        for (const word of params.dictionarySuggestions.slice(0, 5)) {
          items.push({ label: word, click: () => win.webContents.replaceMisspelling(word) })
        }
        if (!params.dictionarySuggestions.length) items.push({ label: 'No suggestions', enabled: false })
        items.push(
          { label: 'Add to dictionary', click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) },
          { type: 'separator' }
        )
      }
      items.push(
        { role: 'undo', enabled: params.editFlags.canUndo },
        { role: 'redo', enabled: params.editFlags.canRedo },
        { type: 'separator' },
        { role: 'cut', enabled: params.editFlags.canCut },
        { role: 'copy', enabled: params.editFlags.canCopy },
        { role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll' }
      )
    } else if (params.selectionText.trim()) {
      items.push({ role: 'copy' })
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win })
  })
}

/** Shows a menu the UI described; resolves to the clicked item's id, or null. */
export function popupMenu(win: BrowserWindow, items: ContextMenuItem[]): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false
    const finish = (id: string | null): void => {
      if (!done) {
        done = true
        resolve(id)
      }
    }
    const template: MenuItemConstructorOptions[] = items.map((it) =>
      it.type === 'separator'
        ? { type: 'separator' }
        : { label: it.label, enabled: it.enabled !== false, accelerator: it.accelerator, registerAccelerator: false, click: () => finish(it.id) }
    )
    // The close callback can arrive before the click handler; give the click a moment to win.
    Menu.buildFromTemplate(template).popup({ window: win, callback: () => setTimeout(() => finish(null), 50) })
  })
}
