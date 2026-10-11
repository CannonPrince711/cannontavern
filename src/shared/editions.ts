/**
 * Rules editions: D&D 5th edition (default) and D&D 3.5 edition, plus the
 * sourcebooks (core and expansions) a campaign can allow.
 */
import type { AbilityKey } from './types'

export const EDITIONS = ['5e', '3.5e'] as const
export type Edition = (typeof EDITIONS)[number]

export const EDITION_INFO: Record<Edition, { label: string; short: string }> = {
  '5e': { label: 'D&D 5th edition', short: '5e' },
  '3.5e': { label: 'D&D 3.5 edition', short: '3.5e' }
}

export function isEdition(v: unknown): v is Edition {
  return typeof v === 'string' && (EDITIONS as readonly string[]).includes(v)
}

export function editionOf(x: { edition?: Edition } | null | undefined): Edition {
  return x?.edition ?? '5e'
}

// ─── 3.5 rules data ─────────────────────────────────────────────────────────

/** 3.5 skills with their key abilities (core, plus Expanded Psionics Handbook). */
export const SKILLS_35: { key: string; name: string; ability: AbilityKey; trainedOnly?: boolean; source?: string }[] = [
  { key: 'appraise', name: 'Appraise', ability: 'int' },
  { key: 'balance', name: 'Balance', ability: 'dex' },
  { key: 'bluff', name: 'Bluff', ability: 'cha' },
  { key: 'climb', name: 'Climb', ability: 'str' },
  { key: 'concentration', name: 'Concentration', ability: 'con' },
  { key: 'craft', name: 'Craft', ability: 'int' },
  { key: 'decipher script', name: 'Decipher Script', ability: 'int', trainedOnly: true },
  { key: 'diplomacy', name: 'Diplomacy', ability: 'cha' },
  { key: 'disable device', name: 'Disable Device', ability: 'int', trainedOnly: true },
  { key: 'disguise', name: 'Disguise', ability: 'cha' },
  { key: 'escape artist', name: 'Escape Artist', ability: 'dex' },
  { key: 'forgery', name: 'Forgery', ability: 'int' },
  { key: 'gather information', name: 'Gather Information', ability: 'cha' },
  { key: 'handle animal', name: 'Handle Animal', ability: 'cha', trainedOnly: true },
  { key: 'heal', name: 'Heal', ability: 'wis' },
  { key: 'hide', name: 'Hide', ability: 'dex' },
  { key: 'intimidate', name: 'Intimidate', ability: 'cha' },
  { key: 'jump', name: 'Jump', ability: 'str' },
  { key: 'knowledge (arcana)', name: 'Knowledge (arcana)', ability: 'int', trainedOnly: true },
  { key: 'knowledge (architecture and engineering)', name: 'Knowledge (architecture and engineering)', ability: 'int', trainedOnly: true },
  { key: 'knowledge (dungeoneering)', name: 'Knowledge (dungeoneering)', ability: 'int', trainedOnly: true },
  { key: 'knowledge (geography)', name: 'Knowledge (geography)', ability: 'int', trainedOnly: true },
  { key: 'knowledge (history)', name: 'Knowledge (history)', ability: 'int', trainedOnly: true },
  { key: 'knowledge (local)', name: 'Knowledge (local)', ability: 'int', trainedOnly: true },
  { key: 'knowledge (nature)', name: 'Knowledge (nature)', ability: 'int', trainedOnly: true },
  { key: 'knowledge (nobility and royalty)', name: 'Knowledge (nobility and royalty)', ability: 'int', trainedOnly: true },
  { key: 'knowledge (religion)', name: 'Knowledge (religion)', ability: 'int', trainedOnly: true },
  { key: 'knowledge (the planes)', name: 'Knowledge (the planes)', ability: 'int', trainedOnly: true },
  { key: 'listen', name: 'Listen', ability: 'wis' },
  { key: 'move silently', name: 'Move Silently', ability: 'dex' },
  { key: 'open lock', name: 'Open Lock', ability: 'dex', trainedOnly: true },
  { key: 'perform', name: 'Perform', ability: 'cha' },
  { key: 'profession', name: 'Profession', ability: 'wis', trainedOnly: true },
  { key: 'ride', name: 'Ride', ability: 'dex' },
  { key: 'search', name: 'Search', ability: 'int' },
  { key: 'sense motive', name: 'Sense Motive', ability: 'wis' },
  { key: 'sleight of hand', name: 'Sleight of Hand', ability: 'dex', trainedOnly: true },
  { key: 'spellcraft', name: 'Spellcraft', ability: 'int', trainedOnly: true },
  { key: 'spot', name: 'Spot', ability: 'wis' },
  { key: 'survival', name: 'Survival', ability: 'wis' },
  { key: 'swim', name: 'Swim', ability: 'str' },
  { key: 'tumble', name: 'Tumble', ability: 'dex', trainedOnly: true },
  { key: 'use magic device', name: 'Use Magic Device', ability: 'cha', trainedOnly: true },
  { key: 'use rope', name: 'Use Rope', ability: 'dex' },
  { key: 'autohypnosis', name: 'Autohypnosis', ability: 'wis', trainedOnly: true, source: 'Expanded Psionics Handbook' },
  { key: 'psicraft', name: 'Psicraft', ability: 'int', trainedOnly: true, source: 'Expanded Psionics Handbook' },
  { key: 'use psionic device', name: 'Use Psionic Device', ability: 'cha', trainedOnly: true, source: 'Expanded Psionics Handbook' }
]

