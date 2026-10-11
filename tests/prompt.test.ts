import { describe, expect, it } from 'vitest'
import { parseLorebookBody, serializeLorebookBody, defaultSheet, normalizeSheet } from '@shared/notes'
import { buildPartyPrompt, buildPrompt, COMPANION_PROMPT, DEFAULT_DM_PROMPT, messageToTurn, renderSheet, selectLore, stripSpeakerLabel, type PromptInput } from '@shared/prompt'
import { PROMPT_BLOCK_IDS, type LoreEntry, type Message } from '@shared/types'
import { extractState } from '../src/main/chat'

const msg = (id: string, role: Message['role'], text: string, extra: Partial<Message> = {}): Message => ({
  id,
  role,
  text,
  swipes: [text],
  swipeIndex: 0,
  createdAt: '',
  ...extra
})

const lore: LoreEntry[] = [
  { title: 'Dragons', keys: ['dragon', 'wyrm'], content: 'Dragons sleep under the bay.', always_on: false, priority: 1, enabled: true },
  { title: 'Saltmere', keys: ['saltmere'], content: 'A fishing town.', always_on: false, priority: 5, enabled: true },
  { title: 'The Sky', keys: [], content: 'The sky is grey.', always_on: true, priority: 0, enabled: true },
  { title: 'Disabled', keys: ['bell'], content: 'Never shown.', always_on: false, priority: 9, enabled: false },
  { title: 'Wyrmling', keys: ['wyrmling'], content: 'A small dragon.', always_on: false, priority: 0, enabled: true }
]

describe('selectLore', () => {
  const messages = [msg('1', 'dm', 'Welcome to SALTMERE.'), msg('2', 'player', 'Is that a wyrm? I ring the bell.')]

  it('triggers on whole-word keys in recent messages, plus always-on entries', () => {
    const picked = selectLore(lore, messages, 10, 0).map((e) => e.title)
    expect(picked).toEqual(['The Sky', 'Saltmere', 'Dragons'])
  })

  it('only scans the last N messages', () => {
    expect(selectLore(lore, messages, 1, 0).map((e) => e.title)).toEqual(['The Sky', 'Dragons'])
  })

  it('respects the token budget, keeping the highest priority first', () => {
    const picked = selectLore(lore, messages, 10, 15).map((e) => e.title)
    expect(picked).toEqual(['The Sky', 'Saltmere'])
  })

  it('ignores hidden messages', () => {
    expect(selectLore(lore, [msg('h', 'system', 'dragon', { hidden: true })], 10, 0).map((e) => e.title)).toEqual(['The Sky'])
  })
})

describe('lorebook notes', () => {
  it('parses H2 entries with inline fields and writes them back', () => {
    const body = 'Intro text.\n\n## Dragons\nkeys:: dragon, wyrm\npriority:: 3\n\nThey sleep.\n\n## Sky\nkeys::\nalways:: true\nenabled:: false\n\nGrey.\n'
    const { intro, entries } = parseLorebookBody(body)
    expect(intro.trim()).toBe('Intro text.')
    expect(entries).toEqual([
      { title: 'Dragons', keys: ['dragon', 'wyrm'], content: 'They sleep.', always_on: false, priority: 3, enabled: true },
      { title: 'Sky', keys: [], content: 'Grey.', always_on: true, priority: 0, enabled: false }
    ])
    expect(parseLorebookBody(serializeLorebookBody(intro, entries)).entries).toEqual(entries)
  })
})

