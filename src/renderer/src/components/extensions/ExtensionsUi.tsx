import { useState } from 'react'
import { AlertTriangle, FolderOpen, Puzzle, RefreshCw, ShieldCheck } from 'lucide-react'
import type { ExtensionInfo, ExtensionPermission } from '@shared/types'
import { EmptyState } from '@/components/EmptyState'
import { RuneArt } from '@/components/illustrations'
import { Button } from '@/components/ui/button'
import { Badge, Callout, Field, NativeSelect, SettingsGroup, Switch } from '@/components/ui/controls'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { invoke } from '@/lib/ipc'
import { useExtensions } from '@/stores/extensions'
import { toast } from '@/stores/toasts'
import { useUi } from '@/stores/ui'
import { ExtensionFrame } from './ExtensionFrame'

const PERMISSION_TEXT: Record<ExtensionPermission, { label: string; detail: string }> = {
  'vault:read': { label: 'Read notes', detail: 'Read notes inside the DND Tavern folder of your vault.' },
  'vault:write': { label: 'Write notes', detail: 'Create and change notes inside the DND Tavern folder.' },
  network: { label: 'Use the internet', detail: 'Make web requests to any address.' },
  'generate:text': { label: 'Generate text', detail: 'Send prompts to your text backend (may cost money).' },
  'generate:image': { label: 'Generate images', detail: 'Send prompts to your image backend.' }
}

function PermissionDialog({ ext, onClose }: { ext: ExtensionInfo; onClose: () => void }): React.JSX.Element {
  const setEnabled = useExtensions((s) => s.setEnabled)
  const [granted, setGranted] = useState<ExtensionPermission[]>(ext.manifest.permissions)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[480px]">
        <DialogHeader>
          <DialogTitle>Enable {ext.manifest.name}?</DialogTitle>
          <DialogDescription>
            {ext.manifest.description}
            {ext.manifest.author && <span className="mt-1 block text-xs">By {ext.manifest.author} · v{ext.manifest.version}</span>}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 px-6 pb-4">
          {ext.manifest.permissions.length === 0 ? (
            <Callout tone="emerald" icon={<ShieldCheck />}>
              This extension asks for no permissions. It can only post messages and keep its own small store of data.
            </Callout>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">It asks for:</p>
              {ext.manifest.permissions.map((p) => (
                <label key={p} className="flex cursor-pointer items-start gap-3 rounded-lg border bg-card px-3 py-2">
                  <input
                    type="checkbox"
                    className="mt-1 accent-[var(--primary)]"
                    checked={granted.includes(p)}
                    onChange={(e) => setGranted(e.target.checked ? [...granted, p] : granted.filter((x) => x !== p))}
                  />
                  <span>
                    <span className="block text-sm font-medium">{PERMISSION_TEXT[p].label}</span>
                    <span className="block text-xs text-muted-foreground">{PERMISSION_TEXT[p].detail}</span>
                  </span>
                </label>
              ))}
              <p className="text-[11px] text-muted-foreground">Unticked permissions are denied; the extension may then work with fewer features.</p>
            </>
          )}
          <Callout tone="gold" icon={<AlertTriangle />}>
            Only enable extensions you trust. They run with limited access, but extension code is still code.
          </Callout>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              void setEnabled(ext.manifest.id, true, granted)
              onClose()
            }}
          >
            Enable
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ExtensionCard({ ext }: { ext: ExtensionInfo }): React.JSX.Element {
  const setEnabled = useExtensions((s) => s.setEnabled)
  const saveSettings = useExtensions((s) => s.saveSettings)
  const [asking, setAsking] = useState(false)
  const defs = ext.manifest.settings ?? []

  return (
    <section className="rounded-xl border bg-card/80 p-4 shadow-card">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-gold">
          <Puzzle className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{ext.manifest.name}</h3>
            <span className="text-[11px] text-muted-foreground">v{ext.manifest.version}</span>
            {ext.bundled && <Badge>example</Badge>}
            {ext.status === 'error' && <Badge tone="crimson">error</Badge>}
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{ext.manifest.description}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {ext.manifest.permissions.length === 0 && <Badge tone="emerald">no permissions</Badge>}
            {ext.manifest.permissions.map((p) => (
              <Badge key={p} tone={ext.enabled && ext.granted.includes(p) ? 'gold' : 'muted'}>
                {PERMISSION_TEXT[p].label}
                {ext.enabled && !ext.granted.includes(p) ? ' (denied)' : ''}
              </Badge>
            ))}
            {(ext.manifest.commands ?? []).map((c) => (
              <Badge key={c.name}>/{c.name}</Badge>
            ))}
            {ext.hasUi && <Badge>panel</Badge>}
          </div>
          {ext.status === 'error' && <Callout tone="crimson" className="mt-2">{ext.error}</Callout>}
        </div>
        <Switch
          aria-label={`${ext.enabled ? 'Disable' : 'Enable'} ${ext.manifest.name}`}
          checked={ext.enabled}
          onCheckedChange={(on) => (on ? setAsking(true) : void setEnabled(ext.manifest.id, false, []))}
        />
      </div>
      {ext.enabled && defs.length > 0 && (
        <div className="mt-3 border-t pt-2">
          {defs.map((d) => {
            const value = ext.values[d.key]
            const update = (v: string | number | boolean): void => void saveSettings(ext.manifest.id, { ...ext.values, [d.key]: v } as Record<string, unknown>)
            return d.type === 'boolean' ? (
              <Field key={d.key} inline label={d.label}>
                <Switch aria-label={d.label} checked={!!value} onCheckedChange={update} />
              </Field>
            ) : d.type === 'select' ? (
              <Field key={d.key} inline label={d.label}>
                <NativeSelect value={String(value)} onChange={(e) => update(e.target.value)} className="w-40" aria-label={d.label}>
                  {(d.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ) : (
              <Field key={d.key} inline label={d.label}>
                <Input
                  className="w-48"
                  aria-label={d.label}
                  type={d.type === 'number' ? 'number' : 'text'}
                  defaultValue={String(value ?? '')}
                  onBlur={(e) => update(d.type === 'number' ? Number(e.target.value) : e.target.value)}
                />
              </Field>
            )
          })}
        </div>
      )}
      {asking && <PermissionDialog ext={ext} onClose={() => setAsking(false)} />}
    </section>
  )
}

export function ExtensionsSection(): React.JSX.Element {
  const list = useExtensions((s) => s.list)
  const reload = useExtensions((s) => s.reload)
  return (
    <div className="space-y-4">
      <SettingsGroup
        title="Extensions"
        description="Extensions live in %APPDATA%\DND Tavern\extensions\, one folder each. They are off until you enable them, and each one only gets the permissions you grant."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void invoke('app:openFolder', 'extensions').catch((e) => toast.error(e))}>
              <FolderOpen /> Open folder
            </Button>
            <Button variant="outline" size="sm" onClick={() => void reload().then(() => toast.success('Extensions reloaded'))}>
              <RefreshCw /> Reload
            </Button>
          </div>
        }
      >
        <p className="py-2 text-xs text-muted-foreground">See the README’s extension guide to write your own. The bundled examples are a good starting point.</p>
      </SettingsGroup>
      {list.length === 0 ? (
        <EmptyState illustration={<RuneArt />} title="No extensions installed" description="Put an extension folder (with extension.json) into the extensions folder, then press Reload." />
      ) : (
        list.map((ext) => <ExtensionCard key={ext.manifest.id} ext={ext} />)
      )}
    </div>
  )
}

