import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { builderPrompt, CampaignConceptSchema, draftCampaignBody, draftLore, draftSection, emptyDraft, escapeStrayQuotes, missingSections, parseDraft, parseSections, PREMISE_MAX, restPrompt } from '../src/shared/builder'
import { describeIssues, fieldLabel } from '../src/shared/validation'

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
    const d = parseDraft('{"name": "Bare", "pitch": "Just a pitch."}')
    expect(d).toEqual({ ...emptyDraft('Bare'), pitch: 'Just a pitch.' })
    // A name alone isn't a campaign.
    expect(() => parseDraft('{"name": "Bare"}')).toThrow(/no campaign/)
  })

  it('reports replies without usable JSON', () => {
    expect(() => parseDraft('I cannot do that.')).toThrow(/no JSON/)
    expect(() => parseDraft('{ broken json')).toThrow(/no campaign|couldn’t be read/)
  })

  it('builds lore entries players may see, without secrets', () => {
    const lore = draftLore(parseDraft(JSON.stringify(SAMPLE)))
    // NPCs get their own notes, which reach the prompt by themselves.
    expect(lore.map((e) => e.title)).toEqual(['The Ashen Crown', 'Cinderhold', 'The Soot Guild'])
    expect(lore[0]!.always_on).toBe(true)
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

describe('campaign builder: messy model output', () => {
  it('repairs trailing commas, comments, single quotes and line breaks in strings', () => {
    const reply = `Sure! Here's your campaign:
{
  // a comment
  'name': 'The Salt Throne',
  "setting": "A drowned kingdom
where tides rule.",
  "locations": [{"name": "Brinegate", "description": "A harbour.",},],
}
Hope you like it!`
    const d = parseDraft(reply)
    expect(d.name).toBe('The Salt Throne')
    expect(d.setting).toContain('tides rule')
    expect(d.locations[0]!.name).toBe('Brinegate')
  })

  it('salvages a reply that was cut off mid-way', () => {
    const d = parseDraft('{"name": "Cut Short", "pitch": "A story.", "npcs": [{"name": "Ola", "role": "Smith"}, {"name": "Bex", "ro')
    expect(d.name).toBe('Cut Short')
    expect(d.npcs[0]).toMatchObject({ name: 'Ola', role: 'Smith' })
  })

  it('accepts other key names, string lists and wrapped objects', () => {
    const d = parseDraft(JSON.stringify({
      campaign: {
        Title: 'Ember Road',
        'House Rules': 'Flanking gives advantage.',
        Opening_Scene: 'Smoke on the horizon.',
        Places: ['Ashford – a mining town', 'The Kiln: an old fortress'],
        Characters: { 'Mara Voss': { occupation: 'Mayor', motivation: 'Keep the mines open' } },
        Acts: [{ name: 'Act 1', description: 'Arrival' }],
        Objectives: 'Find the missing miners\nReach the Kiln'
      }
    }))
    expect(d.name).toBe('Ember Road')
    expect(d.houseRules).toBe('Flanking gives advantage.')
    expect(d.opening).toBe('Smoke on the horizon.')
    expect(d.locations.map((l) => [l.name, l.description])).toEqual([['Ashford', 'a mining town'], ['The Kiln', 'an old fortress']])
    expect(d.npcs[0]).toMatchObject({ name: 'Mara Voss', role: 'Mayor', want: 'Keep the mines open' })
    expect(d.outline[0]).toMatchObject({ title: 'Act 1', summary: 'Arrival' })
    expect(d.quests).toEqual(['Find the missing miners', 'Reach the Kiln'])
  })

  it('trims instead of rejecting over-long output', () => {
    const d = parseDraft(JSON.stringify({ name: 'Big', locations: Array.from({ length: 30 }, (_, i) => ({ name: `Place ${i}` })), opening: 'x'.repeat(10_000) }))
    expect(d.locations).toHaveLength(12)
    expect(d.opening.length).toBe(6000)
  })

  it('asks a compact prompt for retries', () => {
    expect(builderPrompt(CampaignConceptSchema.parse({ length: 'long' }), { compact: true })).toContain('3 locations, 3 NPCs')
  })
})

describe('campaign builder: long premises', () => {
  it('accepts a whole pasted campaign prompt, up to the limit', () => {
    expect(CampaignConceptSchema.safeParse({ premise: 'x'.repeat(PREMISE_MAX) }).success).toBe(true)
    expect(CampaignConceptSchema.safeParse({ premise: 'x'.repeat(PREMISE_MAX + 1) }).success).toBe(false)
  })

  it('explains a rejected field in words', () => {
    const premise = 'x'.repeat(PREMISE_MAX + 200)
    const result = z.tuple([CampaignConceptSchema]).safeParse([{ premise }])
    expect(result.success).toBe(false)
    expect(describeIssues(result.error!, [{ premise }])).toBe('Premise is too long: 12,200 characters, the limit is 12,000.')
  })

  it('names fields readably', () => {
    expect(fieldLabel('houseRules')).toBe('House rules')
    expect(fieldLabel('max_tokens')).toBe('Max tokens')
  })
})

describe('campaign builder: quotes inside text', () => {
  it('reads a real reply with dialogue and nicknames in double quotes', () => {
    const reply = readFileSync(new URL('./fixtures/draft-stray-quotes.txt', import.meta.url), 'utf8')
    const d = parseDraft(reply)
    expect(d.name).toBe("The Shadow's Eminence")
    expect(d.hook).toContain('the mysterious vigilante, "Shadow," fighting the diabolical Diabolos Cult')
    expect(d.opening).toContain('"Lord Shadow! The safehouse has been breached.')
    expect(d.opening).toContain('You allow yourself a slight, unseen smile.')
    expect(d.locations.map((l) => l.name)).toEqual(['Midgar Academy', 'The Undercity'])
    expect(d.npcs[0]).toMatchObject({ name: 'Alpha', want: 'To serve "Lord Shadow"' })
    expect(d.quests).toEqual(['Rescue the agent'])
  })

  it('also reads it when the reply was cut off', () => {
    const reply = readFileSync(new URL('./fixtures/draft-stray-quotes.txt', import.meta.url), 'utf8').slice(0, 1500)
    const d = parseDraft(reply)
    expect(d.hook).toContain('"Shadow,"')
  })

  it('leaves valid JSON alone', () => {
    const valid = JSON.stringify({ a: 'say "hi", then go', b: ['x', 1, true, null], c: { d: 'line\nbreak' } }, null, 2)
    expect(escapeStrayQuotes(valid)).toBe(valid)
  })
})

describe('campaign builder: progress while streaming', () => {
  it('names the part of the campaign being written, ignoring nested keys', () => {
    expect(draftSection('')).toBeNull()
    expect(draftSection('{"name": "Shadow Gar')).toBe('the premise')
    expect(draftSection('{"name": "X", "locations": [{"name": "Midgar", "description": "The ca')).toBe('places')
    expect(draftSection('{"name": "X", "locations": [], "npcs": [{"name": "Alpha", "role": "Knight"')).toBe('NPCs')
    expect(draftSection('{"name": "Say \\"npcs\\": nothing", "hook": "A')).toBe('the hook')
  })
})

describe('campaign builder: a reply cut off before the lists', () => {
  const cut = '{"name": "The Devil\'s Peerage", "pitch": "Students by day, Devils by night.", "setting": "A modern city.", "hook": "A Stray kills a client.", "opening": "Rain on the clubroom win'
  it('keeps the overview and lists what never arrived', () => {
    const d = parseDraft(cut)
    expect(d.name).toBe("The Devil's Peerage")
    expect(missingSections(d)).toEqual(['locations', 'npcs', 'factions', 'outline', 'quests', 'secrets'])
  })
  it('asks for only the missing sections, with the overview and concept as context', () => {
    const d = parseDraft(cut)
    const p = restPrompt(CampaignConceptSchema.parse({ premise: 'High School DxD with Evil Pieces', length: 'long', edition: '3.5e', levels: '1–20' }), d, ['locations', 'npcs'])
    expect(p).toContain("Name: The Devil's Peerage")
    expect(p).toContain('Original concept (for names and lore): High School DxD')
    expect(p).toContain('"locations": [')
    expect(p).toContain('"npcs": [')
    expect(p).not.toContain('"factions"')
    expect(p).toContain('D&D 3.5 edition; character levels 1–20')
  })
  it('reads a reply that holds only lists', () => {
    const more = parseSections('{"locations": [{"name": "Kuoh Academy", "description": "The school."}], "npcs": [{"name": "Rias", "role": "King"}]}')
    expect(more.locations[0]!.name).toBe('Kuoh Academy')
    expect(more.npcs[0]!.role).toBe('King')
  })
})
