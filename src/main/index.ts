import { app, BrowserWindow, protocol, shell } from 'electron'
import { registerAppHandlers } from './handlers/app'
import { registerBackendHandlers } from './handlers/backends'
import { registerCharacterHandlers } from './handlers/characters'
import { registerImageHandlers } from './handlers/images'
import { registerLoreHandlers } from './handlers/lore'
import { registerSheetHandlers } from './handlers/sheet'
import { registerSessionHandlers, watchExternalSessionEdits } from './handlers/sessions'
import { registerSettingsHandlers } from './handlers/settings'
import { registerVaultHandlers } from './handlers/vault'
import { send } from './ipc'
import { installSecurity } from './security'
import { settingsStore } from './settings-store'
import { handleVaultProtocol, vaultSchemeConfig } from './vault/protocol'
import { handleExtensionProtocol, registerExtensionScheme } from './extensions/protocol'
import { extensionHost } from './extensions/host'
import { registerExtensionHandlers } from './handlers/extensions'
import { vaultService } from './vault/service'
import { applyAppearance, createMainWindow, getMainWindow } from './window'

app.setAppUserModelId('com.dndtavern.app')

// Dev runs get their own profile so they never share settings or the
// single-instance lock with an installed copy.
if (!app.isPackaged) app.setPath('userData', `${app.getPath('userData')} (dev)`)

// Custom schemes must be registered (once, together) before the app is ready.
protocol.registerSchemesAsPrivileged([vaultSchemeConfig(), registerExtensionScheme()])

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = getMainWindow()
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })

  app.whenReady().then(async () => {
    installSecurity()
    handleVaultProtocol()
    handleExtensionProtocol()
    await settingsStore.load()

    registerAppHandlers()
    registerSettingsHandlers()
    registerVaultHandlers()
    registerBackendHandlers()
    registerSessionHandlers()
    registerCharacterHandlers()
    registerLoreHandlers()
    registerSheetHandlers()
    registerImageHandlers()
    registerExtensionHandlers()
    watchExternalSessionEdits()

    settingsStore.onChange((next, prev) => {
      if (JSON.stringify(next.appearance) !== JSON.stringify(prev.appearance)) {
        applyAppearance(next.appearance)
      }
      if (next.behavior.launchOnStartup !== prev.behavior.launchOnStartup && app.isPackaged) {
        app.setLoginItemSettings({ openAtLogin: next.behavior.launchOnStartup })
      }
      send(getMainWindow(), 'settings:changed', settingsStore.getPublic())
    })

    vaultService.setTrash((abs) => shell.trashItem(abs))
    vaultService.on('index', (index) => send(getMainWindow(), 'vault:index', index))
    vaultService.on('change', ({ path, event }) => send(getMainWindow(), 'vault:changed', { path, event }))

    // Open the configured vault before the window so the first render has an index.
    const { vault } = settingsStore.get()
    if (vault.path) {
      await vaultService.open(vault.path, vault.rootFolder, { create: false }).catch((err) => {
        console.error('[vault] could not open configured vault:', err)
      })
    }

    await extensionHost.installBundled().catch((err) => console.warn('[extensions] could not install examples:', err))
    await extensionHost.reload().catch((err) => console.warn('[extensions] load failed:', err))

    await createMainWindow(settingsStore.get().appearance)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createMainWindow(settingsStore.get().appearance)
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    void vaultService.close()
  })
}
