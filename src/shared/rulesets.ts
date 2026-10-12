/**
 * Rulesets: the game a campaign plays. Each one runs on one of the two sheet
 * engines (5e-style or 3.5e-style, see editions.ts) and adds its own rules
 * text for the DM, its classes and ancestries, and the names it uses for them.
 *
 * Built-in rulesets live here. Custom ones are notes in Rulesets/ (written by
 * hand or by the AI): frontmatter for the lists, the body for the rules.
 */
import { rulesLine, type Edition } from './editions'
import { joinVaultPath, wikilinkTarget } from './names'

export interface RulesetTerms {
  /** What the sheet's "race" is called: Ancestry, Origin, Species… */
  race: string
  /** What "class" is called: Archetype, Role… */
  class: string
  /** What "level" is called: Power level, Rank… */
  level: string
  /** What "spells" are called: Powers, Tech… */
  spells: string
}

export interface Ruleset {
  /** Built-in id ("pf2e"), or the vault path of a custom ruleset note. */
  id: string
  name: string
  short: string
  /** Sheet engine. */
  engine: Edition
  /** The app recalculates HP, attack and saves from the class tables. Off for games that count differently. */
  math: boolean
  /** Fine-tunes the engine's maths (Pathfinder 1e counts feats and skill ranks its own way). */
  variant?: 'pf1e'
  /** D&D: the campaign picks sourcebooks. */
  sourcebooks: boolean
  /** Rules for the DM, sent with every reply. */
  rules: string
  classes: string[]
  ancestries: string[]
  terms: RulesetTerms
  /** One line on what the game is, for pickers. */
  blurb: string
  custom?: boolean
}

const DND_TERMS: RulesetTerms = { race: 'Race', class: 'Class', level: 'Level', spells: 'Spells' }

