import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { crc32, isPng, readChunks, readTextChunks, setTextChunks, solidPng, writeChunks } from '../src/main/import/png'
import { buildCardV2, embedCard, extractCardJson, parseCard } from '../src/main/import/sillytavern'

const v2 = {
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: {
    name: 'Seraphina',
    description: 'A guardian of the forest. “Unicode” ✓',
    personality: 'Kind',
    scenario: 'You wake in her glade.',
    first_mes: '*Seraphina smiles.* You’re awake.',
    mes_example: '<START>\n{{user}}: Hi\n{{char}}: Hello',
    creator_notes: 'Made for testing',
    system_prompt: 'Stay in character.',
    post_history_instructions: '',
    alternate_greetings: ['Hello again.'],
    tags: ['fantasy', 'guardian'],
    creator: 'someone',
    character_version: '1.2',
    extensions: { talkativeness: '0.5' },
    character_book: {
      name: 'Glade Lore',
      entries: [
        { keys: ['glade'], secondary_keys: ['clearing'], content: 'A hidden clearing.', enabled: true, insertion_order: 10, constant: false, comment: 'The Glade' },
        { keys: [], content: 'Magic is fading.', enabled: false, insertion_order: 0, constant: true, name: 'Fading magic' }
      ]
    }
  }
}

describe('PNG chunks', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(Buffer.from('IEND'))).toBe(0xae426082)
  })

  it('writes a valid PNG that reads back', () => {
    const png = solidPng(4, 3, [10, 20, 30])
    expect(isPng(png)).toBe(true)
    expect(readChunks(png).map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND'])
    expect(writeChunks(readChunks(png)).equals(png)).toBe(true)
  })

  it('sets, replaces and reads tEXt chunks before IEND', () => {
    let png = setTextChunks(solidPng(2, 2, [0, 0, 0]), { chara: 'one', other: 'x' })
    png = setTextChunks(png, { chara: 'two' })
    const text = readTextChunks(png)
    expect(text.get('chara')).toBe('two')
    expect(text.get('other')).toBe('x')
    expect(readChunks(png).at(-1)!.type).toBe('IEND')
    expect(readChunks(png).filter((c) => c.type === 'tEXt')).toHaveLength(2)
  })

  it('reads compressed iTXt and zTXt chunks', () => {
    const base = readChunks(solidPng(1, 1, [0, 0, 0]))
    const itxt = Buffer.concat([Buffer.from('ccv3\0\x01\0en\0\0', 'latin1'), deflateSync(Buffer.from('v3 data ✓', 'utf8'))])
    const ztxt = Buffer.concat([Buffer.from('note\0\0', 'latin1'), deflateSync(Buffer.from('hello', 'latin1'))])
    const png = writeChunks([base[0]!, { type: 'iTXt', data: itxt }, { type: 'zTXt', data: ztxt }, ...base.slice(1)])
    const text = readTextChunks(png)
    expect(text.get('ccv3')).toBe('v3 data ✓')
    expect(text.get('note')).toBe('hello')
  })
})

describe('SillyTavern cards', () => {
  it('parses a V2 card with its embedded lorebook', () => {
    const { card, book, extras } = parseCard(v2)
    expect(card).toMatchObject({
      name: 'Seraphina',
      description: 'A guardian of the forest. “Unicode” ✓',
      first_mes: '*Seraphina smiles.* You’re awake.',
      system_prompt: 'Stay in character.',
      tags: ['fantasy', 'guardian'],
      alternate_greetings: ['Hello again.'],
      creator_notes: 'Made for testing'
    })
    expect(book).toEqual({
      name: 'Glade Lore',
      entries: [
        { title: 'The Glade', keys: ['glade', 'clearing'], content: 'A hidden clearing.', always_on: false, priority: 10, enabled: true },
        { title: 'Fading magic', keys: [], content: 'Magic is fading.', always_on: true, priority: 0, enabled: false }
      ]
    })
    expect(extras).toMatchObject({ creator: 'someone', character_version: '1.2' })
  })

  it('parses V1 and legacy field names', () => {
    expect(parseCard({ name: 'Old', description: 'd', first_mes: 'hi' }).card).toMatchObject({ name: 'Old', description: 'd', first_mes: 'hi' })
    expect(parseCard({ char_name: 'Older', char_persona: 'p', char_greeting: 'g', world_scenario: 's', example_dialogue: 'e' }).card).toMatchObject({
      name: 'Older',
      description: 'p',
      first_mes: 'g',
      scenario: 's',
      mes_example: 'e'
    })
  })

  it('round-trips through a PNG card', () => {
    const { card, book } = parseCard(v2)
    const png = embedCard(solidPng(8, 8, [1, 2, 3]), buildCardV2(card, {}, book))
    const again = parseCard(extractCardJson(png))
    expect(again.card).toEqual(card)
    expect(again.book).toEqual(book)
  })

  it('reads JSON card files with a BOM', () => {
    expect((parseCard(extractCardJson(Buffer.from(`﻿${JSON.stringify(v2)}`))).card.name)).toBe('Seraphina')
  })

  it('explains a PNG without a card', () => {
    expect(() => extractCardJson(solidPng(1, 1, [0, 0, 0]))).toThrow(/no embedded character card/)
  })
})
