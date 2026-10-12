import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { classifyPath } from '../src/shared/layout'
import { npcCampaigns } from '../src/shared/npcs'
import {
  crossoverBlock,
  isUniverseLink,
  parseUniverseDraft,
  universeFolderFromLink,
  universeLink,
  withUniverse,
  type Universe
} from '../src/shared/universes'
import { VaultIndexer } from '../src/main/vault/indexer'
import { Vault } from '../src/main/vault/vault'

const ROOT = 'DND Tavern'
const SHATTER = 'DND Tavern/Universes/Shattered Realms'

describe('universe links', () => {
  it('reads universe folders from links in any form', () => {
    expect(universeFolderFromLink(universeLink(SHATTER, 'Shattered Realms'), ROOT)).toBe(SHATTER)
    expect(universeFolderFromLink('Universes/Shattered Realms/Universe', ROOT)).toBe(SHATTER)
    expect(universeFolderFromLink('Shattered Realms', ROOT)).toBe(SHATTER)
    expect(isUniverseLink('[[DND Tavern/Universes/Shattered Realms/Universe|Shattered Realms]]')).toBe(true)
    expect(isUniverseLink('[[DND Tavern/Campaigns/Frost/Campaign|Frost]]')).toBe(false)
  })

  it('classifies universe notes', () => {
    expect(classifyPath(ROOT, `${SHATTER}/Universe.md`)).toEqual({ kind: 'universe', universePath: SHATTER })
    expect(classifyPath(ROOT, `${SHATTER}/Notes.md`)).toBeNull()
  })
})

describe('campaigns in a universe', () => {
  const u: Universe = { path: SHATTER, name: 'Shattered Realms', blurb: '', setting: 'Floating islands above a storm sea.', tone: 'wonder', ruleset: 'pf2e', lorebooks: ['[[Realms lore]]'], body: '' }

  it('puts the universe bible first, adds its lorebooks and ruleset', () => {
    const c = withUniverse({ setting: 'Skyport intrigue.', lorebooks: ['[[Port lore]]'] as string[], ruleset: undefined as string | undefined }, u)
    expect(c.setting).toMatch(/^Universe: Shattered Realms\..*Floating islands.*\n\nThis campaign: Skyport intrigue\.$/s)
    expect(c.lorebooks).toEqual(['[[Port lore]]', '[[Realms lore]]'])
    expect(c.ruleset).toBe('pf2e')
    expect(withUniverse({ setting: '', lorebooks: [], ruleset: 'heroes' }, u).ruleset).toBe('heroes')
    expect(withUniverse({ setting: 'x', lorebooks: [] }, null)).toEqual({ setting: 'x', lorebooks: [] })
  })

  it('tells the DM about crossovers', () => {
    const text = crossoverBlock([{ name: 'Lyrian', from: 'the Frostborn universe', rules: 'Pathfinder 1st edition' }], { universe: 'Shattered Realms', rules: 'Superheroes' })
    expect(text).toMatch(/Lyrian comes from the Frostborn universe \(made under Pathfinder 1st edition\)/)
    expect(text).toMatch(/Translate their powers, gear and numbers into Superheroes/)
    expect(crossoverBlock([], { rules: 'x' })).toBe('')
  })

  it('counts NPCs that link to the universe in all its campaigns', () => {
    const campaigns = [
      { folder: 'DND Tavern/Campaigns/Skyport', links: [], universe: SHATTER },
      { folder: 'DND Tavern/Campaigns/Deeps', links: [], universe: SHATTER },
      { folder: 'DND Tavern/Campaigns/Frost', links: [] }
    ]
    expect(npcCampaigns('DND Tavern/NPCs/Queen.md', [`${SHATTER}/Universe`], campaigns)).toEqual(['DND Tavern/Campaigns/Skyport', 'DND Tavern/Campaigns/Deeps'])
  })

  it('reads an AI universe and drops a ruleset it does not know', () => {
    const d = parseUniverseDraft('{"name":"Shattered Realms","blurb":"Sky islands.","tone":"wonder","setting":"Floating islands.","ruleset":"gurps","places":[{"name":"Skyport","text":"A port."},{"name":"","text":"x"}],"factions":[],"history":[]}', ['dnd5e', 'pf2e'])
    expect(d).toMatchObject({ name: 'Shattered Realms', ruleset: '', places: [{ name: 'Skyport', text: 'A port.' }] })
    expect(parseUniverseDraft('not json', [])).toBeNull()
  })
})

describe('indexing universes', () => {
  let dir: string
  let vault: Vault
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dnd-universe-'))
    await mkdir(join(dir, '.obsidian'))
    vault = new Vault({ vaultPath: dir, rootFolder: ROOT })
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('expands a character added to a universe into its campaigns', async () => {
    await vault.write(`${SHATTER}/Universe.md`, '---\ntype: universe\nname: Shattered Realms\nruleset: pf2e\n---\n', { baseHash: null })
    await vault.write('DND Tavern/Campaigns/Skyport/Campaign.md', '---\nname: Skyport\nuniverse: "[[DND Tavern/Universes/Shattered Realms/Universe|Shattered Realms]]"\n---\n', { baseHash: null })
    await vault.write('DND Tavern/Campaigns/Frost/Campaign.md', '---\nname: Frost\n---\n', { baseHash: null })
    await vault.write('DND Tavern/Characters/Vex.md', '---\nname: Vex\ncampaigns:\n  - "[[DND Tavern/Universes/Shattered Realms/Universe|Shattered Realms]]"\n---\n', { baseHash: null })
    const indexer = new VaultIndexer(vault, { vaultName: 'Test', isObsidianVault: true })
    await indexer.build()
    const index = indexer.snapshot()
    expect(index.universes).toMatchObject([{ folder: SHATTER, displayName: 'Shattered Realms', ruleset: 'pf2e' }])
    expect(index.campaigns.find((c) => c.displayName === 'Skyport')?.universe).toBe(SHATTER)
    expect(index.characters[0]?.campaigns).toEqual(['DND Tavern/Campaigns/Skyport'])
    expect(index.characters[0]).not.toHaveProperty('universes')
  })
})
