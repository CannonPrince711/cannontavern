import { describe, expect, it } from 'vitest'
import { builderPrompt, CampaignConceptSchema, draftCampaignBody, draftLore, emptyDraft, parseDraft } from '../src/shared/builder'

const SAMPLE = {
  name: 'The Ashen Crown',
  pitch: 'A stolen crown and a kingdom on the edge.',
  setting: 'The volcanic kingdom of Emberreach.',
  tone: 'Heroic with political intrigue.',
  houseRules: '',
  hook: 'The queen hires the party.',
  opening: 'Ash falls like snow.\nWhat do you do?',
  locations: [{ name: 'Cinderhold', description: 'The capital.', keys: ['capital', 'Cinderhold'] }, { name: '', description: 'nameless' }],
  npcs: [{ name: 'Queen Maelis Varn', role: 'Ruler', description: 'Tired but sharp.', personality: 'Proud', want: 'Her crown back', secret: 'She sold it herself.' }],
  factions: [{ name: 'The Soot Guild', goal: 'Control the mines', description: 'Miners turned smugglers.' }],
  outline: [{ title: 'Act 1', summary: 'The theft.' }],
  quests: ['Find the crown', ''],
  secrets: ['The crown is a fake.']
}

describe('campaign builder', () => {
  it('parses a draft wrapped in prose and code fences, dropping empty items', () => {
    const d = parseDraft('Sure!\n```json\n' + JSON.stringify(SAMPLE) + '\n```')
    expect(d.name).toBe('The Ashen Crown')
    expect(d.locations).toHaveLength(1)
    expect(d.locations[0]!.keys).toEqual(['capital', 'Cinderhold'])
    expect(d.quests).toEqual(['Find the crown'])
  })

  it('fills missing fields with defaults', () => {
    const d = parseDraft('{"name": "Bare"}')
    expect(d).toEqual({ ...emptyDraft('Bare') })
  })

  it('reports replies without usable JSON', () => {
    expect(() => parseDraft('I cannot do that.')).toThrow(/no JSON/)
    expect(() => parseDraft('{ broken json')).toThrow(/no JSON|invalid JSON/)
  })

  it('builds lore entries players may see, without secrets', () => {
    const lore = draftLore(parseDraft(JSON.stringify(SAMPLE)))
    expect(lore.map((e) => e.title)).toEqual(['The Ashen Crown', 'Cinderhold', 'The Soot Guild', 'Queen Maelis Varn'])
    expect(lore[0]!.always_on).toBe(true)
    expect(lore.find((e) => e.title === 'Queen Maelis Varn')!.keys).toEqual(['queen maelis varn', 'queen'])
    expect(JSON.stringify(lore)).not.toContain('sold it herself')
    expect(lore.find((e) => e.title === 'The Soot Guild')!.content).toContain('Goal: Control the mines')
  })

  it('puts the DM material in the campaign note body', () => {
    const body = draftCampaignBody(parseDraft(JSON.stringify(SAMPLE)))
    expect(body).toContain('## Opening scene\n> Ash falls like snow.\n> What do you do?')
    expect(body).toContain('- [[Queen Maelis Varn]], Ruler')
    expect(body).toContain('## Secrets (for the DM)\n- The crown is a fake.\n- Queen Maelis Varn: She sold it herself.')
  })

  it('describes the concept to the model', () => {
    const p = builderPrompt(CampaignConceptSchema.parse({ premise: 'Pirates vs. a kraken cult', tones: ['Swashbuckling'], length: 'one-shot', players: 3, mode: 'user-dm', avoid: 'spiders' }))
    expect(p).toContain('Premise: Pirates vs. a kraken cult')
    expect(p).toContain('Tone: Swashbuckling')
    expect(p).toContain('one-shot')
    expect(p).toContain('3 player characters')
    expect(p).toContain('A human DM will run it')
    expect(p).toContain('Keep out of the story: spiders')
    expect(p).toContain('Name: invent a fitting one')
  })
})
