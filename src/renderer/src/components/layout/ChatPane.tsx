import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Circle, Cpu, FolderOpen } from 'lucide-react'
import type { Message } from '@shared/types'
import { ChatHeader } from '@/components/chat/ChatHeader'
import { Composer } from '@/components/chat/Composer'
import { ChatSkeleton } from '@/components/ui/skeleton'
import { MessageList } from '@/components/chat/MessageList'
import type { MessageActions } from '@/components/chat/MessageItem'
import { CreateCampaignPanel, NewSessionPanel } from '@/components/chat/StartPanels'
import { EmptyState } from '@/components/EmptyState'
import { LanternArt } from '@/components/illustrations'
import { Button } from '@/components/ui/button'
import { invoke } from '@/lib/ipc'
import { rollCheckFor } from '@/lib/rolls'
import { toast } from '@/stores/toasts'
import { useImages } from '@/stores/images'
import { ImageJobs } from '@/components/images/ImagesPanel'
import { cn } from '@/lib/utils'
import { useApp } from '@/stores/app'
import { useChat } from '@/stores/chat'
import { useUi } from '@/stores/ui'
import { useVault } from '@/stores/vault'

/** Optional features plugged in by later modules (image generation). */
export interface ChatExtras {
  onImage?: (m: Message) => void
}

export const chatExtras: ChatExtras = {}

function SetupItem({ done, label, optional }: { done: boolean; label: string; optional?: boolean }): React.JSX.Element {
  return (
    <li className="flex items-center gap-2.5 text-sm">
      {done ? <Check className="size-4 text-emerald" aria-label="Done" /> : <Circle className="size-4 text-muted-foreground/60" aria-label="Not done" />}
      <span className={cn(done ? 'text-foreground' : 'text-muted-foreground')}>{label}</span>
      {optional && <span className="text-[11px] text-muted-foreground/80">(optional)</span>}
    </li>
  )
}

function SetupState(): React.JSX.Element {
  const settings = useApp((s) => s.settings)
  const index = useVault((s) => s.index)
  const openSettings = useUi((s) => s.openSettings)
  const hasText = (settings?.textBackends.length ?? 0) > 0
  const vaultMissing = !!settings?.vault.path && !index
  return (
    <EmptyState
      size="lg"
      illustration={<LanternArt />}
      title="The tavern is quiet"
      description={vaultMissing ? `The vault at ${settings?.vault.path} could not be opened.` : 'Connect an Obsidian vault and a text backend to begin.'}
      action={
        <div className="space-y-4">
          <ul className="mt-2 space-y-2 rounded-lg border bg-card/70 px-5 py-4 text-left shadow-card">
            <SetupItem done={!!index} label={index ? `Vault: ${index.vaultName}` : 'Obsidian vault connected'} />
            <SetupItem done={hasText} label="Text backend configured" />
            <SetupItem done={(settings?.imageBackends.length ?? 0) > 0} label="Image backend configured" optional />
          </ul>
          <div className="flex justify-center gap-2">
            {!index && (
              <Button onClick={() => openSettings('general')}>
                <FolderOpen /> Choose vault
              </Button>
            )}
            {!hasText && (
              <Button variant={index ? 'default' : 'outline'} onClick={() => openSettings('text')}>
                <Cpu /> Add text backend
              </Button>
            )}
          </div>
        </div>
      }
    />
  )
}

function useDelayedFlag(value: boolean, ms: number): boolean {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!value) {
      setShown(false)
      return
    }
    const t = setTimeout(() => setShown(true), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return value && shown
}

