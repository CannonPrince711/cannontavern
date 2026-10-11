import { describe, expect, it } from 'vitest'
import { cardToFrontmatter, defaultCard, normalizeCard } from '../src/shared/notes'
import { mergeNpcLore, nameKeys, npcBelongsTo, npcCampaigns, npcLoreEntry, plainNoteText } from '../src/shared/npcs'
import { selectLore } from '../src/shared/prompt'
import type { Message } from '../src/shared/types'

const card = (over: Partial<ReturnType<typeof defaultCard>>) => ({ ...defaultCard('x'), ...over })
const msg = (text: string): Message => ({ id: text.slice(0, 8), role: 'player', text, swipes: [text], swipeIndex: 0, createdAt: '' })

describe('NPC trigger words', () => {
  it('uses the full name plus distinctive given and family names, skipping titles', () => {
    expect(nameKeys('Queen Maelis Varn')).toEqual(['queen maelis varn', 'maelis', 'varn'])
    expect(nameKeys('Mother Ysolde')).toEqual(['mother ysolde', 'ysolde'])
    expect(nameKeys('Aldric of Thornwall')).toEqual(['aldric of thornwall', 'aldric'])
    expect(nameKeys('Bex')).toEqual(['bex'])
    expect(nameKeys('Corwin Hale', ['the harbourmaster', 'Hale'])).toEqual(['corwin hale', 'corwin', 'hale', 'the harbourmaster'])
  })
})

describe('NPC notes as lore', () => {
  const ysolde = card({ name: 'Mother Ysolde', description: 'The last lantern-keeper of Saltmere.', personality: 'Calm, stubborn.', aliases: ['the keeper'] })
  const body = '\n# Mother Ysolde\n\n*Keeper* in [[DND Tavern/Campaigns/Saltmere/Campaign|Saltmere]]\n\n- **Wants:** to silence the bell.\n- **Secret:** she was on duty the night Old Saltmere sank.\n'

  it('gives the DM the whole note as plain text', () => {
    const e = npcLoreEntry(ysolde, body)
    expect(e.title).toBe('Mother Ysolde')
    expect(e.keys).toContain('the keeper')
    expect(e.content).toBe(
      'NPC. The last lantern-keeper of Saltmere.\nPersonality: Calm, stubborn.\n*Keeper* in Saltmere\n- Wants: to silence the bell.\n- Secret: she was on duty the night Old Saltmere sank.'
    )
  })

  it('gives a player character only what meeting them would show', () => {
    const e = npcLoreEntry(ysolde, body, { forPlayer: true })
    expect(e.content).toBe('NPC. The last lantern-keeper of Saltmere.\nPersonality: Calm, stubborn.')
    expect(e.content).not.toContain('Secret')
  })

  it('doesn’t repeat a description the body already has', () => {
    const e = npcLoreEntry(card({ name: 'Ola', description: 'A smith.' }), '\n# Ola\n\nA smith.\n\n- **Wants:** coal.\n')
    expect(e.content).toBe('NPC. A smith.\n- Wants: coal.')
  })

  it('is sent when the name or an alias comes up', () => {
    const entries = [npcLoreEntry(ysolde, body)]
    expect(selectLore(entries, [msg('I knock on the door.')], 6, 0)).toHaveLength(0)
    expect(selectLore(entries, [msg('I ask Ysolde about the bell.')], 6, 0)).toHaveLength(1)
    expect(selectLore(entries, [msg('Where is the keeper?')], 6, 0)).toHaveLength(1)
  })

  it('merges with a lorebook entry of the same name', () => {
    const npc = npcLoreEntry(ysolde, body)
    const lore = [
      { title: 'mother ysolde', keys: ['hooded woman'], content: 'The last lantern-keeper of Saltmere. She wrote the letter.', always_on: false, priority: 8, enabled: true },
      { title: 'Saltmere', keys: ['saltmere'], content: 'A drowned town.', always_on: false, priority: 5, enabled: true }
    ]
    const merged = mergeNpcLore(lore, [npc])
    expect(merged.map((e) => e.title)).toEqual(['Saltmere', 'Mother Ysolde'])
    const y = merged[1]!
    expect(y.keys).toContain('hooded woman')
    expect(y.priority).toBe(8)
    expect(y.content.endsWith('\nShe wrote the letter.')).toBe(true)
    expect(y.content.match(/last lantern-keeper/g)).toHaveLength(1)
  })
})

describe('which campaign an NPC belongs to', () => {
  const campaigns = [
    { folder: 'DND Tavern/Campaigns/Saltmere', links: ['DND Tavern/NPCs/Corwin Hale.md'] },
    { folder: 'DND Tavern/Campaigns/Ashen Crown', links: [] }
  ]
  it('ties NPCs to campaigns by links either way', () => {
    // The NPC links to a session in the campaign (the NPC generator's "First met").
    expect(npcCampaigns('DND Tavern/NPCs/Ola.md', ['DND Tavern/Campaigns/Saltmere/Sessions/Session 01.md'], campaigns)).toEqual(['DND Tavern/Campaigns/Saltmere'])
    // The campaign note links to the NPC.
    expect(npcCampaigns('DND Tavern/NPCs/Corwin Hale.md', [], campaigns)).toEqual(['DND Tavern/Campaigns/Saltmere'])
  })
  it('lets NPCs tied to no campaign turn up anywhere', () => {
    expect(npcBelongsTo('DND Tavern/Campaigns/Ashen Crown', npcCampaigns('DND Tavern/NPCs/Wanderer.md', [], campaigns))).toBe(true)
    expect(npcBelongsTo('DND Tavern/Campaigns/Ashen Crown', ['DND Tavern/Campaigns/Saltmere'])).toBe(false)
  })
})

describe('aliases on a card', () => {
  it('reads Obsidian’s aliases property as a list or a single string, and writes it back', () => {
    expect(normalizeCard({ name: 'A', aliases: ['B', 'C'] }, 'A').aliases).toEqual(['B', 'C'])
    expect(normalizeCard({ name: 'A', aliases: 'B' }, 'A').aliases).toEqual(['B'])
    expect(normalizeCard({ name: 'A' }, 'A').aliases).toBeUndefined()
    expect(cardToFrontmatter({ ...defaultCard('A'), aliases: ['B'] }).aliases).toEqual(['B'])
    expect(cardToFrontmatter(defaultCard('A')).aliases).toBeUndefined()
  })
})

describe('plain note text', () => {
  it('drops the title heading, embeds and bold, and shows links as their text', () => {
    expect(plainNoteText('# Ola\n![[Ola.png]]\nMet in [[Sessions/Session 01|the first session]] at [[DND Tavern/Places/Forge.md]].\n**Bold**', 'Ola')).toBe(
      'Met in the first session at Forge.\nBold'
    )
  })
})
