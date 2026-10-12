import { describe, expect, it } from 'vitest'
import { BOND_PORTRAIT_LOOK, extractStory, parseBonds, renderBonds, setBond } from '@shared/bonds'
import { cardToFrontmatter, normalizeCard, normalizeParty } from '@shared/notes'
import { buildPrompt, renderCampaign } from '@shared/prompt'
import { PROMPT_BLOCK_IDS } from '@shared/types'

describe('relationships and big events', () => {
  it('strips the DM’s tags and reads them', () => {
    const r = extractStory(`They kiss under the snow.\n<bond>{"a":"Kazuki","b":"Seraphine","status":"Lovers"}</bond>\n<milestone>{"who":"Kazuki","event":"awakened Balance Breaker","look":"crimson dragon-scale armour"}</milestone>`)
    expect(r.text).toBe('They kiss under the snow.')
    expect(r.bonds).toEqual([{ a: 'Kazuki', b: 'Seraphine', status: 'lovers' }])
    expect(r.milestones).toEqual([{ who: 'Kazuki', event: 'awakened Balance Breaker', look: 'crimson dragon-scale armour' }])
  })

  it('ignores broken or self-referencing tags', () => {
    const r = extractStory('Hi <bond>{nope}</bond><bond>{"a":"A","b":"a","status":"friends"}</bond>')
    expect(r.text).toBe('Hi')
    expect(r.bonds).toEqual([])
  })

  it('updates a pair regardless of order, and reports the old status', () => {
    let bonds = parseBonds([{ a: 'Kazuki', b: 'Seraphine', status: 'dating' }, { a: 'x', b: 'x', status: 'friends' }])
    expect(bonds).toHaveLength(1)
    const r = setBond(bonds, { a: 'Seraphine', b: 'Kazuki', status: 'lovers', since: 'Session 03' })
    expect(r).toMatchObject({ previous: 'dating', changed: true })
    bonds = r.bonds
    expect(bonds[0]).toMatchObject({ a: 'Kazuki', b: 'Seraphine', status: 'lovers', since: 'Session 03' })
    expect(setBond(bonds, { a: 'Kazuki', b: 'Seraphine', status: 'lovers' }).changed).toBe(false)
    expect(renderBonds(bonds)).toBe('Relationships: Kazuki & Seraphine: lovers (since Session 03)')
    expect(BOND_PORTRAIT_LOOK.married).toBeTruthy()
  })

  it('keeps relationships in Party.md and shows them in the prompt', () => {
    const party = normalizeParty({ gold: 5, bonds: [{ a: 'Kazuki', b: 'Seraphine', status: 'engaged' }] }, '')
    expect(party.bonds).toHaveLength(1)
    expect(renderCampaign({ path: 'c', name: 'C', setting: '', tone: '', house_rules: '', lorebooks: [], body: '' }, party)).toContain('Kazuki & Seraphine: engaged')
  })

  it('asks the DM for story tags only when they’re on', () => {
    const input = { userName: 'P', character: null, campaign: null, party: null, preset: null, lore: [], sheet: null, combat: null, summary: null, messages: [], order: PROMPT_BLOCK_IDS.map((id) => ({ id, enabled: true })), budget: 8000, maxReplyTokens: 500, tokenizer: 'chars4' as const, autoState: false }
    expect(buildPrompt({ ...input, storyTags: true }).system).toContain('<bond>')
    expect(buildPrompt({ ...input, storyTags: false }).system).not.toContain('<bond>')
  })

  it('keeps a character’s portrait history in their note', () => {
    const card = normalizeCard({ name: 'K', avatar: 'a.png', portraits: [{ file: 'a.png', event: 'earlier portrait' }, { file: 'Campaigns/X/Images/k.png', event: 'became lovers with S', date: '2026-10-12' }, { nope: 1 }] }, 'K')
    expect(card.portraits).toHaveLength(2)
    expect(cardToFrontmatter(card).portraits).toEqual(card.portraits)
  })
})
