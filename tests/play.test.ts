import { describe, expect, it } from 'vitest'
import { aiSpeakers, findChecks, lastAiMessage, nextSpeaker, playModeOf, userRole, nextPartyTurn } from '../src/shared/play'
import { buildPrompt, DEFAULT_PLAYER_PROMPT, messageToTurn, normalizeBlockOrder, type PromptInput } from '../src/shared/prompt'
import type { Campaign, Message } from '../src/shared/types'

const msg = (id: string, role: Message['role'], text = `${role} ${id}`, extra: Partial<Message> = {}): Message => ({ id, role, text, swipes: [text], swipeIndex: 0, createdAt: '', ...extra })

describe('play modes', () => {
  it('defaults to the AI as DM', () => {
    expect(playModeOf(undefined)).toBe('ai-dm')
    expect(playModeOf({})).toBe('ai-dm')
    expect(playModeOf({ mode: 'ai-only' })).toBe('ai-only')
  })

  it('maps who writes what', () => {
    expect(aiSpeakers('ai-dm')).toEqual(['dm'])
    expect(aiSpeakers('user-dm')).toEqual(['player'])
    expect(aiSpeakers('ai-only')).toEqual(['dm', 'player'])
    expect(userRole('ai-dm')).toBe('player')
    expect(userRole('user-dm')).toBe('dm')
    expect(userRole('ai-only')).toBe('system')
  })

  it('alternates turns in AI-only play, with the DM answering rolls', () => {
    expect(nextSpeaker('ai-only', [])).toBe('dm')
    expect(nextSpeaker('ai-only', [msg('1', 'dm')])).toBe('player')
    expect(nextSpeaker('ai-only', [msg('1', 'dm'), msg('2', 'player')])).toBe('dm')
    expect(nextSpeaker('ai-only', [msg('1', 'dm'), msg('2', 'roll')])).toBe('dm')
    // Director's notes and hidden messages don't change whose turn it is.
    expect(nextSpeaker('ai-only', [msg('1', 'dm'), msg('2', 'system', 'Make it rain', { name: 'Director' })])).toBe('player')
    expect(nextSpeaker('ai-dm', [msg('1', 'dm')])).toBe('dm')
    expect(nextSpeaker('user-dm', [msg('1', 'player')])).toBe('player')
  })

  it('finds the newest AI-written message for the mode', () => {
    const ms = [msg('1', 'dm'), msg('2', 'player'), msg('3', 'roll')]
    expect(lastAiMessage('ai-dm', ms)?.id).toBe('1')
    expect(lastAiMessage('user-dm', ms)?.id).toBe('2')
    expect(lastAiMessage('ai-only', ms)?.id).toBe('2')
  })

  it('finds check requests', () => {
    expect(findChecks('Roll it. [CHECK perception DC 13] and [CHECK dex DC 14]')).toEqual([
      { target: 'perception', dc: 13 },
      { target: 'dex', dc: 14 }
    ])
    expect(findChecks('no checks here')).toEqual([])
  })
})

describe('prompts by speaker', () => {
  const campaign: Campaign = { path: 'C', name: 'Saltmere', setting: 'A foggy town', tone: 'Eerie', house_rules: '', lorebooks: [], body: 'SECRET: the harbourmaster rings the bell.' }
  const base: PromptInput = {
    userName: 'DM',
    character: { name: 'Kestrel', description: '{{char}} is a rogue.', personality: '', scenario: '', first_mes: '', mes_example: '', system_prompt: '', tags: [], creator_notes: '', alternate_greetings: [] } as unknown as PromptInput['character'],
    campaign,
    party: null,
    preset: null,
    lore: [],
    sheet: null,
    combat: null,
    summary: null,
    messages: [msg('1', 'dm', 'The fog parts.'), msg('2', 'player', 'I wave.', { name: 'Kestrel' }), msg('3', 'dm', 'She waves back.')],
    order: normalizeBlockOrder([]),
    budget: 8000,
    maxReplyTokens: 500,
    tokenizer: 'chars4',
    autoState: true
  }

  it('writes as the character with the player prompt and no DM secrets', () => {
    const p = buildPrompt({ ...base, speaker: 'player' })
    expect(p.system).toContain('You are playing Kestrel')
    expect(p.system).not.toContain('SECRET')
    expect(p.system).toContain('A foggy town')
    expect(p.system).not.toContain('<state>')
    // The DM's lines are the user turns; the character's are the assistant's.
    expect(p.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(p.blocks[0]!.label).toBe('Player prompt')
  })

  it('writes as the DM as before', () => {
    const p = buildPrompt({ ...base, userName: 'Kestrel' })
    expect(p.system).toContain('SECRET')
    expect(p.system).toContain('<state>')
    expect(p.messages.map((m) => m.role)).toEqual(['assistant', 'user', 'assistant'])
  })

  it('uses a custom player prompt when set', () => {
    const p = buildPrompt({ ...base, speaker: 'player', playerPrompt: 'Play {{char}} as a coward.' })
    expect(p.system).toContain('Play Kestrel as a coward.')
    expect(p.system).not.toContain(DEFAULT_PLAYER_PROMPT.slice(0, 30))
  })

  it('labels director notes', () => {
    expect(messageToTurn(msg('1', 'system', 'Introduce a storm.', { name: 'Director' }), 'DM')).toEqual({ role: 'user', content: '[Director: Introduce a storm.]' })
  })
})

describe('AI-only party turns', () => {
  const msg = (role: Message['role'], name?: string): Message => ({ id: Math.random().toString(36), role, ...(name ? { name } : {}), text: 'x', swipes: ['x'], swipeIndex: 0, createdAt: '' })
  const party = ['Issei', 'Kiba', 'Akeno']
  it('goes through the party in order, then the DM', () => {
    expect(nextPartyTurn([msg('dm')], party)).toEqual({ speaker: 'player', index: 0 })
    expect(nextPartyTurn([msg('dm'), msg('player', 'Issei')], party)).toEqual({ speaker: 'player', index: 1 })
    expect(nextPartyTurn([msg('dm'), msg('player', 'Issei'), msg('player', 'Kiba')], party)).toEqual({ speaker: 'player', index: 2 })
    expect(nextPartyTurn([msg('dm'), msg('player', 'Issei'), msg('player', 'Kiba'), msg('player', 'Akeno')], party)).toEqual({ speaker: 'dm' })
  })
  it('ignores director notes and dice, and starts over after the DM', () => {
    expect(nextPartyTurn([msg('dm'), msg('player', 'Issei'), msg('system', 'Director'), msg('roll', 'Kiba')], party)).toEqual({ speaker: 'player', index: 1 })
    expect(nextPartyTurn([msg('player', 'Issei'), msg('player', 'Kiba'), msg('player', 'Akeno'), msg('dm')], party)).toEqual({ speaker: 'player', index: 0 })
  })
})
