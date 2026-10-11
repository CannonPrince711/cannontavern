import { describe, expect, it } from 'vitest'
import { buildGraph, extractLinks, findMentions, makeResolver, neighbourhood } from '../src/shared/graph'

describe('graph links', () => {
  it('extracts note links, skipping image embeds', () => {
    expect(extractLinks('See [[Saltmere]], [[DND Tavern/NPCs/Pell|Pell]] and [[Notes#Heading]]. ![[map.png]] ![[Embedded note]]')).toEqual([
      'Saltmere',
      'DND Tavern/NPCs/Pell',
      'Notes',
      'Embedded note'
    ])
  })

  it('resolves like Obsidian: full path, suffix, unique name, nearest folder', () => {
    const resolve = makeResolver(['A/Campaign.md', 'B/Campaign.md', 'NPCs/Pell.md', 'Daily/2026-10-10.md'])
    expect(resolve('A/Campaign', 'x.md')).toBe('A/Campaign.md')
    expect(resolve('Pell', 'A/Sessions/s.md')).toBe('NPCs/Pell.md')
    expect(resolve('pell.md', 'x.md')).toBe('NPCs/Pell.md')
    expect(resolve('Campaign', 'B/notes.md')).toBe('B/Campaign.md')
    expect(resolve('Missing', 'x.md')).toBeNull()
  })

  it('finds whole-word mentions only', () => {
    const names = [{ id: 'a', name: 'Pell Brightwater' }, { id: 'b', name: 'Ann' }, { id: 'c', name: 'Al' }]
    expect(findMentions('Pell Brightwater waves. Annoyed, Al leaves.', names)).toEqual(['a'])
  })
})

describe('buildGraph', () => {
  const root = 'DND Tavern'
  const files = [
    { path: 'DND Tavern/Campaigns/Saltmere/Campaign.md', content: '---\nlorebooks: ["[[DND Tavern/Lorebooks/Lore]]"]\n---\nSee [[Pell Brightwater]].' },
    { path: 'DND Tavern/Campaigns/Saltmere/Sessions/2026-10-10 Session 01.md', content: '---\ncampaign: "[[DND Tavern/Campaigns/Saltmere/Campaign|Saltmere]]"\ncharacters: ["[[DND Tavern/Characters/Aria|Aria]]"]\n---\n> [!dm] DM\n> Mother Ysolde lifts the lantern. Aria nods.\n![[scene.png]]' },
    { path: 'DND Tavern/Characters/Aria.md', content: '# Aria' },
    { path: 'DND Tavern/NPCs/Pell Brightwater.md', content: 'Met at [[Daily/2026-10-10]].' },
    { path: 'DND Tavern/NPCs/Mother Ysolde.md', content: '' },
    { path: 'DND Tavern/Lorebooks/Lore.md', content: '' }
  ]
  const allPaths = [...files.map((f) => f.path), 'Daily/2026-10-10.md']
  const labels = new Map([
    ['DND Tavern/Campaigns/Saltmere/Campaign.md', 'Saltmere'],
    ['DND Tavern/Campaigns/Saltmere/Sessions/2026-10-10 Session 01.md', 'Session 01']
  ])
  const g = buildGraph({ rootFolder: root, allPaths, files, labels })

  it('classifies notes and labels them', () => {
    const kind = (name: string): string | undefined => g.nodes.find((n) => n.name === name)?.kind
    expect(kind('Saltmere')).toBe('campaign')
    expect(kind('Session 01')).toBe('session')
    expect(kind('Aria')).toBe('character')
    expect(kind('Pell Brightwater')).toBe('npc')
    expect(kind('Lore')).toBe('lorebook')
    expect(kind('2026-10-10')).toBe('note') // linked note outside the root
  })

  it('links once per pair, and adds mentions only where no link exists', () => {
    const links = g.links.map((l) => `${l.kind}:${l.source.split('/').pop()}→${l.target.split('/').pop()}`)
    expect(links).toContain('link:Campaign.md→Lore.md')
    expect(links).toContain('link:Campaign.md→Pell Brightwater.md')
    expect(links).toContain('link:2026-10-10 Session 01.md→Aria.md')
    expect(links).toContain('mention:2026-10-10 Session 01.md→Mother Ysolde.md')
    // Aria is linked in frontmatter, so her mention doesn't add a second edge.
    expect(links.filter((l) => l.includes('Session 01.md→Aria.md'))).toHaveLength(1)
    expect(links.some((l) => l.includes('scene.png'))).toBe(false)
  })

  it('computes neighbourhoods for the local graph', () => {
    const session = 'DND Tavern/Campaigns/Saltmere/Sessions/2026-10-10 Session 01.md'
    const one = neighbourhood(g, session, 1)
    expect(one.has('DND Tavern/Characters/Aria.md')).toBe(true)
    expect(one.has('DND Tavern/NPCs/Pell Brightwater.md')).toBe(false)
    expect(neighbourhood(g, session, 2).has('DND Tavern/NPCs/Pell Brightwater.md')).toBe(true)
    expect(neighbourhood(g, session, 1, new Set(['link'])).has('DND Tavern/NPCs/Mother Ysolde.md')).toBe(false)
  })
})

describe('party sheets', () => {
  it('attach to their campaign', () => {
    const g = buildGraph({
      rootFolder: 'R',
      allPaths: ['R/Campaigns/X/Campaign.md', 'R/Campaigns/X/Party.md'],
      files: [{ path: 'R/Campaigns/X/Campaign.md', content: '' }, { path: 'R/Campaigns/X/Party.md', content: '' }],
      labels: new Map()
    })
    expect(g.links).toEqual([{ source: 'R/Campaigns/X/Campaign.md', target: 'R/Campaigns/X/Party.md', kind: 'link' }])
  })
})
