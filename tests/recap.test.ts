import { describe, expect, it } from 'vitest'
import { buildPrompt, normalizeBlockOrder } from '../src/shared/prompt'
import { chunkLines, isRecapStale, isRecapWorthy, previousSessions, renderRecaps } from '../src/shared/recap'
import { PROMPT_BLOCK_IDS, type Message, type SessionSummary } from '../src/shared/types'

const msg = (id: string, role: Message['role'], extra: Partial<Message> = {}): Message => ({ id, role, text: `${role} ${id}`, swipes: [], swipeIndex: 0, createdAt: '', ...extra })

const session = (path: string, created: string, campaignPath = 'DND Tavern/Campaigns/A'): SessionSummary => ({
  path,
  name: path.split('/').pop()!.replace(/\.md$/, ''),
  id: path,
  title: path.split('/').pop()!.replace(/\.md$/, ''),
  campaignPath,
  created,
  messageCount: 3,
  mtimeMs: 0
})

describe('recap helpers', () => {
  it('needs a player turn and a few visible messages', () => {
    expect(isRecapWorthy([msg('1', 'dm')])).toBe(false)
    expect(isRecapWorthy([msg('1', 'dm'), msg('2', 'dm'), msg('3', 'dm')])).toBe(false)
    expect(isRecapWorthy([msg('1', 'dm'), msg('2', 'player'), msg('3', 'dm')])).toBe(true)
    // Hidden messages and images don't count.
    expect(isRecapWorthy([msg('1', 'dm'), msg('2', 'player'), msg('3', 'system', { hidden: true }), msg('4', 'image')])).toBe(false)
  })

  it('is stale once a visible message follows the recap', () => {
    const ms = [msg('1', 'dm'), msg('2', 'player'), msg('3', 'dm')]
    expect(isRecapStale(undefined, ms)).toBe(true)
    expect(isRecapStale('3', ms)).toBe(false)
    expect(isRecapStale('3', [...ms, msg('4', 'system', { hidden: true })])).toBe(false)
    expect(isRecapStale('3', [...ms, msg('4', 'player')])).toBe(true)
  })

  it('finds earlier sessions of the same campaign, newest first', () => {
    const all = [
      session('DND Tavern/Campaigns/A/Sessions/2026-10-01 Session 01.md', '2026-10-01T10:00:00.000Z'),
      session('DND Tavern/Campaigns/A/Sessions/2026-10-03 Session 02.md', '2026-10-03T10:00:00.000Z'),
      session('DND Tavern/Campaigns/B/Sessions/2026-10-04 Other.md', '2026-10-04T10:00:00.000Z', 'DND Tavern/Campaigns/B'),
      session('DND Tavern/Campaigns/A/Sessions/2026-10-09 Session 04.md', '2026-10-09T10:00:00.000Z'),
      session('DND Tavern/Campaigns/A/Sessions/2026-10-05 Session 03.md', '2026-10-05T10:00:00.000Z')
    ]
    const current = { path: 'DND Tavern/Campaigns/A/Sessions/2026-10-05 Session 03.md', campaignPath: 'DND Tavern/Campaigns/A', created: '2026-10-05T10:00:00.000Z' }
    expect(previousSessions(all, current).map((s) => s.title)).toEqual(['2026-10-03 Session 02', '2026-10-01 Session 01'])
  })

  it('falls back to the dated file name when created dates tie or are missing', () => {
    const all = [session('C/Sessions/2026-10-01 a.md', '', 'C'), session('C/Sessions/2026-10-02 b.md', '', 'C')]
    expect(previousSessions(all, { path: 'C/Sessions/2026-10-03 c.md', campaignPath: 'C', created: '' }).map((s) => s.title)).toEqual(['2026-10-02 b', '2026-10-01 a'])
  })

  it('chunks transcripts under the size limit and cuts huge lines', () => {
    const chunks = chunkLines(['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)], 100)
    expect(chunks).toHaveLength(2)
    expect(chunks.every((c) => c.length <= 100)).toBe(true)
    expect(chunkLines(['x'.repeat(250)], 100).map((c) => c.length)).toEqual([100, 100, 50])
    expect(chunkLines([], 100)).toEqual([])
  })
})

describe('recaps in the prompt', () => {
  it('inserts new built-in blocks into saved orders at their default position', () => {
    const saved = PROMPT_BLOCK_IDS.filter((id) => id !== 'recaps').map((id) => ({ id, enabled: id !== 'sheet' }))
    const order = normalizeBlockOrder(saved)
    expect(order.map((b) => b.id)).toEqual([...PROMPT_BLOCK_IDS])
    expect(order.find((b) => b.id === 'sheet')!.enabled).toBe(false)
    // A user's custom order is kept.
    const custom = normalizeBlockOrder([{ id: 'history', enabled: true }, { id: 'summary', enabled: true }])
    expect(custom.findIndex((b) => b.id === 'recaps')).toBe(custom.findIndex((b) => b.id === 'summary') - 1)
    expect(normalizeBlockOrder(order)).toEqual(order)
  })

  it('renders earlier recaps oldest first in a "Previous sessions" block', () => {
    const recaps = [
      { path: 'a', title: 'Session 01', created: '1', recap: 'Kestrel met Ysolde.' },
      { path: 'b', title: 'Session 02', created: '2', recap: 'They found the bell.' }
    ]
    const p = buildPrompt({
      userName: 'Kestrel', character: null, campaign: null, party: null, preset: null, lore: [], sheet: null, combat: null, summary: null,
      recaps, messages: [msg('1', 'player')], order: normalizeBlockOrder([]), budget: 8000, maxReplyTokens: 500, tokenizer: 'chars4', autoState: false
    })
    const block = p.blocks.find((b) => b.id === 'recaps')!
    expect(block.label).toBe('Previous sessions (2)')
    expect(block.content.indexOf('Session 01')).toBeLessThan(block.content.indexOf('Session 02'))
    expect(p.system).toContain('They found the bell.')
    expect(renderRecaps([])).toBe('')
  })
})
