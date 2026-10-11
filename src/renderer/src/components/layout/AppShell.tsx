import { useEffect } from 'react'
import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
  usePanelRef,
  type PanelImperativeHandle
} from 'react-resizable-panels'
import { cn } from '@/lib/utils'
import { useLayout } from '@/stores/layout'
import { ChatPane } from './ChatPane'
import { LeftSidebar } from './LeftSidebar'
import { RightPanel } from './RightPanel'

/** Keeps a collapsible panel in sync with a boolean in the layout store. */
function useCollapseSync(ref: React.RefObject<PanelImperativeHandle | null>, collapsed: boolean): void {
  useEffect(() => {
    const panel = ref.current
    if (!panel) return
    if (collapsed && !panel.isCollapsed()) panel.collapse()
    if (!collapsed && panel.isCollapsed()) panel.expand()
  }, [ref, collapsed])
}

function ResizeHandle(): React.JSX.Element {
  return (
    <Separator
      className={cn(
        'group relative w-px bg-border outline-none',
        'after:absolute after:inset-y-0 after:-left-1 after:-right-1 after:content-[""]',
        'data-[separator=active]:bg-primary data-[separator=hover]:bg-primary/60 focus-visible:bg-primary'
      )}
    />
  )
}

export function AppShell(): React.JSX.Element {
  const leftRef = usePanelRef()
  const rightRef = usePanelRef()
  const { leftCollapsed, rightCollapsed, setLeftCollapsed, setRightCollapsed } = useLayout()
  const layout = useDefaultLayout({ id: 'main-layout', storage: safeStorage() })

  useCollapseSync(leftRef, leftCollapsed)
  useCollapseSync(rightRef, rightCollapsed)

  return (
    <Group
      orientation="horizontal"
      className="min-h-0 flex-1"
      defaultLayout={layout.defaultLayout}
      onLayoutChanged={layout.onLayoutChanged}
    >
      <Panel
        id="left"
        panelRef={leftRef}
        defaultSize={280}
        minSize={220}
        maxSize={420}
        collapsible
        collapsedSize={0}
        groupResizeBehavior="preserve-pixel-size"
        onResize={() => setLeftCollapsed(!!leftRef.current?.isCollapsed())}
        className="pane h-full"
      >
        <LeftSidebar />
      </Panel>
      <ResizeHandle />
      <Panel id="center" minSize={420} className="h-full">
        <ChatPane />
      </Panel>
      <ResizeHandle />
      <Panel
        id="right"
        panelRef={rightRef}
        defaultSize={340}
        minSize={280}
        maxSize={560}
        collapsible
        collapsedSize={0}
        groupResizeBehavior="preserve-pixel-size"
        onResize={() => setRightCollapsed(!!rightRef.current?.isCollapsed())}
        className="pane h-full"
      >
        <RightPanel />
      </Panel>
    </Group>
  )
}

/** localStorage can throw (e.g. disabled storage); layout memory is a convenience only. */
function safeStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  return {
    getItem: (k) => {
      try {
        return localStorage.getItem(k)
      } catch {
        return null
      }
    },
    setItem: (k, v) => {
      try {
        localStorage.setItem(k, v)
      } catch {
        /* ignore */
      }
    }
  }
}
