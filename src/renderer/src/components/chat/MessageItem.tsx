import { memo, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Copy,
  EyeOff,
  FastForward,
  GitBranch,
  Pencil,
  RefreshCw,
  Trash2,
  Volume2
} from 'lucide-react'
import type { Message } from '@shared/types'
import { CharacterAvatar } from '@/components/CharacterAvatar'
import { speak } from '@/lib/speech'
import { useApp } from '@/stores/app'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { Tip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { joinVaultPath } from '@shared/names'
import { useVault, vaultUrl } from '@/stores/vault'
import { RollChips } from '@/components/dice/RollChips'
import { invoke } from '@/lib/ipc'
import { useChat } from '@/stores/chat'
import { useImages } from '@/stores/images'
import { useExtensions } from '@/stores/extensions'
import { toast } from '@/stores/toasts'
import { mouseShortcutsOn, selectionWithin, separator, showMenu } from '@/lib/mouse'
import { Markdown } from './Markdown'

export interface MessageActions {
  onSwipe: (id: string, dir: -1 | 1) => void
  onRegenerate: () => void
  onContinue: () => void
  onEdit: (id: string, text: string) => void
  onDelete: (id: string) => void
  onFork: (id: string) => void
  onCheck?: (ability: string, dc: number) => void
  onImage?: (message: Message) => void
}

interface Props extends MessageActions {
  message: Message
  isLast: boolean
  /** Text being streamed into this message right now (swipe/continue/new). */
  streamingText?: string
  streaming?: boolean
  busy: boolean
  /** Show the drop cap (first DM message of a scene). */
  dropCap: boolean
  characterName?: string
  characterAvatar?: string
  campaignPath?: string
  /** Story roles the AI writes in this session's mode (swipe/regenerate controls). */
  aiRoles: readonly string[]
}

function ActionButton({ label, onClick, children, disabled }: { label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }): React.JSX.Element {
  return (
    <Tip label={label}>
      <Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick} disabled={disabled} className="size-7 text-muted-foreground hover:text-foreground">
        {children}
      </Button>
    </Tip>
  )
}

/** Plain-text notes added by extensions (onMessageRender). */
function Decorations({ id }: { id: string }): React.JSX.Element | null {
  const items = useExtensions((s) => s.decorations[id])
  const texts = Object.values(items ?? {}).filter(Boolean)
  if (!texts.length) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1.5 font-sans">
      {texts.map((t, i) => (
        <span key={i} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
          {t}
        </span>
      ))}
    </div>
  )
}

function Editor({ initial, onSave, onCancel }: { initial: string; onSave: (t: string) => void; onCancel: () => void }): React.JSX.Element {
  const [text, setText] = useState(initial)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
    el.style.height = `${Math.min(480, el.scrollHeight + 4)}px`
  }, [])
  return (
    <div className="space-y-2">
      <Textarea
        ref={ref}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          e.target.style.height = 'auto'
          e.target.style.height = `${Math.min(480, e.target.scrollHeight + 4)}px`
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onSave(text)
        }}
        className="font-chat min-h-24 text-[length:var(--chat-font-size)]"
        aria-label="Edit message"
      />
      <div className="flex justify-end gap-2">
        <span className="mr-auto self-center text-[11px] text-muted-foreground">Ctrl+Enter to save · Esc to cancel</span>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => onSave(text)}>
          Save
        </Button>
      </div>
    </div>
  )
}

