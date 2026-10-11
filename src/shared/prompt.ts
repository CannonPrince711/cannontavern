/**
 * Prompt assembly. Pure functions, shared by the main process (which sends
 * the prompt) and the renderer (which can preview it).
 *
 * Blocks, in the user's order, each switchable:
 *   preset · character · campaign · lorebook · sheet · combat · summary · history · extensions
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

export const DEFAULT_DM_PROMPT = `You are the Dungeon Master of a Dungeons & Dragons 5th edition adventure played with {{user}}.

Narrate in the second person and present tense ("You push open the door…"). Describe the world vividly but concisely, give NPCs distinct voices, and keep the story moving. End most replies with a situation the player can react to.

Never act, speak or decide for {{user}}'s character. Never roll dice for the player. When an action's outcome is uncertain, ask for a check in exactly this format and then stop: [CHECK <ability or skill> DC <number>], for example [CHECK dex DC 14] or [CHECK perception DC 12]. Dice results from the player appear in the conversation in square brackets; narrate the outcome they imply.

Track hit points, conditions and inventory consistently with the character sheet you are given. Keep replies to one to four paragraphs unless a scene calls for more.`

export const AUTO_STATE_INSTRUCTION = `After your narration, if the player character's state changed, add one hidden line in this exact format: <state>{"hp":-4,"add_item":"rope"}</state>. Allowed keys: hp, temp_hp, gold, xp (numbers are changes, e.g. -4), add_item, remove_item, add_condition, remove_condition (strings). Omit the line if nothing changed.`

export interface PromptPreset {
  name: string
  system_prompt: string
  dm_mode: boolean
}

export interface PromptInput {
  userName: string
  character: CharacterCard | null
  campaign: Campaign | null
  party: Party | null
  preset: PromptPreset | null
  lore: LoreEntry[]
  sheet: DndSheet | null
  combat: CombatState | null
  summary: string | null
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

export function renderCampaign(c: Campaign | null, p: Party | null): string {
  const parts: string[] = []
  if (c) {
    parts.push(`Campaign: ${c.name}`)
    if (c.setting.trim()) parts.push(`Setting: ${c.setting.trim()}`)
    if (c.tone.trim()) parts.push(`Tone: ${c.tone.trim()}`)
    if (c.house_rules.trim()) parts.push(`House rules: ${c.house_rules.trim()}`)
    if (c.body.trim()) parts.push(c.body.trim())
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

/** One stored message → one chat turn (or null when it shouldn't be sent). */
export function messageToTurn(m: Message, userName: string): ChatTurn | null {
  if (m.hidden) return null
  switch (m.role) {
    case 'player':
      return { role: 'user', content: m.name && m.name !== userName ? `${m.name}: ${m.text}` : m.text }
    case 'dm':
      return m.text.trim() ? { role: 'assistant', content: m.text } : null
    case 'roll':
      return { role: 'user', content: `[Dice: ${m.name ? `${m.name} — ` : ''}${stripMarkdown(m.text)}]` }
    case 'system':
      return { role: 'user', content: `[${stripMarkdown(m.text)}]` }
    case 'image':
      return m.image?.prompt ? { role: 'user', content: `[An illustration was shown: ${m.image.prompt}]` } : null
  }
}

function stripMarkdown(s: string): string {
  return s.replace(/\*\*|__|`/g, '').replace(/!\[\[[^\]]*\]\]/g, '').trim()
}

// ─── Assembly ───────────────────────────────────────────────────────────────

export function buildPrompt(input: PromptInput): BuiltPrompt {
  const vars = { user: input.userName, char: input.character?.name ?? input.userName }
  const est = (t: string): number => estimateTokens(t, input.tokenizer)
  const blocks: PromptBlock[] = []
  const add = (id: PromptBlockId | string, label: string, content: string): void => {
    const text = applyMacros(content, vars).trim()
    if (text) blocks.push({ id, label, role: 'system', content: text, tokens: est(text) })
  }

  for (const { id, enabled } of input.order) {
    if (!enabled) continue
    switch (id as PromptBlockId) {
      case 'preset': {
        const base = input.preset?.system_prompt.trim() || DEFAULT_DM_PROMPT
        add('preset', input.preset?.name ?? 'DM preset', input.autoState ? `${base}\n\n${AUTO_STATE_INSTRUCTION}` : base)
        break
      }
      case 'character':
        if (input.character) add('character', 'Character card', renderCharacter(input.character))
        break
      case 'campaign':
        add('campaign', 'Campaign & party', renderCampaign(input.campaign, input.party))
        break
      case 'lorebook':
        if (input.lore.length) add('lorebook', `Lorebook (${input.lore.length})`, renderLore(input.lore))
        break
      case 'sheet':
        if (input.sheet) add('sheet', 'Character sheet', renderSheet(vars.char, input.sheet))
        break
      case 'combat':
        if (input.combat?.active && input.combat.combatants.length) add('combat', 'Combat', renderCombat(input.combat))
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
    .map((m) => messageToTurn(m, input.userName))
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
