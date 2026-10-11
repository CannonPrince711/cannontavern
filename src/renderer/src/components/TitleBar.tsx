import { Palette, PanelLeft, PanelRight, Settings, Star } from 'lucide-react'
import { THEMES } from '@shared/themes'
import type { ThemeId } from '@shared/types'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useApp } from '@/stores/app'
import { useLayout } from '@/stores/layout'
import { useUi } from '@/stores/ui'
import { useActiveCampaign } from '@/stores/vault'

/**
 * Custom title bar. The native minimise/maximise/close buttons are drawn by
 * Windows via titleBarOverlay (so snap layouts work); this bar leaves room for
 * them using the Window Controls Overlay env() variables.
 */
export function TitleBar(): React.JSX.Element {
  const settings = useApp((s) => s.settings)
  const focused = useApp((s) => s.window.focused)
  const updateSettings = useApp((s) => s.updateSettings)
  const { leftCollapsed, rightCollapsed, toggleLeft, toggleRight } = useLayout()
  const campaign = useActiveCampaign()
  const openSettings = useUi((s) => s.openSettings)

  const backend = settings?.textBackends.find((b) => b.id === settings.defaultTextBackendId)
  const theme = settings?.appearance.theme ?? 'dark'

  return (
    <header
      className={cn(
        'app-drag relative z-20 flex h-10 shrink-0 items-center gap-3 border-b bg-titlebar pl-3 transition-opacity',
        !focused && '[&>*]:opacity-70'
      )}
      // Reserve the area covered by the native caption buttons. env() is in CSS
      // px, so it stays correct at every UI scale.
      style={{ paddingRight: 'calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, calc(100vw - 138px)))' }}
    >
      <div className="flex items-center gap-2">
        <Logo className="size-[18px] text-gold" />
        <span className="font-display text-[13px] font-semibold tracking-[0.12em] text-foreground">
          DND TAVERN
        </span>
      </div>

      <span className="h-4 w-px bg-border" aria-hidden />

      <span className="truncate text-xs text-muted-foreground" aria-label="Current campaign">
        {campaign?.displayName ?? 'No campaign'}
      </span>

      <div className="flex-1" />

      <div className="no-drag flex items-center gap-1 pr-2">
        <DropdownMenu>
          <Tip label={backend ? `Text backend: ${backend.name}` : 'No text backend configured'}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Active text backend"
                className="mr-1 flex h-6 max-w-56 items-center gap-1.5 rounded-full border bg-card/60 px-2.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
              >
                <span className={cn('size-1.5 shrink-0 rounded-full', backend ? 'bg-emerald' : 'bg-muted-foreground/50')} aria-hidden />
                <span className="truncate">{backend ? backend.model || backend.name : 'No backend'}</span>
              </button>
            </DropdownMenuTrigger>
          </Tip>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>Text backend</DropdownMenuLabel>
            {settings?.textBackends.length ? (
              <DropdownMenuRadioGroup
                value={settings.defaultTextBackendId ?? ''}
                onValueChange={(id) => void updateSettings({ defaultTextBackendId: id })}
              >
                {settings.textBackends.map((b) => (
                  <DropdownMenuRadioItem key={b.id} value={b.id}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{b.name}</span>
                      {b.model && <span className="block truncate text-[11px] text-muted-foreground">{b.model}</span>}
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            ) : (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">None configured yet.</p>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => openSettings('text')}>
              <Star /> Manage backends…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Tip label={leftCollapsed ? 'Show sidebar' : 'Hide sidebar'}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Toggle left sidebar"
            aria-pressed={!leftCollapsed}
            onClick={toggleLeft}
          >
            <PanelLeft />
          </Button>
        </Tip>
        <Tip label={rightCollapsed ? 'Show panel' : 'Hide panel'}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Toggle right panel"
            aria-pressed={!rightCollapsed}
            onClick={toggleRight}
          >
            <PanelRight />
          </Button>
        </Tip>

        <DropdownMenu>
          <Tip label="Theme">
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Choose theme">
                <Palette />
              </Button>
            </DropdownMenuTrigger>
          </Tip>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Theme</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={theme}
              onValueChange={(v) => void updateSettings({ appearance: { theme: v as ThemeId } })}
            >
              {Object.values(THEMES).map((t) => (
                <DropdownMenuRadioItem key={t.id} value={t.id}>
                  <span
                    className="size-3 rounded-full border"
                    style={{ background: t.background }}
                    aria-hidden
                  />
                  {t.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <Tip label="Settings">
          <Button variant="ghost" size="icon-sm" aria-label="Open settings" onClick={() => openSettings()}>
            <Settings />
          </Button>
        </Tip>
      </div>
    </header>
  )
}
