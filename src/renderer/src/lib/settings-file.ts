/** Save all settings to a file, or open a saved file (Settings sidebar, Security, command palette). */
import { askConfirm } from '@/components/AskDialog'
import { invoke } from '@/lib/ipc'
import { useApp } from '@/stores/app'
import { toast } from '@/stores/toasts'

export async function saveSettingsFile(includeKeys = false): Promise<void> {
  try {
    const r = await invoke('settings:export', { includeKeys })
    if (r) toast.success('Settings saved', `${r.path}${includeKeys ? '' : '\n\nAPI keys aren’t in the file; opening it on this PC keeps your current keys.'}`)
  } catch (err) {
    toast.error(err, 'Couldn’t save the settings')
  }
}

export async function openSettingsFile(): Promise<void> {
  const ok = await askConfirm({
    title: 'Open a settings file?',
    description:
      'The file’s settings replace your current ones. Your vault stays as it is, and API keys the file doesn’t include are kept. Your current settings are saved as a backup first, so you can open that to undo.',
    confirmLabel: 'Choose a file…'
  })
  if (!ok) return
  try {
    const r = await invoke('settings:import')
    if (r) {
      useApp.setState({ settings: r.settings })
      toast.success('Settings opened', `Your previous settings were saved to ${r.backupPath}`)
    }
  } catch (err) {
    toast.error(err, 'Couldn’t open the settings')
  }
}
