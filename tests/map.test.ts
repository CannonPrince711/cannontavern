import { describe, expect, it } from 'vitest'
import { nearestPin, normalizeParty, normalizePins, partyLocation, pinsFromBody, replacePinsSection, type MapPin } from '../src/shared/map'

const pin = (id: string, name: string, x: number | null, y: number | null, extra: Partial<MapPin> = {}): MapPin => ({ id, name, x, y, kind: 'location', description: '', ...extra })

describe('maps', () => {
  it('normalises stored pins and the party marker', () => {
    expect(normalizePins([{ id: 'a', name: 'Harbour', x: 1.4, y: -1, kind: 'weird' }, { name: '' }, 'junk'])).toEqual([pin('a', 'Harbour', 1, 0)])
    expect(normalizeParty({ x: 0.5, y: 0.25, at: 'a' })).toEqual({ x: 0.5, y: 0.25, at: 'a' })
    expect(normalizeParty({ x: 'no' })).toBeNull()
  })

  it('reads hand-written pin lists as unplaced pins', () => {
    const body = '# Map\n\n## Pins\n\n- [[Drowned Bell]] — a sunken temple\n- [[NPCs/Pell|Pell’s shop]]\n- Old Lighthouse - ruined\n\n## Notes\n- not a pin'
    const pins = pinsFromBody(body)
    expect(pins.map((p) => [p.name, p.note, p.description, p.x])).toEqual([
      ['Drowned Bell', 'Drowned Bell', 'a sunken temple', null],
      ['Pell’s shop', 'NPCs/Pell', '', null],
      ['Old Lighthouse', undefined, 'ruined', null]
    ])
  })

  it('rewrites only the Pins section', () => {
    const body = '# Map\n\n![[map.png]]\n\n## Pins\n\n- old\n\n## Notes\nKeep me.\n'
    const out = replacePinsSection(body, [pin('a', 'Cinderhold', 0.1, 0.2, { note: 'Cinderhold', description: 'the capital' }), pin('b', 'Camp', 0.3, 0.3)])
    expect(out).toContain('## Pins\n\n- [[Cinderhold]] — the capital\n- Camp\n')
    expect(out).toContain('## Notes\nKeep me.')
    expect(out).not.toContain('- old')
    expect(replacePinsSection('# Map\n', [])).toBe('# Map\n\n## Pins\n\n*No pins yet.*\n')
  })

  it('finds the nearest placed pin and describes the party location', () => {
    const pins = [pin('a', 'Harbour', 0.5, 0.5, { description: 'Foggy docks' }), pin('b', 'Far', 0.9, 0.9), pin('c', 'Unplaced', null, null)]
    expect(nearestPin(pins, 0.52, 0.51)?.id).toBe('a')
    expect(nearestPin(pins, 0.7, 0.7)).toBeNull()
    expect(partyLocation({ pins, party: { x: 0.5, y: 0.5, at: 'a' } })).toBe('Harbour: Foggy docks')
    expect(partyLocation({ pins, party: { x: 0.2, y: 0.2 } })).toBeNull()
  })
})