/** Right panel “Extensions” tab: the panels of enabled extensions. */
export function ExtensionsPanel(): React.JSX.Element {
  const list = useExtensions((s) => s.list)
  const panels = list.filter((e) => e.enabled && e.hasUi && e.status === 'loaded')
  const enabled = list.filter((e) => e.enabled)
  if (!panels.length) {
    return (
      <EmptyState
        illustration={<RuneArt />}
        title={enabled.length ? 'No extension panels' : 'No extensions enabled'}
        description={enabled.length ? `${enabled.map((e) => e.manifest.name).join(', ')} ${enabled.length === 1 ? 'adds' : 'add'} commands but no panel.` : 'Extensions are off by default. Enable them in Settings → Extensions.'}
        action={
          <Button size="sm" variant="outline" onClick={() => useUi.getState().openSettings('extensions')}>
            <Puzzle /> Manage extensions
          </Button>
        }
        className="pt-16"
      />
    )
  }
  return (
    <div className="space-y-3 p-3">
      {panels.map((e) => (
        <section key={e.manifest.id} aria-label={e.manifest.name}>
          <h3 className="mb-1 px-1 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">{e.manifest.name}</h3>
          <ExtensionFrame extensionId={e.manifest.id} name={e.manifest.name} mode="panel" />
        </section>
      ))}
    </div>
  )
}

/** Hidden frames that compute message decorations (onMessageRender). */
export function ExtensionWorkers(): React.JSX.Element {
  const list = useExtensions((s) => s.list)
  return (
    <>
      {list
        .filter((e) => e.enabled && e.hasUi && e.status === 'loaded')
        .map((e) => (
          <ExtensionFrame key={e.manifest.id} extensionId={e.manifest.id} name={e.manifest.name} mode="worker" />
        ))}
    </>
  )
}