export const BUILTIN_RULESETS: Ruleset[] = [
  {
    id: 'dnd5e',
    name: 'D&D 5th edition',
    short: '5e',
    engine: '5e',
    math: true,
    sourcebooks: true,
    rules: '',
    classes: ['Barbarian', 'Bard', 'Cleric', 'Druid', 'Fighter', 'Monk', 'Paladin', 'Ranger', 'Rogue', 'Sorcerer', 'Warlock', 'Wizard', 'Artificer'],
    ancestries: ['Human', 'Elf', 'Dwarf', 'Halfling', 'Gnome', 'Half-Elf', 'Half-Orc', 'Tiefling', 'Dragonborn'],
    terms: { ...DND_TERMS, race: 'Species' },
    blurb: 'Classic fantasy with advantage, proficiency and short rests.'
  },
  {
    id: 'dnd35',
    name: 'D&D 3.5 edition',
    short: '3.5e',
    engine: '3.5e',
    math: true,
    sourcebooks: true,
    rules: '',
    classes: ['Barbarian', 'Bard', 'Cleric', 'Druid', 'Fighter', 'Monk', 'Paladin', 'Ranger', 'Rogue', 'Sorcerer', 'Wizard'],
    ancestries: ['Human', 'Elf', 'Dwarf', 'Halfling', 'Gnome', 'Half-Elf', 'Half-Orc'],
    terms: DND_TERMS,
    blurb: 'Crunchy fantasy: skill ranks, base attack, feats and prestige classes.'
  },
  {
    id: 'pf1e',
    name: 'Pathfinder 1st edition',
    short: 'PF1e',
    engine: '3.5e',
    math: true,
    variant: 'pf1e',
    sourcebooks: false,
    rules: [
      'Rules: Pathfinder Roleplaying Game, 1st edition (not D&D 3.5, not Pathfinder 2e).',
      'Use Pathfinder 1e mechanics: consolidated skills (Perception, Stealth, Acrobatics, Disable Device…), class skills give +3 once trained, skill ranks up to character level, a feat at every odd level, favored class bonuses, traits, CMB/CMD for combat maneuvers, attacks of opportunity, Fortitude/Reflex/Will saves, and full-round vs standard vs move vs swift actions.',
      'Ask for checks with Pathfinder skill or save names, e.g. [CHECK perception DC 15], [CHECK acrobatics DC 12] or [CHECK reflex DC 14].'
    ].join(' '),
    classes: ['Alchemist', 'Barbarian', 'Bard', 'Cavalier', 'Cleric', 'Druid', 'Fighter', 'Gunslinger', 'Inquisitor', 'Magus', 'Monk', 'Oracle', 'Paladin', 'Ranger', 'Rogue', 'Sorcerer', 'Summoner', 'Witch', 'Wizard'],
    ancestries: ['Human', 'Elf', 'Dwarf', 'Halfling', 'Gnome', 'Half-Elf', 'Half-Orc', 'Aasimar', 'Tiefling', 'Catfolk', 'Tengu', 'Kitsune'],
    terms: DND_TERMS,
    blurb: 'D&D 3.5’s big cousin: CMB/CMD, traits, archetypes and a feat every odd level.'
  },
  {
    id: 'pf2e',
    name: 'Pathfinder 2nd edition',
    short: 'PF2e',
    engine: '5e',
    math: false,
    sourcebooks: false,
    rules: [
      'Rules: Pathfinder 2nd edition (not 1st edition, not D&D).',
      'Three actions and one reaction per turn; the multiple attack penalty is −5 then −10 (−4/−8 with agile weapons).',
      'Proficiency ranks add level plus 2 (trained), 4 (expert), 6 (master) or 8 (legendary); untrained adds nothing.',
      'Checks have four degrees of success: beating the DC by 10 is a critical success, missing it by 10 a critical failure, and a natural 20 or 1 moves the result one step.',
      'Characters are ancestry + heritage + background + class, with ancestry, class, skill and general feats. Use conditions with values (frightened 1, clumsy 2…), Hero Points, and focus spells.',
      'Ask for checks with PF2e skill or save names, e.g. [CHECK perception DC 18], [CHECK athletics DC 15] or [CHECK fortitude DC 20]; the sheet’s proficiency bonus holds the level-plus-rank bonus.'
    ].join(' '),
    classes: ['Alchemist', 'Barbarian', 'Bard', 'Champion', 'Cleric', 'Druid', 'Fighter', 'Investigator', 'Magus', 'Monk', 'Oracle', 'Psychic', 'Ranger', 'Rogue', 'Sorcerer', 'Summoner', 'Swashbuckler', 'Thaumaturge', 'Witch', 'Wizard', 'Kineticist', 'Gunslinger', 'Inventor'],
    ancestries: ['Human', 'Elf', 'Dwarf', 'Gnome', 'Goblin', 'Halfling', 'Leshy', 'Orc', 'Catfolk', 'Kobold', 'Ratfolk', 'Tengu', 'Kitsune', 'Fetchling'],
    terms: { race: 'Ancestry', class: 'Class', level: 'Level', spells: 'Spells' },
    blurb: 'Three-action turns, proficiency ranks and four degrees of success.'
  },
  {
    id: 'heroes',
    name: 'Superheroes',
    short: 'Heroes',
    engine: '5e',
    math: false,
    sourcebooks: false,
    rules: [
      'Rules: superhero roleplaying in the spirit of Mutants & Masterminds. The sheet level is the hero’s power level (PL, usually 8 to 12): no attack, defense, effect rank or skill bonus may go above it, and attack + effect rank (and defense + toughness) together stay within twice the PL.',
      'Heroes have an origin and an archetype, powers bought as effects with ranks (Damage, Flight, Protection, Senses, Teleport, Mind Reading…) plus extras and flaws, and their "spells" list holds those powers with their ranks.',
      'Checks are d20 + rank against a DC; damage calls for a Toughness resistance check (DC 15 + damage rank) with conditions stacking from bruised to dazed, staggered and incapacitated, instead of hit points running down. The sheet’s HP track the hero’s condition track.',
      'Hero Points (start each session with 1) let a hero reroll, recover, or pull off a power stunt. Complications (motivation, secret identity, enemies, weaknesses) earn Hero Points when they cause trouble: bring them up.',
      'Villains monologue, civilians need saving, and the world reacts to capes. Ask for checks like [CHECK perception DC 15], [CHECK fortitude DC 20] or [CHECK toughness DC 23].'
    ].join(' '),
    classes: ['Brick', 'Speedster', 'Blaster', 'Flyer', 'Mentalist', 'Gadgeteer', 'Martial Artist', 'Mystic', 'Shapeshifter', 'Elementalist', 'Paragon', 'Vigilante', 'Weapon Master', 'Battlesuit'],
    ancestries: ['Mutant', 'Alien', 'Science Accident', 'Tech-powered', 'Mystic-touched', 'Trained Human', 'Divine', 'Cosmic', 'Construct', 'Super-soldier'],
    terms: { race: 'Origin', class: 'Archetype', level: 'Power level', spells: 'Powers' },
    blurb: 'Capes and power levels: powers with ranks, hero points and complications.'
  },
  {
    id: 'scifi',
    name: 'Sci-fi (Starfinder-style)',
    short: 'Sci-fi',
    engine: '3.5e',
    math: false,
    sourcebooks: false,
    rules: [
      'Rules: d20 science fantasy in the style of Starfinder 1st edition: magic and technology side by side among the stars.',
      'Characters have both Stamina Points (lost first, back after a 10-minute rest by spending a Resolve Point) and Hit Points; the sheet’s HP are the total. Resolve Points also stabilize the dying and power class abilities.',
      'Armor Class splits into Energy AC (EAC, vs lasers, plasma, most spells) and Kinetic AC (KAC, vs bullets, blades, combat maneuvers; maneuvers target KAC + 8). Weapons use charges and ammunition; gear has item levels; computers, drones and augmentations matter.',
      'Use Starfinder skills (Computers, Engineering, Piloting, Mysticism, Life Science, Physical Science, Perception, Stealth, Athletics, Acrobatics, Diplomacy, Bluff…) with class skills +3 once trained, and Fortitude/Reflex/Will saves.',
      'Starship combat has roles (captain, pilot, engineer, gunner, science officer), each taking a turn per round. Ask for checks like [CHECK computers DC 18], [CHECK piloting DC 15] or [CHECK reflex DC 16].'
    ].join(' '),
    classes: ['Envoy', 'Mechanic', 'Mystic', 'Operative', 'Solarian', 'Soldier', 'Technomancer', 'Biohacker', 'Vanguard', 'Witchwarper', 'Evolutionist', 'Nanocyte', 'Precog'],
    ancestries: ['Human', 'Android', 'Kasatha', 'Lashunta', 'Shirren', 'Vesk', 'Ysoki', 'Skittermander', 'Pahtra', 'Dwarf', 'Elf', 'Half-Orc'],
    terms: { race: 'Species', class: 'Class', level: 'Level', spells: 'Spells & tech' },
    blurb: 'Starships, lasers and magic: Stamina and HP, EAC and KAC, Resolve Points.'
  }
]

