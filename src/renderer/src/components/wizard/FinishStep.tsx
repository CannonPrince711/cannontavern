import { useState } from 'react'
import { CheckCircle2, Circle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { invoke } from '@/lib/ipc'
import { useApp } from '@/stores/app'
import { toast } from '@/stores/toasts'
import { useVault } from '@/stores/vault'
import { StepHeader, type StepProps } from './Wizard'

export function FinishStep({ back }: StepProps): React.JSX.Element {
  const settings = useApp((s) => s.settings)
  const updateSettings = useApp((s) => s.updateSettings)
  const index = useVault((s) => s.index)
  const [sample, setSample] = useState(!index?.campaigns.some((c) => c.displayName === 'The Sunken Lantern'))
  const [busy, setBusy] = useState(false)

  const items = [
    { done: !!index, label: index ? `Vault: ${index.vaultName} / ${index.rootFolder}` : 'No vault chosen' },
    { done: (settings?.textBackends.length ?? 0) > 0, label: settings?.textBackends.length ? `Text model: ${settings.textBackends[0]!.name}` : 'No text model yet' },
    { done: (settings?.imageBackends.length ?? 0) > 0, label: settings?.imageBackends.length ? `Images: ${settings.imageBackends[0]!.name}` : 'No image backend (optional)' }
  ]

  const finish = async (): Promise<void> => {
    setBusy(true)
    try {
      if (sample && index) {
        // Generate the sample campaign and land in its first session.
        const r = await invoke('vault:createSampleCampaign')
        const vault = useVault.getState()
        vault.setIndex(r.index)
        vault.setActiveCampaign(r.campaignPath)
        vault.selectCharacter(r.characterPath)
        vault.selectSession(r.sessionPath)
      }
      await updateSettings({ setupComplete: true })
    } catch (err) {
      toast.error(err, 'Could not finish setup')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-center">
      <StepHeader title="The tavern is ready">Everything can be changed later in Settings.</StepHeader>
      <ul className="mb-4 w-full max-w-md space-y-2 rounded-xl border bg-card p-4">
        {items.map((it) => (
          <li key={it.label} className="flex items-center gap-2.5 text-sm">
            {it.done ? <CheckCircle2 className="size-4 text-emerald" /> : <Circle className="size-4 text-muted-foreground" />}
            {it.label}
          </li>
        ))}
      </ul>
      {index && (
        <label className="mb-8 flex w-full max-w-md cursor-pointer items-start gap-3 rounded-xl border bg-card/70 p-4">
          <input type="checkbox" checked={sample} onChange={(e) => setSample(e.target.checked)} className="mt-1 accent-[var(--primary)]" />
          <span>
            <span className="block font-display text-sm font-semibold tracking-wide">Start with “The Sunken Lantern”</span>
            <span className="block text-xs leading-relaxed text-muted-foreground">
              A short sample mystery: a campaign, lorebook, NPC, a ready-made rogue with a full sheet, and a first session waiting for your move. All written into your vault as normal notes.
            </span>
          </span>
        </label>
      )}
      <div className="flex w-full justify-between">
        <Button variant="ghost" onClick={back}>
          Back
        </Button>
        <Button size="lg" onClick={() => void finish()} disabled={busy} autoFocus>
          {busy && <Loader2 className="animate-spin" />} Enter the tavern
        </Button>
      </div>
    </div>
  )
}
