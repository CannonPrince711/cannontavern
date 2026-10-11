import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, FolderOpen, Gem, Loader2, XCircle } from 'lucide-react'
import type { DetectedVault, VaultValidation } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { invoke } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { useApp } from '@/stores/app'
import { useVault } from '@/stores/vault'
import { StepHeader, type StepProps } from './Wizard'

export function VaultStep({ next, back }: StepProps): React.JSX.Element {
  const settings = useApp((s) => s.settings)
  const setIndex = useVault((s) => s.setIndex)
  const [detected, setDetected] = useState<DetectedVault[] | null>(null)
  const [path, setPath] = useState(settings?.vault.path ?? '')
  const [rootFolder, setRootFolder] = useState(settings?.vault.rootFolder ?? 'DND Tavern')
  const [validation, setValidation] = useState<VaultValidation | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    invoke('vault:detect')
      .then((list) => {
        setDetected(list)
        if (!path && list[0]) setPath(list[0].path)
      })
      .catch(() => setDetected([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setValidation(null)
    if (!path) return
    let stale = false
    invoke('vault:validate', path).then((v) => !stale && setValidation(v)).catch(() => {})
    return () => {
      stale = true
    }
  }, [path])

  const browse = async (): Promise<void> => {
    const picked = await invoke('vault:pick')
    if (picked) setPath(picked)
  }

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setIndex(await invoke('vault:configure', { path, rootFolder }))
      next()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const canContinue = !!path && !!validation?.exists && validation.writable && rootFolder.trim().length > 0

  return (
    <div>
      <StepHeader title="Choose your vault">
        DND Tavern keeps everything as notes in an Obsidian vault. Pick one below, or any folder. Settings and API keys stay
        outside the vault.
      </StepHeader>

      <div className="space-y-2">
        {detected === null && (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Looking for Obsidian vaults…
          </div>
        )}
        {detected?.map((v) => (
          <button
            key={v.path}
            type="button"
            onClick={() => setPath(v.path)}
            aria-pressed={path === v.path}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg border bg-card px-4 py-3 text-left transition-colors hover:bg-accent',
              path === v.path && 'border-primary ring-1 ring-primary'
            )}
          >
            <Gem className="size-4 shrink-0 text-gold" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{v.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{v.path}</span>
            </span>
            {v.open && <span className="rounded-full bg-emerald/15 px-2 py-0.5 text-[11px] text-emerald">open in Obsidian</span>}
          </button>
        ))}
        {detected?.length === 0 && (
          <p className="rounded-lg border border-dashed px-4 py-4 text-center text-sm text-muted-foreground">
            No Obsidian vaults found on this PC. Browse for a folder instead.
          </p>
        )}
        <Button variant="outline" className="w-full" onClick={() => void browse()}>
          <FolderOpen /> Browse for a folder…
        </Button>
      </div>

      {path && (
        <div className="mt-5 space-y-4 rounded-xl border bg-card/70 p-4">
          <div>
            <Label>Selected folder</Label>
            <p className="selectable mt-1 truncate text-sm">{path}</p>
            <ValidationLine v={validation} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="root-folder">Folder inside the vault</Label>
            <Input id="root-folder" value={rootFolder} onChange={(e) => setRootFolder(e.target.value)} />
            <p className="text-[11px] text-muted-foreground">
              Created if it doesn’t exist. DND Tavern only writes inside this folder.
            </p>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="mt-8 flex justify-between">
        <Button variant="ghost" onClick={back}>
          Back
        </Button>
        <Button onClick={() => void submit()} disabled={!canContinue || busy}>
          {busy && <Loader2 className="animate-spin" />} Use this vault
        </Button>
      </div>
    </div>
  )
}

function ValidationLine({ v }: { v: VaultValidation | null }): React.JSX.Element | null {
  if (!v) return null
  if (!v.exists)
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-destructive">
        <XCircle className="size-3.5" /> This folder doesn’t exist.
      </p>
    )
  if (!v.writable)
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-destructive">
        <XCircle className="size-3.5" /> DND Tavern can’t write to this folder.
      </p>
    )
  if (!v.isObsidianVault)
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-gold">
        <AlertTriangle className="size-3.5" /> No .obsidian folder, so this isn’t an Obsidian vault. It will still work.
      </p>
    )
  return (
    <p className="mt-1.5 flex items-center gap-1.5 text-xs text-emerald">
      <CheckCircle2 className="size-3.5" /> Obsidian vault “{v.name}”
    </p>
  )
}