const BY_ID = new Map(BUILTIN_RULESETS.map((r) => [r.id, r]))

export function builtinRuleset(id: string | undefined): Ruleset | undefined {
  return id ? BY_ID.get(id) : undefined
}

/** The built-in ruleset for a campaign with no ruleset set: the D&D edition it uses. */
export function rulesetForEdition(edition: Edition | undefined): Ruleset {
  return edition === '3.5e' ? BY_ID.get('dnd35')! : BY_ID.get('dnd5e')!
}

/** The rules text for the DM prompt. */
export function rulesetPrompt(r: Ruleset, sources: string[]): string {
  return r.sourcebooks ? rulesLine(r.engine, sources) : r.rules
}

/** Campaign `ruleset:` value → built-in id or custom note path. */
export function rulesetRef(value: string | undefined, rootFolder: string): string | undefined {
  if (!value?.trim()) return undefined
  if (BY_ID.has(value.trim())) return value.trim()
  const target = wikilinkTarget(value).replace(/\.md$/i, '')
  const path = target.includes('/') ? joinVaultPath(target) : joinVaultPath(rootFolder, RULESETS_FOLDER, target)
  return `${path}.md`
}

export const RULESETS_FOLDER = 'Rulesets'

const CHECK_FORMAT = 'Always ask for checks exactly as [CHECK <skill, ability or save> DC <number>], e.g. [CHECK hacking DC 15] or [CHECK dex DC 12]; the app rolls them.'

