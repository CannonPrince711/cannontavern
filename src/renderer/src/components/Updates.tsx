import { useEffect } from 'react'
import { create } from 'zustand'
import { ArrowDownCircle, CheckCircle2, Download, Loader2, RefreshCw, RotateCw } from 'lucide-react'
import type { UpdateStatus } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Field, SettingsGroup, Switch } from '@/components/ui/controls'
import { Tip } from '@/components/ui/tooltip'
import { invoke, on } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { useApp } from '@/stores/app'
import { toast } from '@/stores/toasts'
import { useUi } from '@/stores/ui'

export const useUpdates = create<{ status: UpdateStatus }>(() => ({ status: { state: 'idle' } }))

/** Subscribes to the main process's updater; call once at startup. */
export function useUpdatesSync(): void {
  useEffect(() => {
    void invoke('updates:status')
      .then((status) => useUpdates.setState({ status }))
      .catch(() => {})
    return on('updates:changed', (status) => useUpdates.setState({ status }))
  }, [])
}

async function run(action: 'check' | 'download' | 'install'): Promise<void> {
  try {
    if (action === 'check') {
      const s = await invoke('updates:check')
      if (s.state === 'none') toast.success('DND Tavern is up to date')
    } else if (action === 'download') await invoke('updates:download')
    else await invoke('updates:install')
  } catch (err) {
    toast.error(err, 'Update failed')
  }
}

/** Title bar pill: shown while an update is available, downloading or ready. */
export function UpdatePill(): React.JSX.Element | null {
  const status = useUpdates((s) => s.status)
  if (status.state === 'available') {
    return (
      <Tip label={status.canInstall ? `Download DND Tavern ${status.version}` : `Open the download page for ${status.version}`}>
        <button
          type="button"
          onClick={() => void run('download')}
          className="mr-1 flex h-6 items-center gap-1.5 rounded-full border border-gold/50 bg-gold/15 px-2.5 text-[11px] font-medium text-gold hover:bg-gold/25"
        >
          <ArrowDownCircle className="size-3.5" /> Update {status.version}
        </button>
      </Tip>
    )
  }
  if (status.state === 'downloading') {
    return (
      <span className="mr-1 flex h-6 items-center gap-1.5 rounded-full border bg-card/60 px-2.5 text-[11px] text-muted-foreground" role="status">
        <Loader2 className="size-3.5 animate-spin" /> Updating {status.percent}%
      </span>
    )
  }
  if (status.state === 'ready') {
    return (
      <Tip label="Restart DND Tavern to finish updating">
        <button
          type="button"
          onClick={() => void run('install')}
          className="mr-1 flex h-6 items-center gap-1.5 rounded-full border border-emerald/50 bg-emerald/15 px-2.5 text-[11px] font-medium text-emerald hover:bg-emerald/25"
        >
          <RotateCw className="size-3.5" /> Restart to update
        </button>
      </Tip>
    )
  }
  return null
}

function describe(s: UpdateStatus): string {
  switch (s.state) {
    case 'idle':
      return 'Not checked yet.'
    case 'checking':
      return 'Checking GitHub for a new release…'
    case 'none':
      return `Up to date (checked ${new Date(s.checkedAt).toLocaleTimeString()}).`
    case 'available':
      return s.canInstall ? `Version ${s.version} is available.` : `Version ${s.version} is available. This copy (portable or development) can’t update itself; download it from the release page.`
    case 'downloading':
      return `Downloading ${s.version}… ${s.percent}%`
    case 'ready':
      return `Version ${s.version} is downloaded. Restart to install it (or it installs when you quit).`
    case 'error':
      return s.message
  }
}

/** Settings → General → Updates. */
export function UpdatesSettings(): React.JSX.Element {
  const status = useUpdates((s) => s.status)
  const settings = useApp((s) => s.settings!)
  const version = useApp((s) => s.info?.version)
  const update = useApp((s) => s.updateSettings)
  const busy = status.state === 'checking' || status.state === 'downloading'
  return (
    <SettingsGroup title="Updates" description={`You have DND Tavern ${version ?? ''}. Updates come from the project’s GitHub releases; nothing is installed without you.`}>
      <div className="flex flex-wrap items-center gap-3 py-3">
        <p className={cn('min-w-0 flex-1 text-sm', status.state === 'error' ? 'text-crimson' : 'text-muted-foreground')} role="status">
          {status.state === 'none' && <CheckCircle2 className="mr-1.5 inline size-4 text-emerald" />}
          {describe(status)}
        </p>
        {status.state === 'available' && (
          <Button size="sm" onClick={() => void run('download')}>
            <Download /> {status.canInstall ? 'Download' : 'Open download page'}
          </Button>
        )}
        {status.state === 'ready' && (
          <Button size="sm" onClick={() => void run('install')}>
            <RotateCw /> Restart and install
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => void run('check')} disabled={busy}>
          {status.state === 'checking' ? <Loader2 className="animate-spin" /> : <RefreshCw />} Check now
        </Button>
      </div>
      <Field inline label="Check on startup" description="Asks GitHub once per launch whether a newer release exists.">
        <Switch aria-label="Check for updates on startup" checked={settings.behavior.autoUpdateCheck} onCheckedChange={(v) => void update({ behavior: { autoUpdateCheck: v } })} />
      </Field>
      <Field inline label="Download automatically" description="Downloads new versions in the background, then asks you to restart. Installed copies only.">
        <Switch aria-label="Download updates automatically" checked={settings.behavior.autoDownloadUpdates} onCheckedChange={(v) => void update({ behavior: { autoDownloadUpdates: v } })} />
      </Field>
    </SettingsGroup>
  )
}

/** Opens Settings at the Updates section. */
export function openUpdateSettings(): void {
  useUi.getState().openSettings('general')
}
