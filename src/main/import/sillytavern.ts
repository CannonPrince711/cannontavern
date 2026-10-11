/**
 * SillyTavern character cards: V1 (flat JSON), V2 (`chara_card_v2`) and V3
 * (`chara_card_v3`), as JSON files or embedded in PNG avatars.
 */
import type { CharacterCard, LoreEntry } from '@shared/types'
import { isPng, readTextChunks, setTextChunks } from './png'

export interface ParsedCard {
  card: CharacterCard
  /** Embedded `character_book`, converted to lorebook entries. */
  book: { name: string; entries: LoreEntry[] } | null
  /** Card fields DND Tavern doesn't model, kept for re-export. */
  extras: Record<string, unknown>
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** Reads the card JSON out of a PNG or JSON file's bytes. */
export function extractCardJson(file: Buffer): unknown {
  if (isPng(file)) {
    const text = readTextChunks(file)
    const raw = text.get('ccv3') ?? text.get('chara')
    if (!raw) throw new Error('This PNG has no embedded character card (no “chara” text chunk).')
    return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'))
  }
  const text = file.toString('utf8').replace(/^﻿/, '')
  return JSON.parse(text)
}

export function parseCard(json: unknown): ParsedCard {
  if (!json || typeof json !== 'object') throw new Error('The card is not a JSON object.')
  const root = json as Record<string, unknown>
  const isV2 = root.spec === 'chara_card_v2' || root.spec === 'chara_card_v3'
  const d = (isV2 && root.data && typeof root.data === 'object' ? root.data : root) as Record<string, unknown>
  const name = str(d.name) || str(root.char_name) || 'Imported character'

  const card: CharacterCard = {
    name,
    description: str(d.description) || str(root.char_persona),
    personality: str(d.personality),
    scenario: str(d.scenario) || str(root.world_scenario),
    first_mes: str(d.first_mes) || str(root.char_greeting),
    mes_example: str(d.mes_example) || str(root.example_dialogue),
    system_prompt: str(d.system_prompt),
    tags: strs(d.tags),
    ...(str(d.creator_notes) ? { creator_notes: str(d.creator_notes) } : {}),
    ...(strs(d.alternate_greetings).length ? { alternate_greetings: strs(d.alternate_greetings) } : {})
  }

  let book: ParsedCard['book'] = null
  const cb = d.character_book as { name?: unknown; entries?: unknown } | undefined
  if (cb && Array.isArray(cb.entries) && cb.entries.length) {
    book = {
      name: str(cb.name) || `${name} Lore`,
      entries: cb.entries.map((raw, i): LoreEntry => {
        const e = raw as Record<string, unknown>
        const keys = [...strs(e.keys), ...strs(e.secondary_keys)]
        return {
          title: str(e.name) || str(e.comment) || keys[0] || `Entry ${i + 1}`,
          keys,
          content: str(e.content),
          always_on: e.constant === true,
          priority: typeof e.priority === 'number' ? e.priority : typeof e.insertion_order === 'number' ? e.insertion_order : 0,
          enabled: e.enabled !== false
        }
      })
    }
  }

  const known = new Set([
    'name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'system_prompt',
    'tags', 'creator_notes', 'alternate_greetings', 'character_book'
  ])
  const extras = Object.fromEntries(Object.entries(d).filter(([k]) => !known.has(k)))
  return { card, book, extras }
}

/** Builds a V2 card (the most widely supported) from a character. */
export function buildCardV2(card: CharacterCard, extras: Record<string, unknown> = {}, book?: { name: string; entries: LoreEntry[] } | null): Record<string, unknown> {
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      post_history_instructions: '',
      creator: '',
      character_version: '',
      extensions: {},
      ...extras,
      name: card.name,
      description: card.description,
      personality: card.personality,
      scenario: card.scenario,
      first_mes: card.first_mes,
      mes_example: card.mes_example,
      system_prompt: card.system_prompt,
      creator_notes: card.creator_notes ?? '',
      alternate_greetings: card.alternate_greetings ?? [],
      tags: card.tags,
      ...(book && book.entries.length
        ? {
            character_book: {
              name: book.name,
              entries: book.entries.map((e, i) => ({
                id: i,
                keys: e.keys,
                content: e.content,
                name: e.title,
                comment: e.title,
                enabled: e.enabled,
                constant: e.always_on,
                insertion_order: e.priority,
                priority: e.priority,
                extensions: {}
              })),
              extensions: {}
            }
          }
        : {})
    }
  }
}

/** Embeds a card into a PNG (as both "chara" for V2 readers). */
export function embedCard(png: Buffer, cardJson: Record<string, unknown>): Buffer {
  return setTextChunks(png, { chara: Buffer.from(JSON.stringify(cardJson), 'utf8').toString('base64') })
}
