import { describe, expect, it } from 'vitest'
import { classifyPath, normalizeRootFolder } from '@shared/layout'
import {
  formatDate,
  joinVaultPath,
  noteName,
  parseWikilinks,
  sanitizeFileName,
  toWikilink,
  wikilinkTarget
} from '@shared/names'

describe('sanitizeFileName', () => {
  it('strips characters Windows forbids', () => {
    expect(sanitizeFileName('a\\b/c:d*e?f"g<h>i|j')).toBe('a b c d e f g h i j')
  })
  it('strips characters that break wikilinks', () => {
    expect(sanitizeFileName('Sir [Bob] #1 ^x')).toBe('Sir Bob 1 x')
  })
  it('removes trailing dots and spaces', () => {
    expect(sanitizeFileName('Hello... ')).toBe('Hello')
  })
  it('avoids reserved device names', () => {
    expect(sanitizeFileName('CON')).toBe('CON_')
    expect(sanitizeFileName('lpt1')).toBe('lpt1_')
  })
  it('never returns an empty name', () => {
    expect(sanitizeFileName('???')).toBe('Untitled')
  })
  it('keeps unicode and caps the length', () => {
    expect(sanitizeFileName('Éowyn of Rohan')).toBe('Éowyn of Rohan')
    expect(sanitizeFileName('x'.repeat(300)).length).toBe(120)
  })
})

describe('paths and wikilinks', () => {
  it('joins with forward slashes', () => {
    expect(joinVaultPath('DND Tavern\\Campaigns', '/A/', 'Sessions')).toBe('DND Tavern/Campaigns/A/Sessions')
  })
  it('gets note names', () => {
    expect(noteName('DND Tavern/Characters/Aria.md')).toBe('Aria')
  })
  it('builds wikilinks', () => {
    expect(toWikilink('DND Tavern/Characters/Aria.md')).toBe('[[Aria]]')
    expect(toWikilink('X/Aria.md', { full: true })).toBe('[[X/Aria|Aria]]')
  })
  it('parses wikilinks with headings, aliases and embeds', () => {
    const links = parseWikilinks('See [[Aria]] and ![[map.png]] or [[Lore#Dragons|the dragons]].')
    expect(links.map((l) => [l.target, l.heading, l.alias, l.embed])).toEqual([
      ['Aria', undefined, undefined, false],
      ['map.png', undefined, undefined, true],
      ['Lore', 'Dragons', 'the dragons', false]
    ])
  })
  it('extracts a wikilink target', () => {
    expect(wikilinkTarget('[[The Sunken Lantern]]')).toBe('The Sunken Lantern')
    expect(wikilinkTarget('[[A|alias]]')).toBe('A')
    expect(wikilinkTarget('plain')).toBe('plain')
  })
  it('formats dates', () => {
    expect(formatDate(new Date(2026, 9, 10, 9, 5), 'YYYY-MM-DD HH:mm')).toBe('2026-10-10 09:05')
  })
})

describe('classifyPath', () => {
  const root = 'DND Tavern'
  it('recognises each note type', () => {
    expect(classifyPath(root, 'DND Tavern/Characters/Aria.md')?.kind).toBe('character')
    expect(classifyPath(root, 'DND Tavern/NPCs/Bob.md')?.kind).toBe('npc')
    expect(classifyPath(root, 'DND Tavern/Lorebooks/World.md')?.kind).toBe('lorebook')
    expect(classifyPath(root, 'DND Tavern/Presets/Classic DM.md')?.kind).toBe('preset')
    expect(classifyPath(root, 'DND Tavern/Campaigns/Lantern/Campaign.md')).toEqual({
      kind: 'campaign',
      campaignPath: 'DND Tavern/Campaigns/Lantern'
    })
    expect(classifyPath(root, 'DND Tavern/Campaigns/Lantern/Sessions/2026-10-10 Session 01.md')).toEqual({
      kind: 'session',
      campaignPath: 'DND Tavern/Campaigns/Lantern'
    })
  })
  it('ignores everything else', () => {
    expect(classifyPath(root, 'Other/Characters/Aria.md')).toBeNull()
    expect(classifyPath(root, 'DND Tavern/Characters/avatars/aria.png')).toBeNull()
    expect(classifyPath(root, 'DND Tavern/Characters/sub/Aria.md')).toBeNull()
    expect(classifyPath(root, 'DND Tavern/Campaigns/Lantern/Images/x.md')).toBeNull()
  })
  it('is case-insensitive like Windows', () => {
    expect(classifyPath(root, 'dnd tavern/characters/Aria.md')?.kind).toBe('character')
  })
})

describe('normalizeRootFolder', () => {
  it('accepts nested folders', () => {
    expect(normalizeRootFolder(' Games\\DND Tavern/ ')).toBe('Games/DND Tavern')
  })
  it('rejects traversal, dot-folders and bad characters', () => {
    expect(normalizeRootFolder('../x')).toBeNull()
    expect(normalizeRootFolder('.obsidian')).toBeNull()
    expect(normalizeRootFolder('a:b')).toBeNull()
    expect(normalizeRootFolder('  ')).toBeNull()
  })
})
