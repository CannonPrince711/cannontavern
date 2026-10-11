import { describe, expect, it } from 'vitest'
import {
  appendMessage,
  newMessageId,
  parseMessages,
  parseSessionBody,
  removeMessage,
  replaceMessage,
  serializeMessage,
  serializeSessionBody,
  swipesForFrontmatter,
  truncateAfter
} from '@shared/callouts'
import type { Message } from '@shared/types'

function msg(over: Partial<Message> & Pick<Message, 'id' | 'role' | 'text'>): Message {
  return { swipes: [over.text], swipeIndex: 0, createdAt: '2026-10-10T19:00:00.000Z', ...over }
}

const messages: Message[] = [
  msg({ id: 'm1', role: 'dm', name: 'Narrator', text: 'The fog rolls in.\n\nA bell tolls *below* the water.' }),
  msg({ id: 'm2', role: 'player', name: 'Aria', text: 'I draw my bow and whisper "who goes there?"' }),
  msg({
    id: 'm3',
    role: 'roll',
    name: 'Aria · Perception',
    text: '**1d20+5** → ⟨14⟩ + 5 = **19** vs DC 15 ✓',
    roll: {
      expression: '1d20+5',
      label: 'Perception',
      mode: 'normal',
      dice: [{ sides: 20, value: 14, kept: true }],
      modifier: 5,
      total: 19,
      crit: false,
      fumble: false,
      dc: 15,
      success: true
    }
  }),
  msg({ id: 'm4', role: 'system', text: 'HP −4 (Aria: 13/17)', hidden: true, stateChanges: [{ hp: -4 }] }),
  msg({
    id: 'm5',
    role: 'image',
    name: 'Harbor at dusk',
    text: '![[2026-10-10 harbor.png]]',
    image: { file: '2026-10-10 harbor.png', prompt: 'a misty harbor at dusk, lanterns', seed: 42 }
  }),
  msg({
    id: 'm6',
    role: 'dm',
    text: 'Second take.',
    swipes: ['First take.', 'Second take.', 'Third take.'],
    swipeIndex: 1,
    model: 'meta-llama/llama 3.1',
    backendId: 'b1'
  })
]

describe('callout serialisation', () => {
  it('writes Obsidian callouts with a metadata comment', () => {
    expect(serializeMessage(messages[0]!)).toBe(
      '> [!dm] Narrator\n> The fog rolls in.\n>\n> A bell tolls *below* the water.\n> <!-- id:m1 t:2026-10-10T19:00:00.000Z -->'
    )
    expect(serializeMessage(messages[5]!)).toMatch(/<!-- id:m6 t:\S+ swipes:3 swipe:1 model:meta-llama%2Fllama%203\.1 data:\S+ -->$/)
  })

  it('round-trips every message type exactly', () => {
    const body = serializeSessionBody(messages)
    const parsed = parseMessages(body, swipesForFrontmatter(messages))
    expect(parsed).toEqual(messages)
    // …and re-serialising the parse gives the identical text.
    expect(serializeSessionBody(parsed)).toBe(body)
  })

  it('keeps text that looks like markup intact', () => {
    const tricky = msg({
      id: 'x',
      role: 'dm',
      text: '> a quote\n> > nested\n<!-- an html comment the model wrote -->\n> [!dm] not a header\n\n\nTrailing paragraphs.'
    })
    const parsed = parseMessages(serializeSessionBody([tricky]))
    expect(parsed).toEqual([tricky])
  })

  it('handles empty messages', () => {
    const empty = msg({ id: 'e', role: 'dm', text: '' })
    expect(parseMessages(serializeSessionBody([empty]))).toEqual([empty])
  })
})

