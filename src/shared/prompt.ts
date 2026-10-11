/**
 * Prompt assembly. Pure functions, shared by the main process (which sends
 * the prompt) and the renderer (which can preview it).
 *
 * Blocks, in the user's order, each switchable:
 *   preset · character · campaign · lorebook · sheet · combat · recaps · summary · history · extensions
 * Every non-history block goes into the system prompt in order; "history"
 * becomes the chat messages, trimmed newest-first to fit the context budget.
 */
import type {
  CharacterCard,
  ChatTurn,
  CombatState,
  DndSheet,
  LoreEntry,
  Message,
  Party,
  PromptBlock,
  PromptBlockId
} from './types'
import type { Campaign } from './types'
import { PROMPT_BLOCK_IDS } from './types'
import { SKILLS_35 } from './editions'
import { renderRecaps, type SessionRecap } from './recap'
import type { Speaker } from './play'

export const DEFAULT_DM_PROMPT = `You are the Dungeon Master of a Dungeons & Dragons adventure played with {{user}}.

Narrate in the second person and present tense ("You push open the door…"). Describe the world vividly but concisely, give NPCs distinct voices, and keep the story moving. End most replies with a situation the player can react to.

Never act, speak or decide for the player characters ({{user}}). Never roll dice for the players. When an action's outcome is uncertain, ask for a check in exactly this format and then stop: [CHECK <ability or skill> DC <number>], for example [CHECK dex DC 14] or [CHECK perception DC 12]. Dice results from the players appear in the conversation in square brackets; narrate the outcome they imply.

Track hit points, conditions and inventory consistently with the character sheet you are given. Keep replies to one to four paragraphs unless a scene calls for more.`

/** Used when the AI plays the character (You are DM / AI only). */
export const DEFAULT_PLAYER_PROMPT = `You are playing {{char}}, a player character in a Dungeons & Dragons adventure. The Dungeon Master describes the world, voices every other character and decides what happens.

Write only {{char}}'s part: what they say, do, notice and feel, in the same person and tense the DM uses for them. Stay true to the character card and sheet. Be an engaged player: ask questions, make plans, talk to people, take reasonable risks, and pursue the character's goals.

Never narrate the results of {{char}}'s actions, never describe what other characters say or do, and never invent facts about the world: that is the DM's job. Never roll dice or claim a result. When {{char}} tries something uncertain, say what they attempt and stop so the DM can call for a check. Dice results appear in square brackets.

Keep replies to one or two short paragraphs.`

export const AUTO_STATE_INSTRUCTION = `After your narration, if the player character's state changed, add one hidden line in this exact format: <state>{"hp":-4,"add_item":"rope"}</state>. Allowed keys: hp, temp_hp, gold, xp (numbers are changes, e.g. -4), add_item, remove_item, add_condition, remove_condition (strings). Omit the line if nothing changed.`

export interface PromptPreset {
  name: string
  system_prompt: string
  dm_mode: boolean
}

export interface PromptInput {
  userName: string
  character: CharacterCard | null
  /** All player characters when several share the session (multiplayer). */
  partyCards?: CharacterCard[]
  campaign: Campaign | null
  party: Party | null
  preset: PromptPreset | null
  lore: LoreEntry[]
  sheet: DndSheet | null
  combat: CombatState | null
  summary: string | null
  /** The role the AI writes this time (default "dm"). */
  speaker?: Speaker
  /** Custom player prompt for speaker "player"; empty uses DEFAULT_PLAYER_PROMPT. */
  playerPrompt?: string | null
  /** Recaps of earlier sessions in the campaign, oldest first. */
  recaps?: SessionRecap[]
  /** Where the party is on the campaign map. */
  location?: string | null
  /** Edition and allowed sourcebooks (see editions.ts). */
  rules?: string | null
  messages: Message[]
  /** Block order and on/off switches from settings. */
  order: { id: string; enabled: boolean }[]
  /** Total context in tokens (backend context size or the user's budget). */
  budget: number
  maxReplyTokens: number
  tokenizer: 'chars4' | 'chars3.5'
  autoState: boolean
  extensionBlocks?: PromptBlock[]
}

