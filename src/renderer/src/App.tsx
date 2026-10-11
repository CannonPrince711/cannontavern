import { useEffect, useState } from 'react'
import { AnimatePresence, MotionConfig } from 'framer-motion'
import { AppShell } from '@/components/layout/AppShell'
import { TitleBar } from '@/components/TitleBar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppearance, useReducedMotion } from '@/hooks/useAppearance'
import { AskDialog } from '@/components/AskDialog'
import { CharacterEditor } from '@/components/characters/CharacterEditor'
import { CampaignBuilder } from '@/components/builder/CampaignBuilder'
import { GraphOverlay } from '@/components/graph/GraphView'
import { MapOverlay } from '@/components/map/MapView'
import { CommandPalette } from '@/components/CommandPalette'
import { DiceOverlay } from '@/components/dice/DiceOverlay'
import { Lightbox } from '@/components/images/Lightbox'
import { ExtensionWorkers } from '@/components/extensions/ExtensionsUi'
import { LorebookEditor } from '@/components/lore/LorebookEditor'
import { PromptInspector } from '@/components/chat/PromptInspector'
import { SettingsOverlay } from '@/components/settings/SettingsOverlay'
import { Toaster } from '@/components/Toaster'
import { Wizard } from '@/components/wizard/Wizard'
import { initAutoplay } from '@/lib/play'
import { initMouseShortcuts } from '@/lib/mouse'
import { useUpdatesSync } from '@/components/Updates'
import { useApp } from '@/stores/app'
import { useChat } from '@/stores/chat'
import { useImages } from '@/stores/images'
import { useExtensions } from '@/stores/extensions'
import { subscribeMainToasts } from '@/stores/toasts'
import { useUi } from '@/stores/ui'
import { useVault } from '@/stores/vault'

function StartupError({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div className="max-w-md space-y-2">
        <h1 className="font-display text-lg">DND Tavern could not start</h1>
        <p className="selectable text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  )
}

export function App(): React.JSX.Element {
  const ready = useApp((s) => s.ready)
  const init = useApp((s) => s.init)
  const initVault = useVault((s) => s.init)
  const setupComplete = useApp((s) => s.settings?.setupComplete ?? true)
  const settingsOpen = useUi((s) => s.settingsOpen)
  const [error, setError] = useState<string | null>(null)
  const reduced = useReducedMotion()
  useAppearance()
  useUpdatesSync()

  useEffect(() => {
    let cleanup: (() => void) | undefined
    let cancelled = false
    const offToasts = subscribeMainToasts()
    const offChat = useChat.getState().init()
    const offImages = useImages.getState().init()
    const offAutoplay = initAutoplay()
    const offMouse = initMouseShortcuts()
    void useExtensions.getState().load()
    Promise.all([init(), initVault()])
      .then((offs) => {
        const off = (): void => offs.forEach((f) => f())
        if (cancelled) off()
        else cleanup = off
      })
      .catch((err: Error) => setError(err.message))
    return () => {
      cancelled = true
      offToasts()
      offChat()
      offImages()
      offAutoplay()
      offMouse()
      cleanup?.()
    }
  }, [init, initVault])

  return (
    <MotionConfig reducedMotion={reduced ? 'always' : 'never'}>
      <TooltipProvider delayDuration={400}>
        <div className="relative flex h-full flex-col">
          <TitleBar />
          {error ? <StartupError message={error} /> : ready ? <AppShell /> : <div className="flex-1" />}
          <AnimatePresence>{ready && settingsOpen && <SettingsOverlay />}</AnimatePresence>
          {ready && <CharacterEditor />}
          {ready && <PromptInspector />}
          {ready && <LorebookEditor />}
          {ready && <CampaignBuilder />}
          {ready && <GraphOverlay />}
          {ready && <MapOverlay />}
          <AskDialog />
          <DiceOverlay />
          <Lightbox />
          {ready && <ExtensionWorkers />}
          {ready && setupComplete && <CommandPalette />}
          {ready && !setupComplete && <Wizard />}
          <Toaster />
        </div>
      </TooltipProvider>
    </MotionConfig>
  )
}