const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim()) : [])
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** A custom ruleset note (frontmatter + body) → Ruleset. */
export function rulesetFromNote(path: string, data: Record<string, unknown>, body: string): Ruleset {
  const terms = (data.terms && typeof data.terms === 'object' ? data.terms : {}) as Record<string, unknown>
  const name = text(data.name) || (path.split('/').pop() ?? 'Custom rules').replace(/\.md$/i, '')
  const rules = body
    .split('\n')
    .filter((l) => !/^#\s/.test(l.trim()))
    .join('\n')
    .trim()
  return {
    id: path,
    name,
    short: text(data.short) || name.slice(0, 14),
    engine: data.engine === '3.5e' ? '3.5e' : '5e',
    math: false,
    sourcebooks: false,
    // The app only rolls checks written its way, whatever the note says.
    rules: `${rules ? `Rules: ${name}. ${rules}` : `Rules: ${name}.`} ${CHECK_FORMAT}`,
    classes: list(data.classes),
    ancestries: list(data.ancestries),
    terms: {
      race: text(terms.race) || 'Race',
      class: text(terms.class) || 'Class',
      level: text(terms.level) || 'Level',
      spells: text(terms.spells) || 'Spells'
    },
    blurb: text(data.blurb),
    custom: true
  }
}

/** Ruleset → note frontmatter and body. */
/** The part of a ruleset's rules you write: without the "Rules: Name." opener and the app's check line. */
export function rulesBody(rules: string): string {
  return rules.replace(/^Rules:\s*[^.]*\.\s*/, '').replace(CHECK_FORMAT, '').trim()
}

export function rulesetToNote(r: Omit<Ruleset, 'id'>): { data: Record<string, unknown>; body: string } {
  const rules = rulesBody(r.rules)
  return {
    data: {
      type: 'ruleset',
      name: r.name,
      short: r.short,
      engine: r.engine,
      blurb: r.blurb || undefined,
      classes: r.classes,
      ancestries: r.ancestries,
      terms: r.terms
    },
    body: `\n# ${r.name}\n\n${rules}\n`
  }
}

export const RULESET_SYSTEM = `You design tabletop roleplaying game rules that an AI game master can run in a chat. They must be clear, complete enough to play, and fit on one page. Reply with JSON only.`

export function rulesetDesignPrompt(concept: string): string {
  return `Design a ruleset for this game: ${concept.trim()}

If the concept names an existing game, summarise how that game actually plays. Otherwise invent one that fits.
The character sheet has six abilities (str, dex, con, int, wis, cha), HP, AC, a level, a race and class (renamed to suit the game), skills, inventory and a list of spells or powers. Pick the engine closest to the game: "5e" (proficiency bonus, advantage) or "3.5e" (base attack bonus, Fortitude/Reflex/Will saves, skill ranks).

Reply with:
{"name": "short name", "short": "a 2-8 character label", "blurb": "one sentence on what it's like to play", "engine": "5e" or "3.5e",
 "terms": {"race": "what the race field is called", "class": "what class is called", "level": "what level is called", "spells": "what spells are called"},
 "classes": ["8 to 14 classes or roles"], "ancestries": ["6 to 12 races, origins or species"],
 "rules": "the rules for the game master in plain text, 250-450 words: the core roll, how checks and DCs work, combat and damage, healing and death, character growth, any special resource (stress, luck, sanity, hero points…) and what makes the game feel like itself. Every check is written exactly as [CHECK <skill, ability or save> DC <number>], e.g. [CHECK hacking DC 15]: never another bracket format"}`
}
