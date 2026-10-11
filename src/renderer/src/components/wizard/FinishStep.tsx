import { useState } from 'react'
import { CheckCircle2, Circle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useApp } from '@/stores/app'
import { useVault } from '@/stores/vault'
import { StepHeader, type StepProps } from './Wizard'

export function FinishStep({ back }: StepProps): React.JSX.Element {
  const settings = useApp((s) => s.settings)
  const updateSettings = useApp((s) => s.updateSettings)
  const index = useVault((s) => s.index)
  const [busy, setBusy] = useState(false)

  const items = [
    { done: !!index, label: index ? `Vault: ${index.vaultName} / ${index.rootFolder}` : 'No vault chosen' },
    {
      done: (settings?.textBackends.length ?? 0) > 0,
      label: settings?.textBackends.length ? `Text model: ${settings.textBackends[0]!.name}` : 'No text model yet'
    }
  ]

  const finish = async (): Promise<void> => {
    setBusy(true)
    try {
      await updateSettings({ setupComplete: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-center">
      <StepHeader title="The tavern is ready">Everything can be changed later in Settings.</StepHeader>
      <ul className="mb-8 w-full max-w-md space-y-2 rounded-xl border bg-card p-4">
        {items.map((it) => (
          <li key={it.label} className="flex items-center gap-2.5 text-sm">
            {it.done ? <CheckCircle2 className="size-4 text-emerald" /> : <Circle className="size-4 text-muted-foreground" />}
            {it.label}
          </li>
        ))}
      </ul>
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
