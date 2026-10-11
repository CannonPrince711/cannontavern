import { BookOpen, Image, Network, Puzzle, ScrollText, Swords, Users } from 'lucide-react'
import { TablePanel } from '@/components/table/TablePanel'
import { GraphPanel } from '@/components/graph/GraphView'
import { EmptyState } from '@/components/EmptyState'
import { BookArt, FrameArt, HoodArt, RuneArt, SwordsArt } from '@/components/illustrations'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tip } from '@/components/ui/tooltip'
import { useLayout, type RightTab } from '@/stores/layout'
import { LorePanel } from '@/components/lore/LorePanel'
import { CombatPanel } from '@/components/sheet/CombatPanel'
import { ImagesPanel } from '@/components/images/ImagesPanel'
import { ExtensionsPanel } from '@/components/extensions/ExtensionsUi'
import { SheetPanel } from '@/components/sheet/SheetPanel'

const TABS: { id: RightTab; label: string; icon: React.ElementType; art: React.ReactNode; title: string; text: string }[] = [
  {
    id: 'sheet',
    label: 'Sheet',
    icon: ScrollText,
    art: <HoodArt />,
    title: 'No character selected',
    text: 'The D&D sheet of the active character appears here and is saved to its note.'
  },
  {
    id: 'combat',
    label: 'Combat',
    icon: Swords,
    art: <SwordsArt />,
    title: 'No fight in progress',
    text: 'Add combatants with /add Goblin hp 7 ac 15 init +2, then roll initiative.'
  },
  {
    id: 'lore',
    label: 'Lore',
    icon: BookOpen,
    art: <BookArt />,
    title: 'No lorebooks',
    text: 'Lorebook entries triggered by the conversation will be listed here.'
  },
  {
    id: 'images',
    label: 'Images',
    icon: Image,
    art: <FrameArt />,
    title: 'No images yet',
    text: 'Generated portraits and scenes are saved to the campaign’s Images folder.'
  },
  {
    id: 'graph',
    label: 'Graph',
    icon: Network,
    art: <RuneArt />,
    title: 'No notes yet',
    text: 'Your notes and the links between them.'
  },
  {
    id: 'table',
    label: 'Table',
    icon: Users,
    art: <RuneArt />,
    title: 'Play together',
    text: 'Host the session for other players.'
  },
  {
    id: 'extensions',
    label: 'Extensions',
    icon: Puzzle,
    art: <RuneArt />,
    title: 'No extensions enabled',
    text: 'Extensions are off by default. Enable them in Settings to add panels here.'
  }
]

export function RightPanel(): React.JSX.Element {
  const { rightTab, setRightTab } = useLayout()
  return (
    <Tabs
      value={rightTab}
      onValueChange={(v) => setRightTab(v as RightTab)}
      className="@container flex h-full min-w-0 flex-col"
      aria-label="Side panels"
    >
      <div className="border-b p-2">
        <TabsList className="w-full">
          {TABS.map(({ id, label, icon: Icon }) => (
            <Tip key={id} label={label}>
              <TabsTrigger value={id} aria-label={label}>
                <Icon />
                <span className="hidden @min-[440px]:inline">{label}</span>
              </TabsTrigger>
            </Tip>
          ))}
        </TabsList>
      </div>
      {TABS.map((t) => (
        <TabsContent key={t.id} value={t.id} className="min-h-0 overflow-y-auto">
          {t.id === 'lore' ? (
            <LorePanel />
          ) : t.id === 'sheet' ? (
            <SheetPanel />
          ) : t.id === 'combat' ? (
            <CombatPanel />
          ) : t.id === 'images' ? (
            <ImagesPanel />
          ) : t.id === 'graph' ? (
            <GraphPanel />
          ) : t.id === 'table' ? (
            <TablePanel />
          ) : t.id === 'extensions' ? (
            <ExtensionsPanel />
          ) : (
            <EmptyState illustration={t.art} title={t.title} description={t.text} className="pt-16" />
          )}
        </TabsContent>
      ))}
    </Tabs>
  )
}
