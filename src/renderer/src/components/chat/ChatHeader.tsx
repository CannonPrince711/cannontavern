import { useState } from 'react'
import { Check, ExternalLink, Map as MapIcon, Pencil, ScanSearch, UserRound } from 'lucide-react'
import { useMap } from '@/components/map/MapView'
import type { InvokeArgs } from '@shared/ipc'
import type { CharacterSummary } from '@shared/types'
import { PLAY_MODE_INFO, PLAY_MODES, playModeOf, type PlayMode } from '@shared/play'
import { CharacterAvatar } from '@/components/CharacterAvatar'
import { ImageModelSwitcher, TextModelSwitcher } from '@/components/ModelSwitcher'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/controls'
import { Input } from '@/components/ui/input'
import { Tip } from '@/components/ui/tooltip'
import { invoke } from '@/lib/ipc'
import { useApp } from '@/stores/app'
import { useChat } from '@/stores/chat'
import { toast } from '@/stores/toasts'
import { useVault } from '@/stores/vault'

export function ChatHeader({ character, onInspect }: { character: CharacterSummary | null; onInspect?: () => void }): React.JSX.Element {
  const session = useChat((s) => s.session)!
  const settings = useApp((s) => s.settings)!
  const characters = useVault((s) => s.index?.characters)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(session.frontmatter.title)

  const mode = playModeOf(session.frontmatter)
  const persona = session.frontmatter.persona || character?.displayName || settings.general.playerName
  const personas = [...new Set([settings.general.playerName, ...(characters ?? []).map((c) => c.displayName), persona])]

  const meta = async (patch: InvokeArgs<'sessions:updateMeta'>[1]): Promise<void> => {
    try {
      useChat.setState({ session: await invoke('sessions:updateMeta', session.path, patch) })
    } catch (err) {
      toast.error(err)
    }
  }

  return (
    <header className="@container flex items-center gap-2 border-b px-4 py-2">
      {character ? (
        <CharacterAvatar name={character.displayName} avatar={character.avatar} version={character.mtimeMs} hp={character.hp} maxHp={character.max_hp} size={32} />
      ) : (
        <span className="grid size-8 place-items-center rounded-full bg-surface-2 text-muted-foreground">
          <UserRound className="size-4" />
        </span>
      )}
      <div className="min-w-[120px] flex-1">
        {editing ? (
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault()
              setEditing(false)
              if (title.trim() && title !== session.frontmatter.title) void meta({ title })
            }}
          >
            <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus className="h-7 text-sm" aria-label="Session title" onBlur={() => setEditing(false)} />
            <Button type="submit" size="icon-sm" variant="ghost" aria-label="Save title">
              <Check />
            </Button>
          </form>
        ) : (
          <button type="button" onClick={() => (setTitle(session.frontmatter.title), setEditing(true))} className="group flex max-w-full items-center gap-1.5 text-left">
            <h2 className="truncate font-display text-sm font-semibold tracking-wide">{session.frontmatter.title}</h2>
            <Pencil className="size-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
          </button>
        )}
        <p className="truncate text-[11px] text-muted-foreground">
          {character ? `${character.displayName}${character.class ? ` · ${character.class} ${character.level ?? ''}` : ''}` : 'No character'} · {session.messages.length} {session.messages.length === 1 ? 'message' : 'messages'}
        </p>
      </div>

      <Tip label={PLAY_MODE_INFO[mode].description}>
        <NativeSelect value={mode} onChange={(e) => void meta({ mode: e.target.value as PlayMode })} className="w-[7.5rem] @min-[760px]:w-36" aria-label="Play mode">
          {PLAY_MODES.map((m) => (
            <option key={m} value={m}>
              {PLAY_MODE_INFO[m].short}
            </option>
          ))}
        </NativeSelect>
      </Tip>

      {mode === 'ai-dm' && (
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="hidden @min-[960px]:inline">Playing as</span>
          <NativeSelect value={persona} onChange={(e) => void meta({ persona: e.target.value })} className="w-28 @min-[760px]:w-40" aria-label="Persona">
            {personas.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </NativeSelect>
        </label>
      )}

      <TextModelSwitcher className="w-32 @min-[760px]:w-48" />
      <ImageModelSwitcher compact className="w-28 @min-[760px]:w-40" />

      <Tip label="Campaign map">
        <Button variant="ghost" size="icon-sm" aria-label="Open the map" onClick={() => useMap.setState({ open: true })}>
          <MapIcon />
        </Button>
      </Tip>
      {onInspect && (
        <Tip label="Prompt inspector">
          <Button variant="ghost" size="icon-sm" aria-label="Open prompt inspector" onClick={onInspect}>
            <ScanSearch />
          </Button>
        </Tip>
      )}
      <Tip label="Open in Obsidian">
        <Button variant="ghost" size="icon-sm" aria-label="Open session in Obsidian" onClick={() => void invoke('vault:openInObsidian', session.path).catch((e) => toast.error(e))}>
          <ExternalLink />
        </Button>
      </Tip>
    </header>
  )
}
