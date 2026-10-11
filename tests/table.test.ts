import { describe, expect, it } from 'vitest'
import { everyoneActed, makeJoinCode, playerSafe, sameCode, type TablePlayer } from '../src/shared/table'
import type { Message } from '../src/shared/types'

const msg = (id: string, role: Message['role'], extra: Partial<Message> = {}): Message => ({ id, role, text: `${role} ${id}`, swipes: [], swipeIndex: 0, createdAt: '2026-10-11T00:00:00Z', ...extra })

describe('multiplayer protocol helpers', () => {
  it('shows players only what they may see', () => {
    const out = playerSafe(
      [
        msg('1', 'dm'),
        msg('2', 'system', { hidden: true, text: 'secret note' }),
        msg('3', 'system', { stateChanges: [{ hp: -3 }], text: 'Kestrel loses 3 HP' }),
        msg('4', 'image', { name: 'The pier', text: '![[pier.png]]', image: { file: 'pier.png', prompt: 'x' } })
      ],
      (file) => `/media?path=${file}`
    )
    expect(out.map((m) => m.id)).toEqual(['1', '3', '4'])
    expect(JSON.stringify(out)).not.toContain('secret note')
    expect(JSON.stringify(out)).not.toContain('stateChanges')
    expect(out[2]).toMatchObject({ role: 'image', text: '', imageUrl: '/media?path=pier.png', name: 'The pier' })
  })

  it('makes readable join codes and compares them loosely', () => {
    const code = makeJoinCode(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]))
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    expect(code).not.toMatch(/[01IO]/)
    expect(sameCode(code, code.toLowerCase().replace('-', ''))).toBe(true)
    expect(sameCode(code, 'ZZZZ-ZZZZ')).toBe(false)
    expect(sameCode('', '')).toBe(false)
  })

  it('knows when every player has acted since the DM spoke', () => {
    const players: TablePlayer[] = [
      { id: 'a', name: 'Sam', characterPath: 'C/Bryn.md', connected: true },
      { id: 'b', name: 'Riley', characterPath: 'C/Kestrel.md', connected: true },
      { id: 'c', name: 'Away', characterPath: 'C/Pip.md', connected: false }
    ]
    const names: Record<string, string> = { 'C/Bryn.md': 'Bryn', 'C/Kestrel.md': 'Kestrel', 'C/Pip.md': 'Pip' }
    const nameOf = (p: string): string | undefined => names[p]
    const base = [msg('1', 'player', { name: 'Bryn' }), msg('2', 'dm')]
    expect(everyoneActed([...base, msg('3', 'player', { name: 'Bryn' })], players, nameOf)).toBe(false)
    expect(everyoneActed([...base, msg('3', 'player', { name: 'Bryn' }), msg('4', 'player', { name: 'Kestrel' })], players, nameOf)).toBe(true)
    expect(everyoneActed([], [], nameOf)).toBe(false)
  })
})