export interface BuiltPrompt {
  system: string
  messages: ChatTurn[]
  blocks: PromptBlock[]
  totalTokens: number
  /** Messages dropped from the start of the history to fit the budget. */
  droppedMessages: number
}

export function estimateTokens(text: string, tokenizer: 'chars4' | 'chars3.5' = 'chars4'): number {
  return Math.ceil(text.length / (tokenizer === 'chars3.5' ? 3.5 : 4))
}

export function applyMacros(text: string, vars: { user: string; char: string }): string {
  return text.replace(/\{\{\s*user\s*\}\}/gi, vars.user).replace(/\{\{\s*char\s*\}\}/gi, vars.char)
}

export function modifier(score: number): number {
  return Math.floor((score - 10) / 2)
}

export function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`
}

// ─── Block renderers ────────────────────────────────────────────────────────

export function renderCharacter(c: CharacterCard): string {
  const parts = [`Player character: ${c.name}`]
  if (c.description.trim()) parts.push(c.description.trim())
  if (c.personality.trim()) parts.push(`Personality: ${c.personality.trim()}`)
  if (c.scenario.trim()) parts.push(`Scenario: ${c.scenario.trim()}`)
  if (c.mes_example.trim()) parts.push(`Example dialogue:\n${c.mes_example.trim()}`)
  if (c.system_prompt.trim()) parts.push(`Instructions for this character:\n${c.system_prompt.trim()}`)
  return parts.join('\n\n')
}

/** `forPlayer` leaves out the campaign note's body, which usually holds DM-only secrets. */
export function renderCampaign(c: Campaign | null, p: Party | null, forPlayer = false): string {
  const parts: string[] = []
  if (c) {
    parts.push(`Campaign: ${c.name}`)
    if (c.setting.trim()) parts.push(`Setting: ${c.setting.trim()}`)
    if (c.tone.trim()) parts.push(`Tone: ${c.tone.trim()}`)
    if (c.house_rules.trim()) parts.push(`House rules: ${c.house_rules.trim()}`)
    if (c.body.trim() && !forPlayer) parts.push(c.body.trim())
  }
  if (p) {
    const items = p.inventory.map((i) => (i.qty > 1 ? `${i.name} ×${i.qty}` : i.name)).join(', ')
    const quests = p.quests.filter((q) => q.status === 'active').map((q) => q.title)
    const party = [`Party gold: ${p.gold}`]
    if (items) party.push(`Shared inventory: ${items}`)
    if (quests.length) party.push(`Active quests: ${quests.join('; ')}`)
    parts.push(party.join('\n'))
  }
  return parts.join('\n\n')
}

export function renderSheet(name: string, s: DndSheet): string {
  if (s.edition === '3.5e') return renderSheet35(name, s)
  const abilities = (['str', 'dex', 'con', 'int', 'wis', 'cha'] as const)
    .map((a) => `${a.toUpperCase()} ${s[a]} (${signed(modifier(s[a]))})`)
    .join(' · ')
  const lines = [
    `${name}: ${[s.race, s.class].filter(Boolean).join(' ')} ${s.level ? `level ${s.level}` : ''}`.trim(),
    `HP ${s.hp}/${s.max_hp}${s.temp_hp ? ` (+${s.temp_hp} temp)` : ''} · AC ${s.ac} · Speed ${s.speed} ft · Proficiency ${signed(s.proficiency_bonus)}`,
    abilities
  ]
  if (s.saves.length) lines.push(`Proficient saves: ${s.saves.join(', ')}`)
  if (s.skills.length) lines.push(`Proficient skills: ${s.skills.join(', ')}`)
  lines.push(`Conditions: ${s.conditions.length ? s.conditions.join(', ') : 'none'}`)
  const items = s.inventory.map((i) => `${i.name}${i.qty > 1 ? ` ×${i.qty}` : ''}${i.equipped ? ' (equipped)' : ''}`)
  lines.push(`Inventory: ${items.length ? items.join(', ') : 'nothing'} · Gold ${s.gold}`)
  const slots = Object.entries(s.spell_slots)
    .filter(([, v]) => v.max > 0)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([lvl, v]) => `L${lvl} ${v.max - v.used}/${v.max}`)
  if (slots.length) lines.push(`Spell slots left: ${slots.join(', ')}`)
  if (s.spells.length) lines.push(`Spells: ${s.spells.map((sp) => sp.name).join(', ')}`)
  return `Character sheet\n${lines.join('\n')}`
}

function renderSheet35(name: string, s: DndSheet): string {
  const mod = (a: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha'): number => modifier(s[a])
  const abilities = (['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map((a) => `${a.toUpperCase()} ${s[a]} (${signed(mod(a))})`).join(' · ')
  const bs = s.base_saves ?? { fort: 0, ref: 0, will: 0 }
  const lines = [
    `${name}: ${[s.race, s.class].filter(Boolean).join(' ')} ${s.level ? `level ${s.level}` : ''}`.trim(),
    `HP ${s.hp}/${s.max_hp}${s.temp_hp ? ` (+${s.temp_hp} temp)` : ''} · AC ${s.ac} · Speed ${s.speed} ft · Base attack ${signed(s.bab ?? 0)} · Initiative ${signed(mod('dex'))}`,
    abilities,
    `Saves: Fortitude ${signed(bs.fort + mod('con'))}, Reflex ${signed(bs.ref + mod('dex'))}, Will ${signed(bs.will + mod('wis'))}`
  ]
  const ranks = Object.entries(s.skill_ranks ?? {}).filter(([, r]) => r > 0)
  if (ranks.length) {
    const skills = ranks.map(([k, r]) => {
      const def = SKILLS_35.find((x) => x.key === k)
      const total = r + (def ? mod(def.ability) : 0)
      return `${def?.name ?? k} ${signed(total)} (${r} ranks)`
    })
    lines.push(`Skills: ${skills.join(', ')}`)
  }
  if (s.feats?.length) lines.push(`Feats: ${s.feats.join(', ')}`)
  lines.push(`Conditions: ${s.conditions.length ? s.conditions.join(', ') : 'none'}`)
  const items = s.inventory.map((i) => `${i.name}${i.qty > 1 ? ` ×${i.qty}` : ''}${i.equipped ? ' (equipped)' : ''}`)
  lines.push(`Inventory: ${items.length ? items.join(', ') : 'nothing'} · Gold ${s.gold}`)
  const slots = Object.entries(s.spell_slots)
    .filter(([, v]) => v.max > 0)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([lvl, v]) => `L${lvl} ${v.max - v.used}/${v.max}`)
  if (slots.length) lines.push(`Spells per day left: ${slots.join(', ')}`)
  if (s.spells.length) lines.push(`Spells: ${s.spells.map((sp) => sp.name).join(', ')}`)
  return `Character sheet (D&D 3.5)\n${lines.join('\n')}`
}

export function renderCombat(c: CombatState): string {
  const order = c.combatants
    .map((x, i) => {
      const cur = i === c.turn ? ' ← acting now' : ''
      const cond = x.conditions.length ? `, ${x.conditions.join('/')}` : ''
      return `${x.name} (initiative ${x.initiative ?? '?'}, HP ${x.hp}/${x.max_hp}, AC ${x.ac}${cond})${cur}`
    })
    .join('\n')
  return `Combat is active. Round ${c.round}. Turn order:\n${order}`
}

export function renderLore(entries: LoreEntry[]): string {
  return `World information:\n${entries.map((e) => `### ${e.title}\n${e.content.trim()}`).join('\n\n')}`
}

// ─── Lorebook triggering ────────────────────────────────────────────────────

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Picks lorebook entries for the prompt: always-on entries plus entries whose
 * keys appear (whole word, case-insensitive) in the last `scanDepth`
 * messages, highest priority first, within `tokenBudget`.
 */
export function selectLore(
  entries: LoreEntry[],
  messages: Message[],
  scanDepth: number,
  tokenBudget: number,
  tokenizer: 'chars4' | 'chars3.5' = 'chars4'
): LoreEntry[] {
  const recent = messages
    .filter((m) => !m.hidden)
    .slice(-scanDepth)
    .map((m) => m.text)
    .join('\n')
  const triggered = entries.filter((e) => {
    if (!e.enabled) return false
    if (e.always_on) return true
    return e.keys.some((k) => {
      const key = k.trim()
      return key && new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(key)}($|[^\\p{L}\\p{N}])`, 'iu').test(recent)
    })
  })
  const sorted = [...triggered].sort((a, b) => Number(b.always_on) - Number(a.always_on) || b.priority - a.priority)
  const out: LoreEntry[] = []
  let used = 0
  for (const e of sorted) {
    const cost = estimateTokens(`### ${e.title}\n${e.content}`, tokenizer)
    if (tokenBudget > 0 && used + cost > tokenBudget) continue
    out.push(e)
    used += cost
  }
  return out
}