describe('reading notes edited in Obsidian', () => {
  it('ignores free text between callouts and keeps it on every edit', () => {
    const body =
      'Session notes written by hand.\n\n' +
      serializeMessage(messages[0]!) +
      '\n\n## Interlude\nThe party rested. [[Saltmere]]\n\n' +
      serializeMessage(messages[1]!) +
      '\n'
    expect(parseMessages(body).map((m) => m.id)).toEqual(['m1', 'm2'])

    const edited = replaceMessage(body, 'm1', { ...messages[0]!, text: 'Rewritten.' })
    expect(edited).toContain('Session notes written by hand.\n\n')
    expect(edited).toContain('\n\n## Interlude\nThe party rested. [[Saltmere]]\n\n')
    expect(parseMessages(edited)[0]!.text).toBe('Rewritten.')

    const appended = appendMessage(edited, messages[2]!)
    expect(appended.startsWith(edited.trimEnd())).toBe(true)
    expect(parseMessages(appended).map((m) => m.id)).toEqual(['m1', 'm2', 'm3'])
  })

  it('reads the active swipe from the body even after a hand edit', () => {
    const body = serializeSessionBody(messages).replace('Second take.', 'Second take, edited in Obsidian.')
    const m6 = parseMessages(body, swipesForFrontmatter(messages)).find((m) => m.id === 'm6')!
    expect(m6.text).toBe('Second take, edited in Obsidian.')
    expect(m6.swipes).toEqual(['First take.', 'Second take, edited in Obsidian.', 'Third take.'])
    expect(m6.swipeIndex).toBe(1)
  })

  it('accepts hand-written callouts without metadata, with stable ids', () => {
    const body = '> [!DM]\n> You wake in a cell.\n\n> [!player] Bob\n> I check the door.\n'
    const a = parseMessages(body)
    const b = parseMessages(body)
    expect(a.map((m) => [m.role, m.name, m.text])).toEqual([
      ['dm', undefined, 'You wake in a cell.'],
      ['player', 'Bob', 'I check the door.']
    ])
    expect(a.map((m) => m.id)).toEqual(b.map((m) => m.id))
    expect(a[0]!.id).not.toBe(a[1]!.id)
  })

  it('accepts CRLF line endings and foldable callouts', () => {
    const body = '> [!dm]- Folded\r\n> line one\r\n>\r\n> line two\r\n> <!-- id:c1 -->\r\n'
    const [m] = parseMessages(body)
    expect(m).toMatchObject({ id: 'c1', name: 'Folded', text: 'line one\n\nline two' })
  })

  it('ignores ordinary callouts of other types', () => {
    expect(parseMessages('> [!note]\n> just a note\n')).toEqual([])
  })

  it('reports block ranges that cover the whole callout', () => {
    const body = `intro\n\n${serializeMessage(messages[1]!)}\n\noutro\n`
    const [b] = parseSessionBody(body)
    expect(body.slice(b!.start, b!.end)).toBe(serializeMessage(messages[1]!))
  })
})

describe('surgical edits', () => {
  const body = serializeSessionBody(messages.slice(0, 3))

  it('removes a middle message without leaving a double gap', () => {
    const out = removeMessage(body, 'm2')
    expect(parseMessages(out).map((m) => m.id)).toEqual(['m1', 'm3'])
    expect(out).not.toMatch(/\n\n\n/)
    expect(out).toBe(serializeSessionBody([messages[0]!, messages[2]!]))
  })

  it('removes the last message cleanly', () => {
    expect(removeMessage(body, 'm3')).toBe(serializeSessionBody(messages.slice(0, 2)))
  })

  it('removes the only message', () => {
    expect(removeMessage(serializeSessionBody([messages[0]!]), 'm1')).toBe('')
  })

  it('truncates after a message for forks', () => {
    expect(truncateAfter(body, 'm2')).toBe(serializeSessionBody(messages.slice(0, 2)))
  })

  it('appends to an empty body', () => {
    expect(appendMessage('', messages[0]!)).toBe(`${serializeMessage(messages[0]!)}\n`)
  })
})

describe('ids', () => {
  it('generates unique short ids', () => {
    const ids = new Set(Array.from({ length: 500 }, newMessageId))
    expect(ids.size).toBe(500)
    for (const id of ids) expect(id).toMatch(/^m[a-z0-9]+$/)
  })
})
