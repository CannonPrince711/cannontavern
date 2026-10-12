import { Globe2 } from 'lucide-react'
import { worldGroups, type WorldGroup } from '@shared/world'
import { useUi } from '@/stores/ui'
import { useVault } from '@/stores/vault'

const GROUP_LABEL: Record<WorldGroup, string> = { text: 'text model', prompt: 'DM prompt', images: 'images', triggers: 'automatic images' }

/**
 * Top of a global settings section: says these are the defaults and lists the
 * worlds that override them, each opening that campaign's This world tab.
 */
export function WorldOverridesNotice({ groups }: { groups: WorldGroup[] }): React.JSX.Element {
  const campaigns = useVault((s) => s.index?.campaigns ?? [])
  const overriding = campaigns
    .map((c) => ({ c, which: worldGroups(c.world).filter((g) => groups.includes(g)) }))
    .filter((x) => x.which.length)
  const open = (path: string): void => {
    useUi.getState().closeSettings()
    useUi.setState({ campaignSettings: path, campaignSettingsTab: 'world' })
  }
  return (
    <div className="mb-5 flex items-start gap-3 rounded-lg border bg-card/60 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
      <Globe2 className="mt-0.5 size-4 shrink-0 text-gold" />
      <div className="min-w-0">
        <p>
          <span className="font-medium text-foreground">Global defaults.</span> Each campaign can override these in its settings, on the{' '}
          <span className="font-medium text-foreground">This world</span> tab.
        </p>
        {overriding.length > 0 && (
          <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
            Overridden by:
            {overriding.map(({ c, which }) => (
              <button
                key={c.path}
                type="button"
                onClick={() => open(c.path)}
                className="rounded-full border px-2 py-0.5 text-foreground transition-colors hover:bg-accent"
                title={`Open ${c.displayName} → This world`}
              >
                {c.displayName} <span className="text-muted-foreground">({which.map((g) => GROUP_LABEL[g]).join(', ')})</span>
              </button>
            ))}
          </p>
        )}
      </div>
    </div>
  )
}
