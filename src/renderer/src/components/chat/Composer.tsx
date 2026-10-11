import { useEffect, useMemo, useRef, useState } from 'react'
import { Dices, SendHorizontal, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'
import { DiceTray } from '@/components/dice/DiceTray'
import { matchCommands, runCommand } from '@/lib/commands'
import '@/lib/dnd-commands'
import '@/lib/image-commands'
import { useDiceFx } from '@/stores/dice'
import { cn } from '@/lib/utils'
import { useChat } from '@/stores/chat'
import { useUi } from '@/stores/ui'

const DRAFT_KEY = (path: string): string => `dnd-tavern:draft:${path}`

export function Composer(): React.JSX.Element {
  const session = useChat((s) => s.session)
  const streaming = useChat((s) => s.streaming)
  const send = useChat((s) => s.send)
  const stop = useChat((s) => s.stop)
  const trayOpen = useDiceFx((s) => s.trayOpen)
  const [text, setText] = useState('')
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLTextAreaElement>(null)
  const prefill = useUi((s) => s.composerPrefill)

  useEffect(() => {
    if (!prefill) return
    setText(prefill.text)
    requestAnimationFrame(() => {
      const el = ref.current
      el?.focus()
      el?.setSelectionRange(prefill.text.length, prefill.text.length)
    })
  }, [prefill])

  // Unsent drafts survive switching sessions (browser storage: convenience only).
  useEffect(() => {
    if (!session) return
    try {
      setText(localStorage.getItem(DRAFT_KEY(session.path)) ?? '')
    } catch {
      setText('')
    }
    ref.current?.focus()
  }, [session?.path]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!session) return
    try {
      if (text) localStorage.setItem(DRAFT_KEY(session.path), text)
      else localStorage.removeItem(DRAFT_KEY(session.path))
    } catch {
      /* ignore */
    }
    const el = ref.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = `${Math.min(200, el.scrollHeight)}px`
    }
  }, [text, session])

  const suggestions = useMemo(() => matchCommands(text), [text])
  useEffect(() => setActive(0), [suggestions.length])

  const submit = async (): Promise<void> => {
    if (!session || streaming) return
    const value = text.trim()
    if (value.startsWith('/')) {
      setText('')
      await runCommand(value, session)
      return
    }
    setText('')
    // Empty Enter asks the DM to go on (like SillyTavern).
    await send(value)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (suggestions.length && !text.includes(' ')) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length)
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && suggestions[active] && text.trim() !== `/${suggestions[active]!.name}`)) {
        e.preventDefault()
        setText(`/${suggestions[active]!.name} `)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <div className="relative border-t p-3">
      <DiceTray />
      {suggestions.length > 0 && !text.includes(' ') && (
        <ul
          role="listbox"
          aria-label="Commands"
          className="absolute right-3 bottom-full left-3 mx-auto mb-1 max-h-72 max-w-3xl overflow-y-auto rounded-lg border bg-popover p-1 shadow-card"
        >
          {suggestions.map((c, i) => (
            <li key={c.name}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => {
                  setText(`/${c.name} `)
                  ref.current?.focus()
                }}
                className={cn('flex w-full items-baseline gap-3 rounded-md px-2.5 py-1.5 text-left text-sm', i === active && 'bg-accent')}
              >
                <code className="shrink-0 font-mono text-[13px] text-gold">{c.usage}</code>
                <span className="truncate text-xs text-muted-foreground">{c.description}</span>
                {c.source && <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{c.source}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-xl border bg-card p-2 shadow-card focus-within:border-ring">
        <Tip label="Dice tray">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open dice tray"
            aria-expanded={trayOpen}
            onClick={() => useDiceFx.getState().setTrayOpen(!trayOpen)}
          >
            <Dices />
          </Button>
        </Tip>
        <textarea
          ref={ref}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={streaming ? 'The DM is writing…' : 'What do you do?  (/ for commands)'}
          aria-label="Message"
          className="max-h-[200px] min-h-9 flex-1 resize-none bg-transparent py-2 font-chat text-[length:var(--chat-font-size)] leading-snug placeholder:text-muted-foreground focus-visible:outline-none"
        />
        {streaming ? (
          <Tip label="Stop (Esc)">
            <Button size="icon" variant="secondary" aria-label="Stop generating" onClick={() => void stop()}>
              <Square className="fill-current" />
            </Button>
          </Tip>
        ) : (
          <Tip label={text.trim() ? 'Send (Enter)' : 'Let the DM continue (Enter)'}>
            <Button size="icon" aria-label="Send message" onClick={() => void submit()} disabled={!session}>
              <SendHorizontal />
            </Button>
          </Tip>
        )}
      </div>
    </div>
  )
}
