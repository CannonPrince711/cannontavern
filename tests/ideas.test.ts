import { describe, expect, it } from 'vitest'
import { IDEA_DICE, IDEA_KINDS, IdeaRequestSchema, ideaMarkdown, ideasPrompt, parseIdeas, rollIdeaDice } from '../src/shared/ideas'

describe('idea dice', () => {
  it('rolls one line per idea with every column of the kind', () => {
    for (const { id } of IDEA_KINDS) {
      const rolls = rollIdeaDice(id, 4)
      expect(rolls).toHaveLength(4)
      for (const r of rolls) for (const { label } of IDEA_DICE[id]) expect(r).toContain(`${label}: `)
    }
  })

  it('never repeats an ingredient within a batch while the table lasts', () => {
    const rolls = rollIdeaDice('character', 6)
    const who = rolls.map((r) => r.split(' | ')[0])
    expect(new Set(who).size).toBe(6)
  })

  it('is deterministic for a given random source', () => {
    let s = 1
    const rand = (): number => ((s = (s * 16807) % 2147483647) - 1) / 2147483646
    const a = rollIdeaDice('universe', 3, rand)
    s = 1
    expect(rollIdeaDice('universe', 3, rand)).toEqual(a)
  })
})

describe('idea prompt', () => {
  it('includes the rolls, vibes, theme and the adult line only when given', () => {
    const req = IdeaRequestSchema.parse({ kind: 'oneshot', count: 2, vibes: ['Horror'], theme: 'a lighthouse' })
    const p = ideasPrompt(req, ['Place: x', 'Place: y'], 'Every character is an adult (21 or older).')
    expect(p).toContain('1. Place: x')
    expect(p).toContain('Vibe for all of them: Horror.')
    expect(p).toContain('The player wants: a lighthouse')
    expect(p).toContain('21 or older')
    expect(ideasPrompt(req, ['Place: x'])).not.toContain('adult')
  })

  it('asks characters for race and class, not settings', () => {
    const p = ideasPrompt(IdeaRequestSchema.parse({ kind: 'character' }), ['Who: a'])
    expect(p).toContain('"race"')
    expect(p).not.toContain('Setting list')
  })
})

describe('parseIdeas', () => {
  const reply =
    'Here you go!\n```json\n' +
    JSON.stringify({
      ideas: [
        { title: 'Kettle Bridge', pitch: 'A rigged tournament.', details: ['Where: a bridge', 'Goal: win'], premise: 'A heist comedy on a bridge.', tones: ['heist', 'Comedic', 'Made up'], settings: ['City of intrigue', 'Nowhere'] },
        { title: '', pitch: 'no title, dropped' },
        { title: 'Loose', pitch: 'Only a pitch', details: 'one detail as a string' }
      ]
    }) +
    '\n```'

  it('reads ideas wrapped in prose and fences, keeping only known tones and settings', () => {
    const ideas = parseIdeas(reply, 'oneshot')
    expect(ideas.map((i) => i.title)).toEqual(['Kettle Bridge', 'Loose'])
    expect(ideas[0]!.kind).toBe('oneshot')
    expect(ideas[0]!.tones).toEqual(['Heist', 'Comedic'])
    expect(ideas[0]!.settings).toEqual(['City of intrigue'])
  })

  it('fills a missing premise from the pitch and details, and accepts a bare array', () => {
    const [loose] = parseIdeas(reply, 'campaign').slice(1)
    expect(loose!.details).toEqual(['one detail as a string'])
    expect(loose!.premise).toContain('Only a pitch')
    expect(parseIdeas('[{"title":"A","pitch":"b"}]', 'universe')).toHaveLength(1)
  })

  it('returns nothing for an unreadable reply', () => {
    expect(parseIdeas('sorry, no', 'campaign')).toEqual([])
  })
})

describe('ideaMarkdown', () => {
  it('writes a dated section with details and the premise', () => {
    const [idea] = parseIdeas('{"ideas":[{"title":"Wick Marrow","pitch":"An actor.","details":["Flaw: bets"],"premise":"A changeling.","race":"Changeling","cls":"Bard"}]}', 'character')
    const md = ideaMarkdown(idea!, new Date('2026-11-23T12:00:00Z'))
    expect(md).toContain('## Wick Marrow *(character, 2026-11-23)*')
    expect(md).toContain('- Flaw: bets')
    expect(md).toContain('- Changeling Bard')
    expect(md).toContain('> A changeling.')
  })
})