export const MessageItem = memo(function MessageItem(props: Props): React.JSX.Element {
  const { message: m, isLast, streamingText, streaming, busy } = props
  const [editing, setEditing] = useState(false)
  const rootRef = useRef<HTMLElement>(null)
  const ttsOn = useApp((s) => s.settings?.tts.enabled ?? false)
  // Hidden machine lines (<state>, <stats>…) are stripped when the reply is saved; hide them while it streams too.
  const text = streamingText !== undefined ? streamingText.replace(/<(state|stats)>[\s\S]*?(?:<\/\1>|$)/gi, '').trimEnd() : m.text
  const copy = (): void => void navigator.clipboard.writeText(m.text)
  // Right-click on simple rows (notes, rolls, images): copy or delete.
  const simpleMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    const selected = selectionWithin(e.currentTarget)
    void showMenu([
      { label: selected ? 'Copy selection' : 'Copy', run: () => void navigator.clipboard.writeText(selected || m.image?.prompt || m.text) },
      separator,
      { label: 'Delete', run: () => props.onDelete(m.id) }
    ])
  }

  if (m.role === 'system') {
    const canUndo = !!m.stateChanges?.length && !m.text.endsWith('(undone)')
    const undo = async (): Promise<void> => {
      const path = useChat.getState().session?.path
      if (!path) return
      try {
        useChat.setState({ session: await invoke('sessions:undoState', path, m.id) })
      } catch (err) {
        toast.error(err)
      }
    }
    return (
      <div onContextMenu={simpleMenu} className="group relative mx-auto flex max-w-2xl items-center justify-center gap-2 px-6 py-1 text-center text-xs text-muted-foreground">
        {m.hidden && <EyeOff className="size-3 shrink-0" aria-label="Hidden from the model" />}
        <span className="italic">
          <Markdown text={text} />
        </span>
        {canUndo && (
          <Button variant="outline" size="sm" className="h-6 px-2 text-[11px]" onClick={() => void undo()}>
            Undo
          </Button>
        )}
        <span className="absolute right-0 hidden group-hover:flex">
          <ActionButton label="Delete" onClick={() => props.onDelete(m.id)}>
            <Trash2 />
          </ActionButton>
        </span>
      </div>
    )
  }

  if (m.role === 'roll') {
    const fresh = m.createdAt ? Date.now() - Date.parse(m.createdAt) < 4000 : false
    return (
      <div onContextMenu={simpleMenu} className="group relative mx-auto flex max-w-2xl items-center justify-center gap-2 py-1">
        <div className="rounded-full border bg-card px-3 py-1.5 shadow-sm">
          {m.roll ? (
            <RollChips roll={m.roll} name={m.name} animate={fresh} />
          ) : (
            <span className="text-xs">
              {m.name && <span className="mr-2 font-semibold text-gold">{m.name}</span>}
              <Markdown text={text} />
            </span>
          )}
        </div>
        <span className="absolute right-0 hidden group-hover:flex">
          <ActionButton label="Delete" onClick={() => props.onDelete(m.id)}>
            <Trash2 />
          </ActionButton>
        </span>
      </div>
    )
  }

  if (m.role === 'image') {
    const file = m.image?.file
    const path = file && props.campaignPath ? joinVaultPath(props.campaignPath, 'Images', file) : null
    return (
      <figure onContextMenu={simpleMenu} className="group relative mx-auto max-w-2xl">
        {path ? (
          <button type="button" className="block w-full" onClick={() => useImages.setState({ lightbox: { path, prompt: m.image?.prompt, caption: m.name } })} aria-label={`View ${m.name ?? 'image'}`}>
            <img src={vaultUrl(path)} alt={m.image?.prompt ?? m.name ?? ''} className="w-full rounded-xl border shadow-card transition-opacity hover:opacity-95" loading="lazy" />
          </button>
        ) : (
          <Markdown text={text} campaignPath={props.campaignPath} />
        )}
        {m.name && <figcaption className="mt-1.5 text-center text-xs text-muted-foreground italic">{m.name}</figcaption>}
        <span className="absolute top-2 right-2 hidden rounded-md bg-background/80 group-hover:flex">
          <ActionButton label="Delete" onClick={() => props.onDelete(m.id)}>
            <Trash2 />
          </ActionButton>
        </span>
      </figure>
    )
  }

  const isDm = m.role === 'dm'
  const isAi = props.aiRoles.includes(m.role)
  const onContextMenu = (e: React.MouseEvent): void => {
    if (editing) return // the text box gets the normal edit menu
    e.preventDefault()
    const selected = selectionWithin(rootRef.current)
    void showMenu([
      { label: selected ? 'Copy selection' : 'Copy', run: () => void navigator.clipboard.writeText(selected || m.text) },
      !streaming && { label: 'Edit', run: () => setEditing(true) },
      ttsOn && !!m.text.trim() && { label: 'Read aloud', run: () => speak(m.text).catch((err) => toast.error(err)) },
      separator,
      isAi && m.swipes.length > 1 && { label: 'Previous reply', accelerator: 'Alt+Left', enabled: m.swipeIndex > 0 && !busy, run: () => props.onSwipe(m.id, -1) },
      isAi && m.swipes.length > 1 && { label: 'Next reply', accelerator: 'Alt+Right', enabled: !busy, run: () => props.onSwipe(m.id, 1) },
      isAi && isLast && { label: 'Regenerate', accelerator: 'Ctrl+R', enabled: !busy, run: props.onRegenerate },
      isAi && isLast && { label: 'Continue', enabled: !busy, run: props.onContinue },
      isDm && props.onImage && { label: 'Illustrate this', run: () => props.onImage?.(m) },
      separator,
      { label: 'Fork session from here', run: () => props.onFork(m.id) },
      { label: 'Delete', run: () => props.onDelete(m.id) }
    ])
  }
  // Double-click your own messages to edit them.
  const onDoubleClick = (): void => {
    if (!isAi && !editing && !streaming && mouseShortcutsOn()) setEditing(true)
  }
  const actions = (
    <div
      className={cn(
        'flex items-center gap-0.5 rounded-lg border bg-popover/95 p-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-within:opacity-100',
        busy && 'pointer-events-none'
      )}
    >
      {isAi && m.swipes.length > 1 && (
        <span className="flex items-center">
          <ActionButton label="Previous reply (Alt+←)" onClick={() => props.onSwipe(m.id, -1)} disabled={m.swipeIndex === 0}>
            <ChevronLeft />
          </ActionButton>
          <span className="px-1 text-[11px] tabular-nums text-muted-foreground">
            {m.swipeIndex + 1}/{m.swipes.length}
          </span>
          <ActionButton label="Next reply (Alt+→)" onClick={() => props.onSwipe(m.id, 1)}>
            <ChevronRight />
          </ActionButton>
        </span>
      )}
      {isAi && isLast && (
        <>
          <ActionButton label="Regenerate (Ctrl+R)" onClick={props.onRegenerate}>
            <RefreshCw />
          </ActionButton>
          <ActionButton label="Continue" onClick={props.onContinue}>
            <FastForward />
          </ActionButton>
        </>
      )}
      {isDm && props.onImage && (
        <ActionButton label="Illustrate this" onClick={() => props.onImage?.(m)}>
          <Camera />
        </ActionButton>
      )}
      <ActionButton label="Edit" onClick={() => setEditing(true)}>
        <Pencil />
      </ActionButton>
      {ttsOn && !!m.text.trim() && (
        <ActionButton label="Read aloud" onClick={() => speak(m.text).catch((err) => toast.error(err))}>
          <Volume2 />
        </ActionButton>
      )}
      <ActionButton label="Copy" onClick={copy}>
        <Copy />
      </ActionButton>
      <ActionButton label="Fork session from here" onClick={() => props.onFork(m.id)}>
        <GitBranch />
      </ActionButton>
      <ActionButton label="Delete" onClick={() => props.onDelete(m.id)}>
        <Trash2 />
      </ActionButton>
    </div>
  )

  const body = editing ? (
    <Editor
      initial={m.text}
      onCancel={() => setEditing(false)}
      onSave={(t) => {
        setEditing(false)
        if (t !== m.text) props.onEdit(m.id, t)
      }}
    />
  ) : (
    <div className={cn('chat-prose', isDm && props.dropCap && 'drop-cap')}>
      <Markdown text={text || (streaming ? '' : '*(empty)*')} campaignPath={props.campaignPath} onCheck={isDm ? props.onCheck : undefined} />
      {streaming && <span className="streaming-caret" aria-hidden />}
    </div>
  )

  if (isDm) {
    return (
      <motion.article
        ref={rootRef}
        initial={streaming ? { opacity: 0, y: 6 } : false}
        animate={{ opacity: 1, y: 0 }}
        className="group relative mx-auto flex w-full max-w-3xl gap-3"
        aria-label="Dungeon Master"
        onContextMenu={onContextMenu}
        onDoubleClick={onDoubleClick}
      >
        <div className="pt-1">
          <span className="grid size-9 place-items-center rounded-full border border-gold/40 bg-surface-2 text-gold">
            <Logo className="size-5" />
          </span>
        </div>
        <div className="paper min-w-0 flex-1 rounded-xl rounded-tl-sm border bg-page px-5 py-4 shadow-card">
          <div className="font-chat text-parchment">{body}</div>
          <Decorations id={m.id} />
          {m.model && !streaming && <p className="mt-2 text-right text-[10px] text-muted-foreground/70">{m.model}</p>}
        </div>
        {!editing && !streaming && <div className="absolute -top-3 right-3">{actions}</div>}
      </motion.article>
    )
  }

  // Player: whoever wrote it (you, a companion, a player at the table) gets their portrait.
  return (
    <motion.article
      ref={rootRef}
      initial={streaming ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      className="group relative ml-auto flex max-w-[82%] items-start gap-2.5"
      aria-label={m.name ?? 'Player'}
      onContextMenu={onContextMenu}
      onDoubleClick={onDoubleClick}
    >
      <div className="flex min-w-0 flex-col items-end">
      {m.name && (
        <span className="mb-1 mr-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          {m.name}
          {isAi && <span className="rounded bg-muted px-1 text-[9px] tracking-wide uppercase">AI</span>}
        </span>
      )}
      <div
        className={cn(
          'rounded-2xl rounded-br-md border border-primary/30 bg-primary/12 px-4 py-2.5 text-foreground',
          editing && 'w-[min(640px,70vw)]'
        )}
      >
        <div className="font-chat text-[length:calc(var(--chat-font-size)*0.95)]">{body}</div>
      </div>
      </div>
      {m.name && <SpeakerPortrait name={m.name} fallbackAvatar={m.name === props.characterName ? props.characterAvatar : undefined} />}
      {!editing && !streaming && <div className="absolute -top-3 right-12">{actions}</div>}
    </motion.article>
  )
})

/** The portrait of the character or NPC a message is from, found by name (initials when there's no picture). */
function SpeakerPortrait({ name, fallbackAvatar }: { name: string; fallbackAvatar?: string }): React.JSX.Element {
  const who = useVault((s) => {
    const key = name.trim().toLowerCase()
    return [...(s.index?.characters ?? []), ...(s.index?.npcs ?? [])].find((c) => c.displayName.toLowerCase() === key || c.name.toLowerCase() === key)
  })
  return (
    <div className="mt-5 shrink-0">
      <CharacterAvatar name={name} avatar={who?.avatar ?? fallbackAvatar} version={who?.mtimeMs} size={36} />
    </div>
  )
}
