import { describe, expect, it } from 'vitest'
import { parseNote, serializeNote, splitNote, updateNote } from '../src/main/vault/frontmatter'

const NOTE = `---
name: Aria
# a comment the user wrote
tags: [elf, ranger]
aliases:
  - The Grey
dnd:
  hp: 12
  max_hp: 12
---
Body text with **markdown**.

More body.
`

describe('splitNote / parseNote', () => {
  it('splits frontmatter from the body exactly', () => {
    const { yaml, body } = splitNote(NOTE)
    expect(yaml).toContain('name: Aria')
    expect(body).toBe('Body text with **markdown**.\n\nMore body.\n')
  })

  it('parses YAML into data', () => {
    const { data } = parseNote(NOTE)
    expect(data.name).toBe('Aria')
    expect(data.tags).toEqual(['elf', 'ranger'])
    expect((data.dnd as { hp: number }).hp).toBe(12)
  })

  it('treats notes without frontmatter as all body', () => {
    expect(parseNote('# Hi\n')).toEqual({ data: {}, body: '# Hi\n', yaml: null })
  })

  it('handles CRLF line endings and a BOM', () => {
    const { data, body } = parseNote('﻿---\r\nname: X\r\n---\r\nbody\r\n')
    expect(data.name).toBe('X')
    expect(body).toBe('body\r\n')
  })

  it('keeps dates as strings', () => {
    expect(parseNote('---\ncreated: 2026-10-10\n---\n').data.created).toBe('2026-10-10')
  })
})

describe('updateNote', () => {
  it('returns the original string when nothing changes', () => {
    expect(updateNote(NOTE, { name: 'Aria', tags: ['elf', 'ranger'] })).toBe(NOTE)
  })

  it('changes only the patched key and keeps comments, order and user keys', () => {
    const out = updateNote(NOTE, { dnd: { hp: 7, max_hp: 12 } })
    expect(out).toContain('# a comment the user wrote')
    expect(out).toContain('aliases:\n  - The Grey')
    expect(out.indexOf('name:')).toBeLessThan(out.indexOf('tags:'))
    expect((parseNote(out).data.dnd as { hp: number }).hp).toBe(7)
    expect(parseNote(out).body).toBe(parseNote(NOTE).body)
  })

  it('deletes keys set to undefined and adds new ones', () => {
    const out = updateNote(NOTE, { aliases: undefined, level: 3 })
    const { data } = parseNote(out)
    expect(data.aliases).toBeUndefined()
    expect(data.level).toBe(3)
  })

  it('replaces the body when given one', () => {
    const out = updateNote(NOTE, {}, 'New body\n')
    expect(parseNote(out).body).toBe('New body\n')
    expect(parseNote(out).data.name).toBe('Aria')
  })

  it('adds frontmatter to a note that had none', () => {
    const out = updateNote('Just text\n', { type: 'session' })
    expect(out).toBe('---\ntype: session\n---\nJust text\n')
  })

  it('writes multi-line strings as readable block scalars', () => {
    const out = serializeNote({ description: 'Line one\nLine two' }, '')
    expect(out).toContain('description: |-\n  Line one\n  Line two')
    expect(parseNote(out).data.description).toBe('Line one\nLine two')
  })

  it('round-trips serialize → parse', () => {
    const data = { name: 'Bob', dnd: { str: 10, skills: ['athletics'], spell_slots: { '1': { max: 2, used: 0 } } } }
    expect(parseNote(serializeNote(data, 'b')).data).toEqual(data)
  })

  it('refuses to rewrite invalid YAML', () => {
    expect(() => updateNote('---\nname: [unclosed\n---\n', { name: 'x' })).toThrow(/not valid YAML/)
  })
})