/** 5e skill names a model might use in a 3.5 game, mapped to the 3.5 skill. */
export const SKILL_ALIASES_35: Record<string, string> = {
  perception: 'spot',
  stealth: 'hide',
  investigation: 'search',
  insight: 'sense motive',
  persuasion: 'diplomacy',
  deception: 'bluff',
  acrobatics: 'tumble',
  athletics: 'climb',
  arcana: 'knowledge (arcana)',
  religion: 'knowledge (religion)',
  history: 'knowledge (history)',
  nature: 'knowledge (nature)',
  medicine: 'heal',
  performance: 'perform',
  intimidation: 'intimidate',
  'animal handling': 'handle animal'
}

export const SAVES_35 = [
  { key: 'fort', name: 'Fortitude', ability: 'con' as AbilityKey },
  { key: 'ref', name: 'Reflex', ability: 'dex' as AbilityKey },
  { key: 'will', name: 'Will', ability: 'wis' as AbilityKey }
] as const
export type Save35 = (typeof SAVES_35)[number]['key']

export const CONDITIONS_35 = [
  'blinded', 'confused', 'cowering', 'dazed', 'dazzled', 'deafened', 'disabled', 'dying', 'energy drained', 'entangled',
  'exhausted', 'fascinated', 'fatigued', 'flat-footed', 'frightened', 'grappling', 'helpless', 'invisible', 'nauseated',
  'panicked', 'paralyzed', 'petrified', 'pinned', 'prone', 'shaken', 'sickened', 'stable', 'staggered', 'stunned', 'unconscious'
]

/** 3.5 experience: level n needs 1,000 × n(n−1)/2 XP. */
export function xpForLevel35(level: number): number {
  const l = Math.max(1, Math.min(20, level))
  return (1000 * l * (l - 1)) / 2
}

export function levelForXp35(xp: number): number {
  let level = 1
  for (let l = 2; l <= 20; l++) if (xp >= xpForLevel35(l)) level = l
  return level
}

// ─── Sourcebooks ────────────────────────────────────────────────────────────

export interface Sourcebook {
  name: string
  group: string
  core?: boolean
}

