import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { ArrowDownCircle, BookOpenText, Cpu, ImageIcon, Palette, Puzzle, Settings2, Shield, Volume2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useUi, type SettingsSection } from '@/stores/ui'
import { AppearanceSection, GeneralSection, SecuritySection } from './sections'
import { ExtensionsSection } from '@/components/extensions/ExtensionsUi'
import { ImageBackendsSection } from './ImageBackendsSection'
import { PromptSection } from './PromptSection'
import { TtsSection } from './TtsSection'
import { TextBackendsSection } from './TextBackendsSection'
import { WorldOverridesNotice } from './WorldOverridesNotice'
import { UpdatesSettings, useUpdates } from '@/components/Updates'
import { useApp } from '@/stores/app'

const NAV: { id: SettingsSection; label: string; icon: React.ElementType; description: string }[] = [
  { id: 'general', label: 'General', icon: Settings2, description: 'Vault, player and behaviour' },
  { id: 'updates', label: 'Updates', icon: ArrowDownCircle, description: 'Get the newest version of DND Tavern' },
  { id: 'appearance', label: 'Appearance', icon: Palette, description: 'Theme, scale and motion' },
  { id: 'text', label: 'Text backends', icon: Cpu, description: 'LLMs for the DM, summaries and prompts' },
  { id: 'images', label: 'Image backends', icon: ImageIcon, description: 'ComfyUI, Automatic1111 and more' },
  { id: 'prompt', label: 'Prompt', icon: BookOpenText, description: 'Block order, context and memory' },
  { id: 'tts', label: 'Speech', icon: Volume2, description: 'Read replies aloud' },
  { id: 'security', label: 'Security', icon: Shield, description: 'Connections, keys, export' },
  { id: 'extensions', label: 'Extensions', icon: Puzzle, description: 'Optional add-ons' }
]

/** Full-screen settings with a left-hand nav. Esc closes it. */
export function SettingsOverlay(): React.JSX.Element {
  const section = useUi((s) => s.settingsSection)
  const close = useUi((s) => s.closeSettings)
  const current = NAV.find((n) => n.id === section)!
  const userDataPath = useApp((s) => s.info?.userDataPath) ?? 'the app’s data folder'
  const updateWaiting = useUpdates((s) => s.status.state === 'available' || s.status.state === 'ready')

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !document.querySelector('[data-radix-popper-content-wrapper]')) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.99 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.99 }}
      transition={{ duration: 0.16 }}
      className="absolute inset-x-0 top-10 bottom-0 z-30 flex bg-background"
      role="dialog"
      aria-modal
      aria-label="Settings"
    >
      <nav className="pane flex w-60 shrink-0 flex-col border-r p-3" aria-label="Settings sections">
        <h2 className="px-2 pt-2 pb-4 font-display text-lg font-semibold tracking-wide">Settings</h2>
        <ul className="space-y-0.5">
          {NAV.map(({ id, label, icon: Icon }) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => useUi.setState({ settingsSection: id })}
                aria-current={section === id ? 'page' : undefined}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent',
                  section === id ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground'
                )}
              >
                <Icon className={cn('size-4', section === id && 'text-gold')} />
                {label}
                {id === 'updates' && updateWaiting && <span className="ml-auto size-2 rounded-full bg-gold" aria-label="Update available" />}
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-auto px-2 text-[11px] leading-relaxed text-muted-foreground">
          Settings are stored in <span className="selectable break-all">{userDataPath}</span>, outside your vault.
        </p>
      </nav>

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-8 py-8">
          <header className="mb-6 flex items-start justify-between">
            <div>
              <h1 className="font-display text-2xl font-semibold tracking-wide">{current.label}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{current.description}</p>
            </div>
            <Button variant="ghost" size="icon" aria-label="Close settings" onClick={close}>
              <X />
            </Button>
          </header>
          {section === 'text' && <WorldOverridesNotice groups={['text']} />}
          {section === 'images' && <WorldOverridesNotice groups={['images', 'triggers']} />}
          {section === 'prompt' && <WorldOverridesNotice groups={['prompt']} />}
          {section === 'general' && <GeneralSection />}
          {section === 'updates' && <UpdatesSettings />}
          {section === 'appearance' && <AppearanceSection />}
          {section === 'text' && <TextBackendsSection />}
          {section === 'images' && <ImageBackendsSection />}
          {section === 'prompt' && <PromptSection />}
          {section === 'tts' && <TtsSection />}
          {section === 'security' && <SecuritySection />}
          {section === 'extensions' && <ExtensionsSection />}
        </div>
      </div>
    </motion.div>
  )
}