describe('buildPrompt', () => {
  const base: PromptInput = {
    userName: 'Aria',
    character: { name: 'Aria', description: 'A ranger from {{user}}’s homeland.', personality: '', scenario: '', first_mes: '', mes_example: '', system_prompt: '', tags: [] },
    campaign: { path: 'c', name: 'Lantern', setting: 'A drowned city', tone: 'Eerie', house_rules: '', lorebooks: [], body: '' },
    party: null,
    preset: null,
    lore: [lore[2]!],
    sheet: { ...defaultSheet(), race: 'Elf', class: 'Ranger', level: 3, hp: 17, max_hp: 24, dex: 16, saves: ['dex'] },
    combat: null,
    summary: 'They arrived at dusk.',
    messages: [msg('1', 'dm', 'The fog rolls in.'), msg('2', 'player', 'I draw my bow.')],
    order: PROMPT_BLOCK_IDS.map((id) => ({ id, enabled: true })),
    budget: 8000,
    maxReplyTokens: 500,
    tokenizer: 'chars4',
    autoState: false
  }

  it('assembles enabled blocks in order into the system prompt', () => {
    const p = buildPrompt(base)
    expect(p.blocks.map((b) => b.id)).toEqual(['preset', 'character', 'campaign', 'lorebook', 'sheet', 'summary', 'history'])
    expect(p.system.startsWith(DEFAULT_DM_PROMPT.slice(0, 30))).toBe(true)
    expect(p.system).toContain('[CHECK dex DC 14]')
    expect(p.system.indexOf('Player character: Aria')).toBeLessThan(p.system.indexOf('Campaign: Lantern'))
    expect(p.system).toContain('A ranger from Aria’s homeland.') // {{user}} macro
    expect(p.system).toContain('HP 17/24')
    expect(p.system).toContain('DEX 16 (+3)')
    expect(p.messages).toEqual([
      { role: 'assistant', content: 'The fog rolls in.' },
      { role: 'user', content: 'I draw my bow.' }
    ])
  })

  it('honours block order and switches', () => {
    const order = [
      { id: 'summary', enabled: true },
      { id: 'preset', enabled: true },
      { id: 'character', enabled: false },
      { id: 'history', enabled: true }
    ]
    const p = buildPrompt({ ...base, order })
    expect(p.blocks.map((b) => b.id)).toEqual(['summary', 'preset', 'history'])
    expect(p.system.startsWith('Story so far:')).toBe(true)
    expect(p.system).not.toContain('Player character')
  })

  it('trims the oldest history to fit the budget but keeps the newest turn', () => {
    const messages = Array.from({ length: 50 }, (_, i) => msg(String(i), i % 2 ? 'player' : 'dm', `Message ${i} `.repeat(40)))
    const p = buildPrompt({ ...base, messages, budget: 3000 })
    expect(p.droppedMessages).toBeGreaterThan(0)
    expect(p.messages[p.messages.length - 1]!.content).toContain('Message 49')
    expect(p.totalTokens).toBeLessThanOrEqual(3000)
    const tiny = buildPrompt({ ...base, messages, budget: 10 })
    expect(tiny.messages).toHaveLength(1)
  })

  it('adds the auto-state instruction only when enabled', () => {
    expect(buildPrompt(base).system).not.toContain('<state>')
    expect(buildPrompt({ ...base, autoState: true }).system).toContain('<state>')
  })

  it('maps rolls, notes and images to bracketed user turns and skips hidden ones', () => {
    expect(messageToTurn(msg('r', 'roll', '**1d20+5** → 19', { name: 'Perception' }), 'Aria')).toEqual({
      role: 'user',
      content: '[Dice: Perception — 1d20+5 → 19]'
    })
    expect(messageToTurn(msg('h', 'system', 'secret', { hidden: true }), 'Aria')).toBeNull()
    expect(messageToTurn(msg('p', 'player', 'Hi', { name: 'Bob' }), 'Aria')).toEqual({ role: 'user', content: 'Bob: Hi' })
  })

  it('renders a sheet summary with modifiers and slots', () => {
    const s = normalizeSheet({ str: 8, dex: 16, spell_slots: { 1: { max: 3, used: 1 } }, inventory: ['Rope x2', 'Torch'] })
    const text = renderSheet('Aria', s)
    expect(text).toContain('STR 8 (-1)')
    expect(text).toContain('Rope ×2, Torch')
    expect(text).toContain('L1 2/3')
  })
})

describe('extractState', () => {
  it('removes hidden state blocks and parses them', () => {
    const r = extractState('You take a hit.\n<state>{"hp":-4,"add_item":"rope"}</state>')
    expect(r.text).toBe('You take a hit.')
    expect(r.changes).toEqual([{ hp: -4, add_item: 'rope' }])
  })
  it('drops malformed blocks without crashing', () => {
    expect(extractState('Hi <state>{oops</state> there').text).toBe('Hi  there')
  })
})

