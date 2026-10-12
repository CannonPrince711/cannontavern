/**
 * Coercion from loosely-typed frontmatter (which people edit by hand in
 * Obsidian) into the app's types, plus defaults for new notes. Unknown keys
 * are ignored here and preserved by the writer.
 */
import { isPlayMode } from './play'
import { isEdition, type Edition } from './editions'
import { worldFromFrontmatter } from './world'
import { parseBonds } from './bonds'
import type {
  AbilityKey,
  Campaign,
  CharacterCard,
  DndSheet,
  InventoryItem,
  LoreEntry,
  Party,
  PartyQuest,
  Spell,
  SpellSlot
} from './types'

const ABILITIES: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha']

const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : d)
const num = (v: unknown, d = 0): number => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : d
}
const bool = (v: unknown, d = false): boolean => (typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : d)
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : typeof v === 'string' && v.trim() ? v.split(',').map((s) => s.trim()).filter(Boolean) : []
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

export function proficiencyForLevel(level: number): number {
  return 2 + Math.floor((Math.max(1, level) - 1) / 4)
}

export function defaultSheet(edition: Edition = '5e'): DndSheet {
  const base = defaultSheet5e()
  if (edition !== '3.5e') return base
  return { ...base, edition: '3.5e', bab: 0, base_saves: { fort: 0, ref: 0, will: 0 }, skill_ranks: {}, feats: [] }
}

function defaultSheet5e(): DndSheet {
  return {
    race: '',
    class: '',
    level: 1,
    xp: 0,
    hp: 10,
    max_hp: 10,
    temp_hp: 0,
    ac: 10,
    speed: 30,
    str: 10,
    dex: 10,
    con: 10,
    int: 10,
    wis: 10,
    cha: 10,
    proficiency_bonus: 2,
    skills: [],
    saves: [],
    inventory: [],
    gold: 0,
    spells: [],
    spell_slots: {},
    conditions: []
  }
}

export function defaultCard(name: string): CharacterCard {
  return {
    name,
    description: '',
    personality: '',
    scenario: '',
    first_mes: '',
    mes_example: '',
    system_prompt: '',
    tags: []
  }
}

function item(v: unknown): InventoryItem | null {
  if (typeof v === 'string') {
    // "Rope (50 ft) x2" / "Rope ×2" / "2x Rope" → name + qty
    const m = /^(.*?)\s*[x×]\s*(\d+)$/i.exec(v.trim()) ?? /^(\d+)\s*[x×]\s*(.*)$/i.exec(v.trim())
    if (m) {
      const [a, b] = /^\d+$/.test(m[1]!) ? [m[2]!, m[1]!] : [m[1]!, m[2]!]
      return { name: a.trim(), qty: Number(b) }
    }
    return v.trim() ? { name: v.trim(), qty: 1 } : null
  }
  const o = obj(v)
  const name = str(o.name)
  if (!name) return null
  return {
    name,
    qty: Math.max(0, num(o.qty ?? o.quantity, 1)),
    ...(o.weight !== undefined ? { weight: num(o.weight) } : {}),
    ...(o.equipped !== undefined ? { equipped: bool(o.equipped) } : {}),
    ...(o.notes ? { notes: str(o.notes) } : {})
  }
}

function spell(v: unknown): Spell | null {
  if (typeof v === 'string') return v.trim() ? { name: v.trim(), level: 0 } : null
  const o = obj(v)
  const name = str(o.name)
  if (!name) return null
  return {
    name,
    level: num(o.level),
    ...(o.prepared !== undefined ? { prepared: bool(o.prepared) } : {}),
    ...(o.notes ? { notes: str(o.notes) } : {})
  }
}

