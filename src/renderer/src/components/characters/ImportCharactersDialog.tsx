import { useMemo, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import type { CharacterSummary } from '@shared/types'
import { fromOtherCampaigns } from '@shared/membership'
import { CharacterAvatar } from '@/components/CharacterAvatar'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { invoke } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { toast } from '@/stores/toasts'
import { useActiveCampaign, useVault } from '@/stores/vault'

const NONE: CharacterSummary[] = []

/** Brings characters from other campaigns into the open one, as copies or shared. */
export function ImportCharactersDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }): React.JSX.Element {
  const campaign = useActiveCampaign()
  const characters = useVault((s) => s.index?.characters ?? NONE)
  const campaigns = useVault((s) => s.index?.campaigns)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<'copy' | 'share'>('copy')
  const [busy, setBusy] = useState(false)

  // Grouped by the campaign they come from.
  const groups = useMemo(() => {
    const others = fromOtherCampaigns(characters, campaign?.path)
    const byCampaign = new Map<string, CharacterSummary[]>()
    for (const c of others) {
      const from = c.campaigns?.[0] ?? ''
      byCampaign.set(from, [...(byCampaign.get(from) ?? []), c])
    }
    return [...byCampaign.entries()].map(([path, list]) => ({
      name: campaigns?.find((c) => c.path.toLowerCase() === path.toLowerCase())?.displayName ?? path.split('/').pop() ?? 'Other',
      list
    }))
  }, [characters, campaigns, campaign?.path])

  const toggle = (path: string): void =>
    setPicked((p) => {
      const next = new Set(p)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const run = async (): Promise<void> => {
    if (!campaign || !picked.size) return
    setBusy(true)
    try {
      const paths = await invoke('characters:addToCampaign', [...picked], campaign.path, mode)
      toast.success(`${paths.length} character${paths.length === 1 ? '' : 's'} added to ${campaign.displayName}`, mode === 'copy' ? 'Each is a copy with its own sheet.' : 'They’re shared: changes show up in both campaigns.')
      if (paths[0]) useVault.getState().selectCharacter(paths[0])
      setPicked(new Set())
      onOpenChange(false)
    } catch (err) {
      toast.error(err, 'Couldn’t add the characters')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import characters{campaign ? ` into ${campaign.displayName}` : ''}</DialogTitle>
          <DialogDescription>Pick characters from your other campaigns.</DialogDescription>
        </DialogHeader>
        {groups.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No characters in other campaigns.</p>
        ) : (
          <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
            {groups.map((g) => (
              <section key={g.name}>
                <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{g.name}</h3>
                <ul className="space-y-0.5">
                  {g.list.map((c) => (
                    <li key={c.path}>
                      <button
                        type="button"
                        onClick={() => toggle(c.path)}
                        aria-pressed={picked.has(c.path)}
                        className={cn('flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-accent', picked.has(c.path) && 'bg-accent')}
                      >
                        <CharacterAvatar name={c.displayName} avatar={c.avatar} version={c.mtimeMs} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{c.displayName}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {[c.race, c.class, c.level ? `Lv ${c.level}` : null].filter(Boolean).join(' · ') || 'No sheet'}
                          </span>
                        </span>
                        {picked.has(c.path) && <Check className="size-4 text-primary" />}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
        <fieldset className="space-y-1.5 text-sm">
          <legend className="mb-1 font-medium">How</legend>
          <label className="flex items-start gap-2">
            <input type="radio" name="import-mode" checked={mode === 'copy'} onChange={() => setMode('copy')} className="mt-1" />
            <span>
              <b>Copy</b>: a separate character with its own sheet, so levels, HP and loot stay in this campaign.
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name="import-mode" checked={mode === 'share'} onChange={() => setMode('share')} className="mt-1" />
            <span>
              <b>Share</b>: the same character in both campaigns; changes show up in each.
            </span>
          </label>
        </fieldset>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void run()} disabled={busy || !picked.size || !campaign}>
            {busy && <Loader2 className="animate-spin" />}
            {mode === 'copy' ? 'Copy' : 'Add'} {picked.size || ''} into campaign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
