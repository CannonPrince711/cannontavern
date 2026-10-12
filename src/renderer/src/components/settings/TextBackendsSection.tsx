import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Server, Star } from 'lucide-react'
import { TEXT_PRESETS, TEXT_TYPE_LABELS } from '@shared/presets'
import type { TextBackendInput } from '@shared/settings'
import { EmptyState } from '@/components/EmptyState'
import { RuneArt } from '@/components/illustrations'
import { Button } from '@/components/ui/button'
import { Field, NativeSelect, SettingsGroup, Switch } from '@/components/ui/controls'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tip } from '@/components/ui/tooltip'
import { newTextBackend, textViewToInput } from '@/lib/backends'
import { invoke } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { useApp } from '@/stores/app'
import { toast } from '@/stores/toasts'
import { TextBackendEditor } from './TextBackendEditor'

export function AddBackendMenu({ onPick, children }: { onPick: (draft: TextBackendInput) => void; children: React.ReactNode }): React.JSX.Element {
  // Select the stable array, derive names outside the selector (a selector that
  // returns a new array each call makes zustand re-render forever).
  const backends = useApp((s) => s.settings?.textBackends)
  const names = backends?.map((b) => b.name) ?? []
  const hosted = TEXT_PRESETS.filter((p) => p.needsKey && p.id !== 'tabby')
  const local = TEXT_PRESETS.filter((p) => !p.needsKey && p.id !== 'custom').concat(TEXT_PRESETS.filter((p) => p.id === 'tabby'))
  const item = (p: (typeof TEXT_PRESETS)[number]): React.JSX.Element => (
    <DropdownMenuItem key={p.id} onSelect={() => onPick(newTextBackend(p, names))}>
      <span className="flex-1">{p.label}</span>
      <span className="text-[11px] text-muted-foreground">{TEXT_TYPE_LABELS[p.type]}</span>
    </DropdownMenuItem>
  )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Hosted APIs</DropdownMenuLabel>
        {hosted.map(item)}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Self-hosted (local, LAN, Tailscale, rented GPU)</DropdownMenuLabel>
        {local.map(item)}
        <DropdownMenuSeparator />
        {item(TEXT_PRESETS.find((p) => p.id === 'custom')!)}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function TextBackendsSection(): React.JSX.Element {
  const settings = useApp((s) => s.settings)!
  const updateSettings = useApp((s) => s.updateSettings)
  const backends = settings.textBackends
  const [selectedId, setSelectedId] = useState<string | null>(backends[0]?.id ?? null)
  const [draftNew, setDraftNew] = useState<TextBackendInput | null>(null)

  const selected = backends.find((b) => b.id === selectedId)
  // Re-derive the form only when this backend's stored data actually changes,
  // so unrelated settings updates never wipe unsaved edits.
  const selectedJson = selected ? JSON.stringify(selected) : ''
  const initial = useMemo(() => (selected ? textViewToInput(selected) : null), [selectedJson]) // eslint-disable-line react-hooks/exhaustive-deps

  const move = async (index: number, dir: -1 | 1): Promise<void> => {
    const ids = backends.map((b) => b.id)
    const j = index + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[index], ids[j]] = [ids[j]!, ids[index]!]
    try {
      useApp.setState({ settings: await invoke('textBackends:reorder', ids) })
    } catch (err) {
      toast.error(err)
    }
  }

  const roleSelect = (role: 'chat' | 'character' | 'summary' | 'imagePrompt', label: string, description: string, empty = 'Default backend'): React.JSX.Element => (
    <Field label={label} description={description} htmlFor={`role-${role}`}>
      <NativeSelect
        id={`role-${role}`}
        value={settings.roles[role] ?? ''}
        onChange={(e) => void updateSettings({ roles: { [role]: e.target.value || null } })}
      >
        <option value="">{empty}</option>
        {backends.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </NativeSelect>
    </Field>
  )

  return (
    <div className="space-y-6">
      <div className="flex h-[min(640px,calc(100vh-220px))] min-h-[420px] overflow-hidden rounded-xl border bg-card/80 shadow-card">
        <aside className="flex w-64 shrink-0 flex-col border-r" aria-label="Text backends">
          <div className="flex items-center justify-between border-b px-3 py-2.5">
            <span className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">Backends</span>
            <AddBackendMenu
              onPick={(d) => {
                setDraftNew(d)
                setSelectedId(null)
              }}
            >
              <Button size="sm" variant="ghost">
                <Plus /> Add
              </Button>
            </AddBackendMenu>
          </div>
          <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2" role="listbox" aria-label="Text backends">
            {draftNew && (
              <li role="option" aria-selected className="rounded-md border border-dashed border-primary/60 bg-accent px-2.5 py-2 text-sm">
                <span className="block truncate font-medium">{draftNew.name}</span>
                <span className="text-[11px] text-muted-foreground">new, not saved</span>
              </li>
            )}
            {backends.map((b, i) => (
              <li key={b.id}>
                <div
                  role="option"
                  tabIndex={0}
                  aria-selected={!draftNew && selectedId === b.id}
                  onClick={() => {
                    setDraftNew(null)
                    setSelectedId(b.id)
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && (setDraftNew(null), setSelectedId(b.id))}
                  className={cn(
                    'group flex cursor-default items-center gap-2 rounded-md px-2.5 py-2 hover:bg-accent',
                    !draftNew && selectedId === b.id && 'bg-accent'
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{b.name}</span>
                      {settings.defaultTextBackendId === b.id && <Star className="size-3 shrink-0 fill-gold text-gold" aria-label="Default" />}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {TEXT_TYPE_LABELS[b.type]}
                      {b.model ? ` · ${b.model}` : ''}
                    </span>
                  </span>
                  <span className="flex flex-col opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                    <button type="button" aria-label={`Move ${b.name} up`} onClick={(e) => (e.stopPropagation(), void move(i, -1))} className="rounded p-0.5 hover:bg-background" disabled={i === 0}>
                      <ArrowUp className="size-3" />
                    </button>
                    <button type="button" aria-label={`Move ${b.name} down`} onClick={(e) => (e.stopPropagation(), void move(i, 1))} className="rounded p-0.5 hover:bg-background" disabled={i === backends.length - 1}>
                      <ArrowDown className="size-3" />
                    </button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
          {selected && !draftNew && settings.defaultTextBackendId !== selected.id && (
            <div className="border-t p-2">
              <Button variant="ghost" size="sm" className="w-full" onClick={() => void updateSettings({ defaultTextBackendId: selected.id })}>
                <Star /> Make default
              </Button>
            </div>
          )}
        </aside>

        <div className="min-w-0 flex-1">
          {draftNew ? (
            <TextBackendEditor
              key={draftNew.id}
              initial={draftNew}
              isNew
              onSaved={(id) => {
                setDraftNew(null)
                setSelectedId(id)
              }}
              onDiscardNew={() => setDraftNew(null)}
            />
          ) : initial ? (
            <TextBackendEditor key={initial.id} initial={initial} isNew={false} onDeleted={() => setSelectedId(backends.find((b) => b.id !== selectedId)?.id ?? null)} />
          ) : (
            <div className="grid h-full place-items-center">
              <EmptyState
                size="lg"
                illustration={<RuneArt />}
                title="No text backend yet"
                description="Connect any LLM: OpenRouter, Claude, OpenAI, Ollama on your PC, KoboldCpp on a rented GPU, or any API through a custom template."
                action={
                  <AddBackendMenu onPick={setDraftNew}>
                    <Button>
                      <Server /> Add a text backend
                    </Button>
                  </AddBackendMenu>
                }
              />
            </div>
          )}
        </div>
      </div>

      <SettingsGroup title="Routing" description="What happens when a backend fails, and which backend does which job.">
        <Field
          inline
          label="Fallback chain"
          description="If the default backend fails (network error, 5xx, rate limit), try the next one in list order. Order the list above."
        >
          <Tip label={settings.fallbackChain ? 'On' : 'Off'}>
            <Switch aria-label="Fallback chain" checked={settings.fallbackChain} onCheckedChange={(v) => void updateSettings({ fallbackChain: v })} />
          </Tip>
        </Field>
        <div className="grid grid-cols-2 gap-4 pt-2 xl:grid-cols-4">
          {roleSelect('chat', 'DM', 'The DM’s replies.')}
          {roleSelect('character', 'Characters', 'When the AI plays the characters: AI only, You are the DM, and companions.', 'Same as the DM')}
          {roleSelect('summary', 'Summaries & recaps', 'A cheaper model works well here.')}
          {roleSelect('imagePrompt', 'Image prompts', 'Writes prompts for /image scene.')}
        </div>
      </SettingsGroup>
    </div>
  )
}