export function normalizeSheet(raw: unknown): DndSheet {
  const o = obj(raw)
  const d = defaultSheet()
  const slots: Record<string, SpellSlot> = {}
  for (const [lvl, v] of Object.entries(obj(o.spell_slots))) {
    const s = obj(v)
    const max = typeof v === 'number' ? v : num(s.max)
    slots[lvl] = { max, used: Math.min(max, num(s.used)) }
  }
  const level = num(o.level, d.level)
  const sheet: DndSheet = {
    race: str(o.race),
    class: str(o.class),
    level,
    xp: num(o.xp),
    hp: num(o.hp, d.hp),
    max_hp: num(o.max_hp, num(o.hp, d.max_hp)),
    temp_hp: num(o.temp_hp),
    ac: num(o.ac, d.ac),
    speed: num(o.speed, d.speed),
    str: num(o.str, 10),
    dex: num(o.dex, 10),
    con: num(o.con, 10),
    int: num(o.int, 10),
    wis: num(o.wis, 10),
    cha: num(o.cha, 10),
    proficiency_bonus: num(o.proficiency_bonus, proficiencyForLevel(level)),
    skills: strList(o.skills).map((s) => s.toLowerCase()),
    saves: strList(o.saves)
      .map((s) => s.toLowerCase().slice(0, 3))
      .filter((s): s is AbilityKey => ABILITIES.includes(s as AbilityKey)),
    inventory: (Array.isArray(o.inventory) ? o.inventory : []).map(item).filter((x): x is InventoryItem => !!x),
    gold: num(o.gold),
    spells: (Array.isArray(o.spells) ? o.spells : []).map(spell).filter((x): x is Spell => !!x),
    spell_slots: slots,
    conditions: strList(o.conditions)
  }
  const hd = obj(o.hit_dice)
  if (Object.keys(hd).length) sheet.hit_dice = { die: num(hd.die, 8), max: num(hd.max, level), used: num(hd.used) }
  if (isEdition(o.edition) && o.edition !== '5e') sheet.edition = o.edition
  const feats = strList(o.feats)
  if (feats.length) sheet.feats = feats
  if (sheet.edition === '3.5e') {
    const bs = obj(o.base_saves)
    sheet.bab = num(o.bab)
    sheet.base_saves = { fort: num(bs.fort), ref: num(bs.ref), will: num(bs.will) }
    sheet.skill_ranks = Object.fromEntries(
      Object.entries(obj(o.skill_ranks))
        .map(([k, v]) => [k.toLowerCase(), num(v)] as const)
        .filter(([, v]) => v > 0)
    )
  }
  return sheet
}

export function normalizeCard(data: Record<string, unknown>, fallbackName: string): CharacterCard {
  const card: CharacterCard = {
    name: str(data.name) || fallbackName,
    description: str(data.description),
    personality: str(data.personality),
    scenario: str(data.scenario),
    first_mes: str(data.first_mes),
    mes_example: str(data.mes_example),
    system_prompt: str(data.system_prompt),
    tags: strList(data.tags),
    ...(data.avatar ? { avatar: str(data.avatar) } : {}),
    ...(strList(data.aliases).length ? { aliases: strList(data.aliases) } : {}),
    ...(data.creator_notes ? { creator_notes: str(data.creator_notes) } : {}),
    ...(Array.isArray(data.alternate_greetings) ? { alternate_greetings: strList(data.alternate_greetings) } : {}),
    ...(str(data.voice).trim() ? { voice: str(data.voice).trim() } : {}),
    ...(strList(data.campaigns).length ? { campaigns: strList(data.campaigns) } : {}),
    ...(str(obj(data.crossover).from) ? { crossover: { from: str(obj(data.crossover).from), ...(str(obj(data.crossover).rules) ? { rules: str(obj(data.crossover).rules) } : {}) } } : {}),
    ...(Array.isArray(data.portraits)
      ? {
          portraits: data.portraits
            .map((p) => obj(p))
            .filter((p) => str(p.file))
            .map((p) => ({ file: str(p.file), ...(str(p.event) ? { event: str(p.event) } : {}), ...(str(p.date) ? { date: str(p.date) } : {}) }))
        }
      : {})
  }
  if (data.dnd && typeof data.dnd === 'object') card.dnd = normalizeSheet(data.dnd)
  return card
}

