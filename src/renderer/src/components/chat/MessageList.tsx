import { useEffect, useLayoutEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import type { Message } from '@shared/types'
import { Logo } from '@/components/Logo'
import { aiSpeakers, playModeOf } from '@shared/play'
import { cn } from '@/lib/utils'
import { useChat } from '@/stores/chat'
import { MessageItem, type MessageActions } from './MessageItem'
import { PreviouslyCard } from './PreviouslyCard'

function isSceneStart(messages: Message[], i: number): boolean {
  const m = messages[i]!
  if (m.role !== 'dm') return false
  if (/^\s*(#{1,3}\s|\*\*\*|---)/.test(m.text)) return true
  for (let j = i - 1; j >= 0; j--) {
    const prev = messages[j]!
    if (prev.role === 'dm') return false
    if (prev.role === 'system' && /scene|chapter|later|meanwhile|next day/i.test(prev.text)) return true
  }
  return true // first DM message of the session
}

function Thinking({ backendName, asPlayer }: { backendName: string; asPlayer?: string }): React.JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('mx-auto flex w-full max-w-3xl gap-3', asPlayer && 'flex-row-reverse')}
      role="status"
      aria-label={asPlayer ? `${asPlayer} is writing` : 'The DM is writing'}
    >
      <span className="grid size-9 place-items-center rounded-full border border-gold/40 bg-surface-2 text-gold">
        <Logo className="size-5 animate-pulse" />
      </span>
      <div className="paper flex items-center gap-2 rounded-xl rounded-tl-sm border bg-page px-5 py-4 text-sm text-muted-foreground shadow-card">
        <span className="flex gap-1" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-1.5 animate-bounce rounded-full bg-gold" style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </span>
        {asPlayer ? `${asPlayer} is thinking…` : backendName ? `${backendName} is thinking…` : 'Thinking…'}
      </div>
    </motion.div>
  )
}

export function MessageList({
  characterName,
  characterAvatar,
  actions
}: {
  characterName?: string
  characterAvatar?: string
  actions: MessageActions
}): React.JSX.Element {
  const session = useChat((s) => s.session)!
  const streaming = useChat((s) => s.streaming)
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  const messages = session.messages
  const aiRoles = aiSpeakers(playModeOf(session.frontmatter))
  const streamRole = streaming?.speaker ?? 'dm'
  const streamTarget = streaming?.messageId ? messages.find((m) => m.id === streaming.messageId) : undefined
  const showNew = streaming && (streaming.kind === 'new' || !streaming.messageId) && !streamTarget

  // Stick to the bottom while new text arrives, unless the user scrolled up.
  const onScroll = (): void => {
    const el = scroller.current
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [messages.length, streaming?.text, showNew])
  // Images load after layout; keep the view pinned to the bottom as they grow.
  // (load doesn't bubble, so listen in the capture phase.)
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onLoad = (): void => {
      if (pinned.current) el.scrollTop = el.scrollHeight
    }
    el.addEventListener('load', onLoad, true)
    return () => el.removeEventListener('load', onLoad, true)
  }, [])

  useEffect(() => {
    pinned.current = true
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [session.path])

  const lastId = messages[messages.length - 1]?.id
  const busy = !!streaming

  return (
    <div
      ref={scroller}
      onScroll={onScroll}
      className="min-h-0 flex-1 overflow-y-auto px-6 py-6"
      aria-live="polite"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <PreviouslyCard sessionPath={session.path} campaignPath={session.campaignPath} />
        {messages.length === 0 && !streaming && (
          <p className="py-16 text-center font-serif text-lg text-muted-foreground italic">
            The page is blank. Describe what your character does, or press Enter to let the DM set the scene.
          </p>
        )}
        {messages.map((m, i) => {
          let streamingText: string | undefined
          if (streaming && streamTarget?.id === m.id) {
            if (streaming.kind === 'swipe') streamingText = streaming.text
            else if (streaming.kind === 'continue') streamingText = m.text + (streaming.text && !/^\s/.test(streaming.text) ? ' ' : '') + streaming.text
          }
          return (
            <MessageItem
              key={m.id}
              message={m}
              isLast={m.id === lastId}
              streamingText={streamingText}
              streaming={streamingText !== undefined}
              busy={busy}
              dropCap={isSceneStart(messages, i)}
              characterName={characterName}
              characterAvatar={characterAvatar}
              campaignPath={session.campaignPath}
              aiRoles={aiRoles}
              {...actions}
            />
          )
        })}
        {showNew &&
          (streaming.text ? (
            <MessageItem
              message={{ id: '__streaming', role: streamRole, name: streamRole === 'player' ? streaming.speakerName : undefined, text: '', swipes: [''], swipeIndex: 0, createdAt: '' }}
              isLast
              streamingText={streaming.text}
              streaming
              busy
              dropCap={!messages.some((m) => m.role === 'dm')}
              characterName={characterName}
              characterAvatar={characterAvatar}
              campaignPath={session.campaignPath}
              aiRoles={aiRoles}
              {...actions}
            />
          ) : (
            <Thinking backendName={streaming.backendName} asPlayer={streaming.speaker === 'player' ? streaming.speakerName || characterName : undefined} />
          ))}
      </div>
    </div>
  )
}