export const SOURCEBOOKS: Record<Edition, Sourcebook[]> = {
  '5e': [
    { name: "Player's Handbook", group: 'Core', core: true },
    { name: "Dungeon Master's Guide", group: 'Core', core: true },
    { name: 'Monster Manual', group: 'Core', core: true },
    { name: "Xanathar's Guide to Everything", group: 'Player options' },
    { name: "Tasha's Cauldron of Everything", group: 'Player options' },
    { name: 'The Book of Many Things', group: 'Player options' },
    { name: "Fizban's Treasury of Dragons", group: 'Player options' },
    { name: "Sword Coast Adventurer's Guide", group: 'Player options' },
    { name: 'Mordenkainen Presents: Monsters of the Multiverse', group: 'Monsters' },
    { name: "Volo's Guide to Monsters", group: 'Monsters' },
    { name: "Mordenkainen's Tome of Foes", group: 'Monsters' },
    { name: 'Bigby Presents: Glory of the Giants', group: 'Monsters' },
    { name: 'Eberron: Rising from the Last War', group: 'Settings' },
    { name: "Explorer's Guide to Wildemount", group: 'Settings' },
    { name: 'Mythic Odysseys of Theros', group: 'Settings' },
    { name: "Guildmasters' Guide to Ravnica", group: 'Settings' },
    { name: "Van Richten's Guide to Ravenloft", group: 'Settings' },
    { name: 'Strixhaven: A Curriculum of Chaos', group: 'Settings' },
    { name: 'Spelljammer: Adventures in Space', group: 'Settings' },
    { name: 'Planescape: Adventures in the Multiverse', group: 'Settings' }
  ],
  '3.5e': [
    { name: "Player's Handbook (3.5)", group: 'Core', core: true },
    { name: "Dungeon Master's Guide (3.5)", group: 'Core', core: true },
    { name: 'Monster Manual (3.5)', group: 'Core', core: true },
    { name: "Player's Handbook II", group: 'Player options' },
    { name: 'Complete Warrior', group: 'Player options' },
    { name: 'Complete Divine', group: 'Player options' },
    { name: 'Complete Arcane', group: 'Player options' },
    { name: 'Complete Adventurer', group: 'Player options' },
    { name: 'Complete Mage', group: 'Player options' },
    { name: 'Complete Champion', group: 'Player options' },
    { name: 'Complete Scoundrel', group: 'Player options' },
    { name: 'Races of Stone', group: 'Player options' },
    { name: 'Races of Destiny', group: 'Player options' },
    { name: 'Races of the Wild', group: 'Player options' },
    { name: 'Races of the Dragon', group: 'Player options' },
    { name: 'Unearthed Arcana', group: 'Player options' },
    { name: 'Tome of Battle: The Book of Nine Swords', group: 'Player options' },
    { name: 'Tome of Magic', group: 'Player options' },
    { name: 'Dragon Magic', group: 'Player options' },
    { name: 'Weapons of Legacy', group: 'Player options' },
    { name: 'Spell Compendium', group: 'Magic' },
    { name: 'Magic Item Compendium', group: 'Magic' },
    { name: 'Book of Exalted Deeds', group: 'Magic' },
    { name: 'Book of Vile Darkness', group: 'Magic' },
    { name: 'Expanded Psionics Handbook', group: 'Psionics' },
    { name: 'Complete Psionic', group: 'Psionics' },
    { name: "Dungeon Master's Guide II", group: 'DM tools' },
    { name: 'Heroes of Battle', group: 'DM tools' },
    { name: 'Heroes of Horror', group: 'DM tools' },
    { name: 'Dungeonscape', group: 'DM tools' },
    { name: 'Cityscape', group: 'DM tools' },
    { name: 'Monster Manual II', group: 'Monsters' },
    { name: 'Monster Manual III', group: 'Monsters' },
    { name: 'Monster Manual IV', group: 'Monsters' },
    { name: 'Monster Manual V', group: 'Monsters' },
    { name: 'Fiend Folio', group: 'Monsters' },
    { name: 'Draconomicon', group: 'Monsters' },
    { name: 'Libris Mortis', group: 'Monsters' },
    { name: 'Lords of Madness', group: 'Monsters' },
    { name: 'Frostburn', group: 'Environments' },
    { name: 'Sandstorm', group: 'Environments' },
    { name: 'Stormwrack', group: 'Environments' },
    { name: 'Manual of the Planes', group: 'Environments' },
    { name: 'Planar Handbook', group: 'Environments' },
    { name: 'Deities and Demigods', group: 'Settings' },
    { name: 'Epic Level Handbook', group: 'Settings' },
    { name: 'Eberron Campaign Setting', group: 'Settings' },
    { name: 'Races of Eberron', group: 'Settings' },
    { name: 'Forgotten Realms Campaign Setting', group: 'Settings' },
    { name: "Player's Guide to Faerûn", group: 'Settings' },
    { name: 'Magic of Faerûn', group: 'Settings' }
  ]
}

/** The rules line for the prompt: edition, allowed books and how to ask for checks. */
export function rulesLine(edition: Edition, sources: string[]): string {
  const books = sources.length ? sources.join(', ') : edition === '3.5e' ? 'the core rulebooks' : 'the core rulebooks'
  if (edition === '3.5e') {
    return [
      `Rules: Dungeons & Dragons 3.5 edition (not 5th edition). Allowed sources: ${books}. Use 3.5 mechanics: skill ranks, base attack bonus, Fortitude/Reflex/Will saves, attacks of opportunity, flat-footed AC, and 3.5 spells, feats and prestige classes from the allowed books.`,
      'Ask for checks with 3.5 skill or save names, e.g. [CHECK spot DC 15], [CHECK move silently DC 12] or [CHECK reflex DC 14].'
    ].join(' ')
  }
  return `Rules: Dungeons & Dragons 5th edition. Allowed sources: ${books}.`
}