export function ChatPane(): React.JSX.Element {
  const index = useVault((s) => s.index)
  const loaded = useVault((s) => s.loaded)
  const activeCampaign = useVault((s) => s.activeCampaign)
  const selectedSession = useVault((s) => s.selectedSession)
  const selectSession = useVault((s) => s.selectSession)
  const session = useChat((s) => s.session)
  // Only show the skeleton if opening takes long enough to notice (no flicker on fast loads).
  const opening = useDelayedFlag(useChat((s) => s.loading && s.session?.path !== selectedSession), 150)
  const isStreaming = useChat((s) => s.streaming !== null)
  const hasText = useApp((s) => (s.settings?.textBackends.length ?? 0) > 0)
  const creatingCampaign = useUi((s) => s.creatingCampaign)
  const hasImage = useApp((s) => (s.settings?.imageBackends.length ?? 0) > 0)

  // Leaving a session ends it: the main process compresses it into a recap
  // (when "Compress finished sessions" is on).
  const previousSession = useRef<string | null>(null)
  useEffect(() => {
    const prev = previousSession.current
    previousSession.current = selectedSession
    if (prev && prev !== selectedSession) void invoke('sessions:compress', prev).catch(() => {})
    void useChat.getState().open(selectedSession)
  }, [selectedSession])

  // The session's character, from the index (for avatar and HP ring).
  const characterLink = session?.frontmatter.characters[0] ?? ''
  const character = useMemo(() => {
    if (!index || !characterLink) return null
    const target = characterLink.replace(/^\[\[|\]\]$/g, '').split('|')[0]!.replace(/\.md$/i, '')
    return index.characters.concat(index.npcs).find((c) => c.path.replace(/\.md$/i, '') === target || c.name === target) ?? null
  }, [index, characterLink])

  // Keyboard: Ctrl+R regenerate, Esc stop, Alt+←/→ switch swipes.
  const lastDm = session ? [...session.messages].reverse().find((m) => m.role === 'dm') : undefined
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      const chat = useChat.getState()
      if (!session || useUi.getState().settingsOpen) return
      if (e.key === 'Escape' && isStreaming) {
        e.preventDefault()
        void chat.stop()
      } else if ((e.key === 'r' || e.key === 'R') && e.ctrlKey && !e.shiftKey) {
        e.preventDefault()
        void chat.regenerate()
      } else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && lastDm) {
        e.preventDefault()
        void chat.swipe(lastDm.id, e.key === 'ArrowLeft' ? -1 : 1)
      }
    },
    [session, isStreaming, lastDm]
  )
  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onKey])

  // Stable callbacks so memoised messages don't re-render on every token.
  const actions = useMemo<MessageActions>(() => {
    const chat = useChat.getState
    return {
      onSwipe: (id, dir) => void chat().swipe(id, dir),
      onRegenerate: () => void chat().regenerate(),
      onContinue: () => void chat().continueReply(),
      onEdit: (id, text) => void chat().edit(id, { text }),
      onDelete: (id) => void chat().remove(id),
      onFork: (id) => void chat().fork(id).then((s) => s && selectSession(s.path)),
      onCheck: (ability, dc) => void rollCheckFor(ability, dc, { continueAfter: true }).catch((e) => toast.error(e)),
      onImage: hasImage
        ? (m) => {
            const session = useChat.getState().session
            if (session) void useImages.getState().generate({ sessionPath: session.path, kind: 'scene', messageId: m.id })
          }
        : undefined
    }
  }, [selectSession, hasImage])

  let content: React.ReactNode
  if (!loaded || (opening && selectedSession)) content = <ChatSkeleton />
  else if (!index || !hasText) content = <SetupState />
  else if (index.campaigns.length === 0 || creatingCampaign) content = <CreateCampaignPanel />
  else if (!session) content = <NewSessionPanel key={activeCampaign} />
  else
    content = (
      <>
        <ChatHeader character={character} onInspect={() => useUi.setState({ inspectorOpen: true })} />
        <MessageList characterName={character?.displayName} characterAvatar={character?.avatar} actions={actions} />
        <div className="mx-auto w-full max-w-3xl px-6 empty:hidden">
          <ImageJobs />
        </div>
        <Composer />
      </>
    )

  return (
    <section className="flex h-full min-w-0 flex-col" aria-label="Chat">
      {(session && !creatingCampaign) || !loaded || opening || !index || !hasText || index.campaigns.length === 0 || creatingCampaign ? content : <div className="min-h-0 flex-1 overflow-y-auto">{content}</div>}
    </section>
  )
}
