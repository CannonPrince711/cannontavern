import { describe, expect, it } from 'vitest'
import { buildPartyPrompt } from '@shared/prompt'
import { linkLabel, nextPartyTurn, PARTY_LIMITS } from '@shared/play'
import { PROMPT_BLOCK_IDS, type Message } from '@shared/types'
import { SettingsSchema, TextBackendSchema } from '@shared/settings'
import { applyWorld, worldGroups } from '@shared/world'
import { partyOf } from '../src/main/sessions'
import { backendChain } from '../src/main/backends/chain'

const card = (name: string) => ({ name, description: `${name}.`, personality: '', scenario: '', first_mes: '', mes_example: '', system_prompt: '', tags: [] })
const msg = (id: string, role: Message['role'], text: string, name?: string): Message => ({ id, role, ...(name ? { name } : {}), text, swipes: [text], swipeIndex: 0, createdAt: '' })

describe('AI-only party groups', () => {
  it('reads groups leniently and caps them at 3 leads with 2 companions each', () => {
    const raw = [
      { lead: '[[A|Ren]]', companions: ['[[B|Mai]]', '[[C|Sora]]', '[[D|Extra]]'] },
      { lead: '[[E|Kai]]' },
      { nope: true },
      { lead: '[[F|Yui]]', companions: [] },
      { lead: '[[G|Fourth]]', companions: [] }
    ]
    const g = partyOf(raw)!
    expect(g.map((x) => x.lead)).toEqual(['[[A|Ren]]', '[[E|Kai]]', '[[F|Yui]]'])
    expect(g[0]!.companions).toHaveLength(PARTY_LIMITS.companions)
    expect(g[1]!.companions).toEqual([])
    expect(partyOf('x')).toBeUndefined()
    expect(partyOf([])).toBeUndefined()
  })

  it('labels wikilinks by alias, else by note name', () => {
    expect(linkLabel('[[DND Vault/NPCs/Ashara Dell|Ashara]]')).toBe('Ashara')
    expect(linkLabel('[[DND Vault/NPCs/Ashara Dell.md]]')).toBe('Ashara Dell')
    expect(linkLabel('Plain')).toBe('Plain')
  })

  it('lets every member act once, in group order, before the DM', () => {
    const order = ['Ren', 'Mai', 'Sora', 'Kai', 'Yui']
    const done = [msg('1', 'dm', 'Go.'), msg('2', 'player', 'a', 'Ren'), msg('3', 'player', 'b', 'Mai')]
    expect(nextPartyTurn(done, order)).toEqual({ speaker: 'player', index: 2 })
    const all = [msg('1', 'dm', 'Go.'), ...order.map((n, i) => msg(`p${i}`, 'player', 'x', n))]
    expect(nextPartyTurn(all, order)).toEqual({ speaker: 'dm' })
  })

  it('tells everyone who leads whom, and each member their place', () => {
    const input = {
      userName: 'Ren',
      partyCards: ['Ren', 'Mai', 'Kai'].map(card),
      groups: [{ lead: 'Ren', companions: ['Mai'] }, { lead: 'Kai', companions: [] }],
      campaign: null,
      party: null,
      preset: null,
      lore: [],
      combat: null,
      summary: null,
      messages: [msg('1', 'dm', 'Go.')],
      order: PROMPT_BLOCK_IDS.map((id) => ({ id, enabled: true })),
      budget: 8000,
      maxReplyTokens: 500,
      tokenizer: 'chars4' as const,
      autoState: false
    }
    const dm = buildPartyPrompt({ ...input, turn: { speaker: 'dm' } })
    expect(dm.system).toContain('They travel in groups: Ren leads Mai.')
    const mai = buildPartyPrompt({ ...input, turn: { speaker: 'player', name: 'Mai' } })
    expect(mai.messages[0]!.content).toContain('Mai follows Ren')
    const ren = buildPartyPrompt({ ...input, turn: { speaker: 'player', name: 'Ren' } })
    expect(ren.messages[0]!.content).toContain('Ren leads Mai')
    const kai = buildPartyPrompt({ ...input, turn: { speaker: 'player', name: 'Kai' } })
    expect(kai.messages[0]!.content).not.toMatch(/leads|follows/)
    // Every speaker still shares the same prompt up to their own part.
    expect(mai.system).toBe(dm.system)
  })
})

describe('separate DM and character models', () => {
  const tb = (id: string) => TextBackendSchema.parse({ id, name: id, type: 'openai', baseUrl: 'http://127.0.0.1:8080/v1', model: id })
  const base = SettingsSchema.parse({ textBackends: [tb('gemsicle'), tb('valkyrie')], defaultTextBackendId: 'gemsicle' })

  it('uses the Characters backend for characters, falling back to the DM’s', () => {
    expect(backendChain(base, 'character')[0]!.id).toBe('gemsicle')
    const dmSet = { ...base, roles: { ...base.roles, chat: 'valkyrie' } }
    expect(backendChain(dmSet, 'chat')[0]!.id).toBe('valkyrie')
    expect(backendChain(dmSet, 'character')[0]!.id).toBe('valkyrie')
    const both = { ...dmSet, roles: { ...dmSet.roles, character: 'gemsicle' } }
    expect(backendChain(both, 'chat')[0]!.id).toBe('valkyrie')
    expect(backendChain(both, 'character')[0]!.id).toBe('gemsicle')
  })

  it('lets a world pick the characters’ backend', () => {
    const w = applyWorld(base, { text_backend: 'valkyrie', character_backend: 'gemsicle' })
    expect(w.roles.chat).toBe('valkyrie')
    expect(w.roles.character).toBe('gemsicle')
    expect(applyWorld(base, { character_backend: 'missing' }).roles.character).toBeNull()
    expect(worldGroups({ character_backend: 'gemsicle' })).toEqual(['text'])
  })
})
