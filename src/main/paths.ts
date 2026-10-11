import { app } from 'electron'
import { join } from 'node:path'

export const paths = {
  get userData(): string {
    return app.getPath('userData')
  },
  get settingsFile(): string {
    return join(app.getPath('userData'), 'settings.json')
  },
  get windowStateFile(): string {
    return join(app.getPath('userData'), 'window-state.json')
  },
  get extensionsDir(): string {
    return join(app.getPath('userData'), 'extensions')
  },
  get workflowsDir(): string {
    return join(app.getPath('userData'), 'workflows')
  },
  /** Bundled example extensions shipped next to the app. */
  get bundledExtensionsDir(): string {
    return app.isPackaged
      ? join(process.resourcesPath, 'extensions')
      : join(app.getAppPath(), 'extensions')
  }
}
