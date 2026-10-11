import { useState } from 'react'
import { Download, FolderOpen, Loader2, RotateCcw, Upload } from 'lucide-react'
import { THEMES } from '@shared/themes'
import type { ThemeId } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Callout, Field, NativeSelect, SettingsGroup, Slider, Switch } from '@/components/ui/controls'
import { Input } from '@/components/ui/input'
import { invoke } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { useApp } from '@/stores/app'
import { toast } from '@/stores/toasts'
import { useVault } from '@/stores/vault'

export function GeneralSection(): React.JSX.Element {
  const settings = useApp((s) => s.settings)!
  const updateSettings = useApp((s) => s.updateSettings)
  const index = useVault((s) => s.index)
  const setIndex = useVault((s) => s.setIndex)
  const [vaultPath, setVaultPath] = useState(settings.vault.path)
  const [rootFolder, setRootFolder] = useState(settings.vault.rootFolder)
  const [busy, setBusy] = useState(false)
  const changed = vaultPath !== settings.vault.path || rootFolder !== settings.vault.rootFolder || !index

  const browse = async (): Promise<void> => {
    const picked = await invoke('vault:pick')
    if (picked) setVaultPath(picked)
  }
  const apply = async (): Promise<void> => {
    setBusy(true)
    try {
      const v = await invoke('vault:validate', vaultPath)
      if (!v.exists) throw new Error('That folder does not exist.')
      if (!v.isObsidianVault) toast.warning('No .obsidian folder found', 'It will still work as a plain folder.')
      setIndex(await invoke('vault:configure', { path: vaultPath, rootFolder }))
      toast.success('Vault connected', `${v.name} / ${rootFolder}`)
    } catch (err) {
      toast.error(err, 'Could not use that vault')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <SettingsGroup title="Vault" description="Where characters, campaigns and sessions are stored as Markdown.">
        <Field label="Vault folder" htmlFor="g-vault">
          <div className="flex gap-2">
            <Input id="g-vault" value={vaultPath} onChange={(e) => setVaultPath(e.target.value)} className="font-mono text-[13px]" spellCheck={false} />
            <Button variant="outline" onClick={() => void browse()}>
              <FolderOpen /> Browse
            </Button>
          </div>
        </Field>
        <Field label="Folder inside the vault" htmlFor="g-root" description="DND Tavern only writes inside this folder and never touches .obsidian/.">
          <Input id="g-root" value={rootFolder} onChange={(e) => setRootFolder(e.target.value)} />
        </Field>
        <div className="flex items-center justify-between py-3">
          <span className="text-xs text-muted-foreground">
            {index ? `Connected: ${index.vaultName} · ${index.characters.length} characters · ${index.sessions.length} sessions` : 'Not connected'}
          </span>
          <Button onClick={() => void apply()} disabled={!vaultPath || busy || !changed}>
            {busy && <Loader2 className="animate-spin" />} Validate & use
          </Button>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Play">
        <Field label="Player name" htmlFor="g-player" description="Used for your messages and in prompts as {{user}}.">
          <Input
            id="g-player"
            defaultValue={settings.general.playerName}
            onBlur={(e) => e.target.value.trim() && void updateSettings({ general: { playerName: e.target.value.trim() } })}
          />
        </Field>
        <Field label="Default campaign" htmlFor="g-campaign">
          <NativeSelect
            id="g-campaign"
            value={settings.general.defaultCampaign ?? ''}
            onChange={(e) => void updateSettings({ general: { defaultCampaign: e.target.value || null } })}
          >
            <option value="">Last used</option>
            {index?.campaigns.map((c) => (
              <option key={c.path} value={c.path}>
                {c.displayName}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Session file name date format" htmlFor="g-date" description="Tokens: YYYY MM DD HH mm. Example: 2026-10-10 Session 01.md">
          <Input
            id="g-date"
            defaultValue={settings.general.sessionDateFormat}
            onBlur={(e) => e.target.value.trim() && void updateSettings({ general: { sessionDateFormat: e.target.value.trim() } })}
          />
        </Field>
      </SettingsGroup>

      <SettingsGroup title="Behaviour">
        <Field inline label="Launch on startup" description="Start DND Tavern when you sign in to Windows.">
          <Switch aria-label="Launch on startup" checked={settings.behavior.launchOnStartup} onCheckedChange={(v) => void updateSettings({ behavior: { launchOnStartup: v } })} />
        </Field>
        <Field inline label="Minimise to tray" description="Shows an icon in the notification area; closing the window hides it there instead of quitting. Quit from the icon’s menu.">
          <Switch aria-label="Minimise to tray" checked={settings.behavior.minimizeToTray} onCheckedChange={(v) => void updateSettings({ behavior: { minimizeToTray: v } })} />
        </Field>
        <Field inline label="Check for updates" description="Off by default. When on, asks GitHub once per launch whether a newer release exists and shows a download link. Nothing installs automatically.">
          <Switch aria-label="Check for updates" checked={settings.behavior.autoUpdateCheck} onCheckedChange={(v) => void updateSettings({ behavior: { autoUpdateCheck: v } })} />
        </Field>
      </SettingsGroup>

      <SettingsGroup title="Mouse" description="Right-click messages, sessions and characters for their actions; text boxes get Cut, Copy, Paste and spelling suggestions.">
        <Field inline label="Mouse shortcuts" description="Double-click your own message to edit it · middle-click a session or character to open it in Obsidian · Ctrl+scroll to zoom (Ctrl+0 resets).">
          <Switch aria-label="Mouse shortcuts" checked={settings.behavior.mouseShortcuts} onCheckedChange={(v) => void updateSettings({ behavior: { mouseShortcuts: v } })} />
        </Field>
        <Field inline label="Back / forward buttons" description="The side buttons on many mice.">
          <NativeSelect
            aria-label="Back and forward buttons"
            value={settings.behavior.mouseSideButtons}
            onChange={(e) => void updateSettings({ behavior: { mouseSideButtons: e.target.value as 'replies' | 'sessions' | 'off' } })}
            className="w-56"
          >
            <option value="replies">Previous / next reply</option>
            <option value="sessions">Back / forward through sessions</option>
            <option value="off">Do nothing</option>
          </NativeSelect>
        </Field>
      </SettingsGroup>
    </div>
  )
}

const ACCENTS = ['#c9a227', '#d4793a', '#b84a62', '#7a6fd0', '#3d8fc4', '#3fb68b']

export function AppearanceSection(): React.JSX.Element {
  const a = useApp((s) => s.settings!.appearance)
  const isWin11 = useApp((s) => s.info?.isWin11 ?? false)
  const updateSettings = useApp((s) => s.updateSettings)
  const set = (patch: Partial<typeof a>): void => void updateSettings({ appearance: patch })

  return (
    <div className="space-y-6">
      <SettingsGroup title="Theme">
        <div className="grid grid-cols-3 gap-3 py-3" role="radiogroup" aria-label="Theme">
          {Object.values(THEMES).map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={a.theme === t.id}
              onClick={() => set({ theme: t.id as ThemeId })}
              className={cn('overflow-hidden rounded-lg border text-left transition-shadow', a.theme === t.id && 'ring-2 ring-primary')}
            >
              <div data-theme={t.id} className="flex h-20 gap-1.5 bg-background p-2">
                <div className="w-1/4 rounded bg-sidebar" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <div className="paper h-8 rounded bg-page p-1.5">
                    <div className="h-1.5 w-3/4 rounded-full bg-parchment/60" />
                  </div>
                  <div className="ml-auto h-4 w-1/2 rounded bg-primary" />
                </div>
              </div>
              <div className="border-t bg-card px-3 py-2 text-sm font-medium">{t.label}</div>
            </button>
          ))}
        </div>
        <Field label="Accent colour" description="Replaces the gold used for primary actions.">
          <div className="flex items-center gap-2">
            {ACCENTS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Accent ${c}`}
                aria-pressed={(a.accent ?? '#c9a227') === c}
                onClick={() => set({ accent: c === '#c9a227' ? null : c })}
                className={cn('size-7 rounded-full border-2', (a.accent ?? '#c9a227') === c ? 'border-foreground' : 'border-transparent')}
                style={{ background: c }}
              />
            ))}
            <input
              type="color"
              aria-label="Custom accent colour"
              value={a.accent ?? '#c9a227'}
              onChange={(e) => set({ accent: e.target.value })}
              className="size-7 cursor-pointer rounded-full border bg-transparent"
            />
            {a.accent && (
              <Button variant="ghost" size="sm" onClick={() => set({ accent: null })}>
                <RotateCcw /> Theme default
              </Button>
            )}
          </div>
        </Field>
        {isWin11 && (
          <Field inline label="Window material" description="Windows 11 backdrop behind the panels.">
            <NativeSelect value={a.windowMaterial} onChange={(e) => set({ windowMaterial: e.target.value as typeof a.windowMaterial })} className="w-40" aria-label="Window material">
              <option value="auto">Mica (default)</option>
              <option value="acrylic">Acrylic</option>
              <option value="none">Solid</option>
            </NativeSelect>
          </Field>
        )}
      </SettingsGroup>

      <SettingsGroup title="Size & motion">
        <Field label="Interface scale">
          <Slider value={a.uiScale} min={0.9} max={1.3} step={0.05} onValueChange={(v) => set({ uiScale: v })} format={(v) => `${Math.round(v * 100)}%`} aria-label="Interface scale" />
        </Field>
        <Field label="Chat text size">
          <Slider value={a.chatFontSize} min={12} max={28} step={1} onValueChange={(v) => set({ chatFontSize: v })} format={(v) => `${v}px`} aria-label="Chat text size" />
        </Field>
        <Field inline label="Reduce motion" description="“System” follows the Windows animation setting.">
          <NativeSelect value={a.reduceMotion} onChange={(e) => set({ reduceMotion: e.target.value as typeof a.reduceMotion })} className="w-40" aria-label="Reduce motion">
            <option value="system">System</option>
            <option value="on">Always reduce</option>
            <option value="off">Full animation</option>
          </NativeSelect>
        </Field>
        <Field inline label="3D dice" description="Roll physical-looking dice with WebGL instead of the 2D animation.">
          <Switch aria-label="3D dice" checked={a.dice3d} onCheckedChange={(v) => set({ dice3d: v })} />
        </Field>
      </SettingsGroup>
    </div>
  )
}

export function SecuritySection(): React.JSX.Element {
  const settings = useApp((s) => s.settings)!
  const updateSettings = useApp((s) => s.updateSettings)
  const [includeKeys, setIncludeKeys] = useState(false)

  const exportSettings = async (): Promise<void> => {
    try {
      const r = await invoke('settings:export', { includeKeys })
      if (r) toast.success('Settings exported', r.path)
    } catch (err) {
      toast.error(err, 'Export failed')
    }
  }
  const importSettings = async (): Promise<void> => {
    try {
      const s = await invoke('settings:import')
      if (s) {
        useApp.setState({ settings: s })
        toast.success('Settings imported')
      }
    } catch (err) {
      toast.error(err, 'Import failed')
    }
  }

  return (
    <div className="space-y-6">
      <SettingsGroup title="Connections">
        <Field inline label="Warn about unencrypted connections" description="Flags http:// backends that aren’t on this PC, your LAN or Tailscale.">
          <Switch aria-label="Warn about unencrypted connections" checked={settings.security.warnInsecureHttp} onCheckedChange={(v) => void updateSettings({ security: { warnInsecureHttp: v } })} />
        </Field>
        <div className="space-y-1.5 py-3 text-xs leading-relaxed text-muted-foreground">
          <p>• DND Tavern opens no network port. The window talks to the app only over internal IPC.</p>
          <p>• API keys are encrypted with Windows DPAPI, stay in the background process, and are masked in errors and the prompt inspector.</p>
          <p>• Links in messages open in your browser only if they are https: or obsidian: links.</p>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Export & import" description="Back up or move your settings. Your vault path is never overwritten by an import.">
        <Field inline label="Include API keys" description="Off by default. Keys are written in plain text to the export file.">
          <Switch aria-label="Include API keys in export" checked={includeKeys} onCheckedChange={setIncludeKeys} />
        </Field>
        {includeKeys && (
          <Callout tone="crimson" className="my-2">
            The exported file will contain your keys unencrypted. Keep it somewhere private and delete it when you’re done.
          </Callout>
        )}
        <div className="flex gap-2 py-3">
          <Button variant="outline" onClick={() => void exportSettings()}>
            <Download /> Export settings…
          </Button>
          <Button variant="outline" onClick={() => void importSettings()}>
            <Upload /> Import settings…
          </Button>
        </div>
      </SettingsGroup>
    </div>
  )
}

export function ComingSection({ title, step }: { title: string; step: string }): React.JSX.Element {
  return (
    <SettingsGroup title={title}>
      <p className="py-3 text-sm text-muted-foreground">{step}</p>
    </SettingsGroup>
  )
}