/** CharacterCard → frontmatter object (only keys the app owns). */
export function cardToFrontmatter(card: CharacterCard): Record<string, unknown> {
  return {
    name: card.name,
    description: card.description,
    personality: card.personality,
    scenario: card.scenario,
    first_mes: card.first_mes,
    mes_example: card.mes_example,
    system_prompt: card.system_prompt,
    avatar: card.avatar || undefined,
    tags: card.tags,
    aliases: card.aliases?.length ? card.aliases : undefined,
    creator_notes: card.creator_notes || undefined,
    alternate_greetings: card.alternate_greetings?.length ? card.alternate_greetings : undefined,
    voice: card.voice?.trim() || undefined,
    campaigns: card.campaigns?.length ? card.campaigns : undefined,
    crossover: card.crossover ?? undefined,
    portraits: card.portraits?.length ? card.portraits : undefined,
    dnd: card.dnd
  }
}

export function normalizeCampaign(path: string, name: string, data: Record<string, unknown>, body: string): Campaign {
  return {
    path,
    name: str(data.name) || name,
    setting: str(data.setting),
    tone: str(data.tone),
    house_rules: str(data.house_rules),
    lorebooks: strList(data.lorebooks),
    mode: isPlayMode(data.mode) ? data.mode : undefined,
    edition: isEdition(data.edition) ? data.edition : undefined,
    sources: strList(data.sources),
    ...(str(data.ruleset).trim() ? { ruleset: str(data.ruleset).trim() } : {}),
    ...(str(data.universe).trim() ? { universe: str(data.universe).trim() } : {}),
    world: worldFromFrontmatter(data),
    body
  }
}

export function normalizeParty(data: Record<string, unknown>, body: string): Party {
  return {
    gold: num(data.gold),
    inventory: (Array.isArray(data.inventory) ? data.inventory : []).map(item).filter((x): x is InventoryItem => !!x),
    quests: (Array.isArray(data.quests) ? data.quests : [])
      .map((q): PartyQuest | null => {
        if (typeof q === 'string') return q.trim() ? { title: q.trim(), status: 'active' } : null
        const o = obj(q)
        const title = str(o.title)
        if (!title) return null
        const status = str(o.status)
        return { title, status: status === 'done' || status === 'failed' ? status : 'active', ...(o.notes ? { notes: str(o.notes) } : {}) }
      })
      .filter((x): x is PartyQuest => !!x),
    bonds: parseBonds(data.bonds),
    body
  }
}

// ─── Lorebooks: one H2 section per entry, inline fields `key:: value` ───────

const FIELD_RE = /^([a-z_]+)::\s*(.*)$/i

export function parseLorebookBody(body: string): { intro: string; entries: LoreEntry[] } {
  const sections = body.split(/^## /m)
  const intro = sections.shift() ?? ''
  const entries = sections.map((section): LoreEntry => {
    const nl = section.indexOf('\n')
    const title = (nl === -1 ? section : section.slice(0, nl)).trim()
    const fields: Record<string, string> = {}
    const content: string[] = []
    for (const line of (nl === -1 ? '' : section.slice(nl + 1)).split('\n')) {
      const m = FIELD_RE.exec(line.trim())
      if (m && content.every((l) => !l.trim())) fields[m[1]!.toLowerCase()] = m[2]!.trim()
      else content.push(line)
    }
    return {
      title,
      keys: strList(fields.keys),
      content: content.join('\n').trim(),
      always_on: bool(fields.always ?? fields.always_on, false),
      priority: num(fields.priority, 0),
      enabled: bool(fields.enabled, true)
    }
  })
  return { intro, entries }
}

export function serializeLorebookBody(intro: string, entries: LoreEntry[]): string {
  const head = intro.trim() ? `${intro.trim()}\n\n` : ''
  return (
    head +
    entries
      .map((e) => {
        const fields = [`keys:: ${e.keys.join(', ')}`]
        if (e.priority) fields.push(`priority:: ${e.priority}`)
        if (e.always_on) fields.push('always:: true')
        if (!e.enabled) fields.push('enabled:: false')
        return `## ${e.title}\n${fields.join('\n')}\n\n${e.content.trim()}\n`
      })
      .join('\n')
  )
}