describe('AI companions', () => {
  const m = (name: string, text: string, role: Message['role'] = 'player'): Message => ({ id: text, role, name, text, swipes: [text], swipeIndex: 0, createdAt: '' })
  it('shows a companion its own lines as its own and everyone else’s as theirs', () => {
    expect(messageToTurn(m('Alpha', 'I draw my blade.'), 'DM', 'player', 'Alpha')).toEqual({ role: 'assistant', content: 'I draw my blade.' })
    expect(messageToTurn(m('Kestrel', 'I check the door.'), 'DM', 'player', 'Alpha')).toEqual({ role: 'user', content: 'Kestrel: I check the door.' })
    // Without a companion, the AI playing the character owns every player line (You're DM mode).
    expect(messageToTurn(m('Kestrel', 'I check the door.'), 'DM', 'player')).toEqual({ role: 'assistant', content: 'I check the door.' })
  })

  it('tells the DM who said what', () => {
    expect(messageToTurn(m('Alpha', 'I draw my blade.'), 'Kestrel, Alpha', 'dm')).toEqual({ role: 'user', content: 'Alpha: I draw my blade.' })
  })

  it('keeps the companion prompt focused on one character', () => {
    expect(COMPANION_PROMPT).toContain('{{char}}')
    expect(COMPANION_PROMPT).toContain('{{party}}')
    expect(COMPANION_PROMPT).toMatch(/Never write for the other player characters or the DM/)
  })
})

describe('party prompt (shared for every speaker)', () => {
  const card = (name: string, description: string) => ({ name, description, personality: '', scenario: '', first_mes: '', mes_example: '', system_prompt: '', tags: [] })
  const m = (id: string, role: Message['role'], text: string, name?: string): Message => ({ id, role, ...(name ? { name } : {}), text, swipes: [text], swipeIndex: 0, createdAt: '' })
  const input = {
    userName: 'Issei',
    partyCards: [card('Issei', 'A Pawn.'), card('Kiba', 'A Knight.'), card('Akeno', 'A Queen.')],
    campaign: { path: 'c', name: 'Peerage', setting: 'Kuoh', tone: 'Action', house_rules: '', lorebooks: [], body: '## Secrets\n- God is dead.' },
    party: null,
    preset: null,
    lore: [{ title: 'Rias', keys: ['rias'], content: 'NPC. A Devil noble.', always_on: true, priority: 6, enabled: true }],
    dmLore: [{ title: 'Rias', keys: ['rias'], content: 'NPC. A Devil noble.\n- Secret: she is betrothed.', always_on: true, priority: 6, enabled: true }],
    combat: null,
    summary: null,
    messages: [m('1', 'dm', 'A Stray attacks!'), m('2', 'player', 'I punch it.', 'Issei'), m('3', 'player', 'I flank it.', 'Kiba')],
    order: PROMPT_BLOCK_IDS.map((id) => ({ id, enabled: true })),
    budget: 8000,
    maxReplyTokens: 500,
    tokenizer: 'chars4' as const,
    autoState: false
  }
  const dm = buildPartyPrompt({ ...input, turn: { speaker: 'dm' } })
  const akeno = buildPartyPrompt({ ...input, turn: { speaker: 'player', name: 'Akeno' } })
  const kiba = buildPartyPrompt({ ...input, turn: { speaker: 'player', name: 'Kiba' } })

  it('gives every speaker the same prompt up to their own instructions', () => {
    expect(akeno.system).toBe(dm.system)
    expect(kiba.system).toBe(dm.system)
    expect(dm.system).toContain('DM: A Stray attacks!\n\nIssei: I punch it.\n\nKiba: I flank it.')
  })

  it('keeps DM secrets out of the shared part', () => {
    expect(dm.system).not.toContain('God is dead')
    expect(dm.system).not.toContain('betrothed')
    expect(dm.messages[0]!.content).toContain('God is dead')
    expect(dm.messages[0]!.content).toContain('she is betrothed')
    expect(akeno.messages[0]!.content).not.toContain('God is dead')
  })

  it('ends with the speaker’s own instructions', () => {
    expect(dm.messages).toHaveLength(1)
    expect(dm.messages[0]!.content).toMatch(/Write the DM's next message/)
    expect(akeno.messages[0]!.content).toContain('You are playing Akeno')
    expect(akeno.messages[0]!.content).toContain('Issei, Kiba')
    expect(akeno.messages[0]!.content).toMatch(/Write Akeno's next turn/)
  })

  it('strips a speaker label the model added', () => {
    expect(stripSpeakerLabel('Akeno: Thunder crackles.', 'Akeno')).toBe('Thunder crackles.')
    expect(stripSpeakerLabel('**DM:** The Stray howls.', 'DM')).toBe('The Stray howls.')
    expect(stripSpeakerLabel('Akeno smiles.', 'Akeno')).toBe('Akeno smiles.')
  })
})