// ─── History ────────────────────────────────────────────────────────────────

/**
 * One stored message → one chat turn (or null when it shouldn't be sent).
 * Messages in the role the AI is writing (`speaker`) become assistant turns.
 */
export function messageToTurn(m: Message, userName: string, speaker: Speaker = 'dm'): ChatTurn | null {
  if (m.hidden) return null
  switch (m.role) {
    case 'player':
      if (speaker === 'player') return m.text.trim() ? { role: 'assistant', content: m.text } : null
      return { role: 'user', content: m.name && m.name !== userName ? `${m.name}: ${m.text}` : m.text }
    case 'dm':
      if (speaker === 'player') return { role: 'user', content: m.text }
      return m.text.trim() ? { role: 'assistant', content: m.text } : null
    case 'roll':
      return { role: 'user', content: `[Dice: ${m.name ? `${m.name} — ` : ''}${stripMarkdown(m.text)}]` }
    case 'system':
      return { role: 'user', content: `[${m.name ? `${m.name}: ` : ''}${stripMarkdown(m.text)}]` }
    case 'image':
      return m.image?.prompt ? { role: 'user', content: `[An illustration was shown: ${m.image.prompt}]` } : null
  }
}

function stripMarkdown(s: string): string {
  return s.replace(/\*\*|__|`/g, '').replace(/!\[\[[^\]]*\]\]/g, '').trim()
}

// ─── Assembly ───────────────────────────────────────────────────────────────

/**
 * Saved block orders predate newer blocks; insert any missing built-in block
 * just before the next built-in block that follows it by default.
 */
export function normalizeBlockOrder(order: { id: string; enabled: boolean }[]): { id: string; enabled: boolean }[] {
  const out = [...order]
  PROMPT_BLOCK_IDS.forEach((id, i) => {
    if (out.some((b) => b.id === id)) return
    const after = PROMPT_BLOCK_IDS.slice(i + 1).find((next) => out.some((b) => b.id === next))
    const at = after ? out.findIndex((b) => b.id === after) : out.length
    out.splice(at, 0, { id, enabled: true })
  })
  return out
}

export function buildPrompt(input: PromptInput): BuiltPrompt {
  const vars = { user: input.userName, char: input.character?.name ?? input.userName }
  const est = (t: string): number => estimateTokens(t, input.tokenizer)
  const blocks: PromptBlock[] = []
  const speaker = input.speaker ?? 'dm'
  const add = (id: PromptBlockId | string, label: string, content: string): void => {
    const text = applyMacros(content, vars).trim()
    if (text) blocks.push({ id, label, role: 'system', content: text, tokens: est(text) })
  }

  for (const { id, enabled } of input.order) {
    if (!enabled) continue
    switch (id as PromptBlockId) {
      case 'preset': {
        if (speaker === 'player') {
          add('preset', 'Player prompt', input.playerPrompt?.trim() || DEFAULT_PLAYER_PROMPT)
          break
        }
        const base = input.preset?.system_prompt.trim() || DEFAULT_DM_PROMPT
        add('preset', input.preset?.name ?? 'DM preset', input.autoState ? `${base}\n\n${AUTO_STATE_INSTRUCTION}` : base)
        break
      }
      case 'character':
        if (input.partyCards && input.partyCards.length > 1) {
          add('character', `Party (${input.partyCards.length})`, `The player characters:\n\n${input.partyCards.map((c) => applyMacros(renderCharacter(c), { user: vars.user, char: c.name })).join('\n\n---\n\n')}`)
        } else if (input.character) add('character', 'Character card', renderCharacter(input.character))
        break
      case 'campaign':
        add(
          'campaign',
          'Campaign & party',
          [input.rules ?? '', renderCampaign(input.campaign, input.party, speaker === 'player'), input.location ? `The party is currently at: ${input.location}` : ''].filter(Boolean).join('\n\n')
        )
        break
      case 'lorebook':
        if (input.lore.length) add('lorebook', `Lorebook (${input.lore.length})`, renderLore(input.lore))
        break
      case 'sheet':
        if (input.partyCards && input.partyCards.length > 1) {
          const sheets = input.partyCards.filter((c) => c.dnd).map((c) => renderSheet(c.name, c.dnd!))
          if (sheets.length) add('sheet', `Character sheets (${sheets.length})`, sheets.join('\n\n'))
        } else if (input.sheet) add('sheet', 'Character sheet', renderSheet(vars.char, input.sheet))
        break
      case 'combat':
        if (input.combat?.active && input.combat.combatants.length) add('combat', 'Combat', renderCombat(input.combat))
        break
      case 'recaps':
        if (input.recaps?.length) add('recaps', `Previous sessions (${input.recaps.length})`, renderRecaps(input.recaps))
        break
      case 'summary':
        if (input.summary?.trim()) add('summary', 'Story so far', `Story so far:\n${input.summary.trim()}`)
        break
      case 'extensions':
        for (const b of input.extensionBlocks ?? []) add(b.id, b.label, b.content)
        break
      case 'history':
        blocks.push({ id: 'history', label: 'Chat history', role: 'user', content: '', tokens: 0 })
        break
    }
  }

  const system = blocks
    .filter((b) => b.id !== 'history')
    .map((b) => b.content)
    .join('\n\n')
  const systemTokens = est(system)
  const historyEnabled = blocks.some((b) => b.id === 'history')

  const turns = input.messages
    .map((m) => messageToTurn(m, input.userName, speaker))
    .filter((t): t is ChatTurn => t !== null)
    .map((t) => ({ ...t, content: applyMacros(t.content, vars) }))

  const available = Math.max(0, input.budget - systemTokens - input.maxReplyTokens)
  const kept: ChatTurn[] = []
  let used = 0
  const source = historyEnabled ? turns : turns.slice(-1)
  for (let i = source.length - 1; i >= 0; i--) {
    const t = source[i]!
    const cost = est(t.content) + 4
    // Always keep the newest turn, even if it alone exceeds the budget.
    if (kept.length > 0 && used + cost > available) break
    kept.unshift(t)
    used += cost
  }
  const history = blocks.find((b) => b.id === 'history')
  if (history) {
    history.tokens = used
    history.content = `${kept.length} of ${turns.length} messages`
  }

  return {
    system,
    messages: kept,
    blocks,
    totalTokens: systemTokens + used,
    droppedMessages: source.length - kept.length
  }
}
