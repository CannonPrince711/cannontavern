/**
 * Domain types shared by main, preload and renderer.
 *
 * Frontmatter-backed types use the exact snake_case keys written to the vault so a
 * note can be read and written back without renaming anything.
 */
import type { PlayMode } from './play'

export type Id = string
/** Path relative to the vault root, always with forward slashes. */
export type VaultPath = string

// ─── Dice ────────────────────────────────────────────────────────────────────

export type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha'
export type RollMode = 'normal' | 'adv' | 'dis'

export interface DieResult {
  sides: number
  value: number
  /** False when dropped by kh/kl or by advantage/disadvantage. */
  kept: boolean
}

export interface RollResult {
  expression: string
  label?: string
  mode: RollMode
  dice: DieResult[]
  modifier: number
  total: number
  /** Natural 20 on a d20 roll. */
  crit: boolean
  /** Natural 1 on a d20 roll. */
  fumble: boolean
  /** Present for checks and saves. */
  dc?: number
  success?: boolean
}

// ─── Messages and sessions ───────────────────────────────────────────────────

export type MessageRole = 'player' | 'dm' | 'roll' | 'system' | 'image'

export interface MessageImage {
  /** File name inside the campaign's Images/ folder, embedded as ![[file]]. */
  file: string
  prompt: string
  backendId?: Id
  workflowId?: Id
  seed?: number
}

export interface StateChange {
  hp?: number
  temp_hp?: number
  gold?: number
  xp?: number
  add_item?: string
  remove_item?: string
  add_condition?: string
  remove_condition?: string
}

export interface Message {
  id: Id
  role: MessageRole
  /** Speaker shown in the callout title, e.g. the player or character name. */
  name?: string
  /** Text of the active swipe (Markdown). */
  text: string
  /** Every alternative reply, including the active one. Length >= 1. */
  swipes: string[]
  swipeIndex: number
  createdAt: string
  roll?: RollResult
  image?: MessageImage
  /** Changes applied from an auto-state block, kept so they can be undone. */
  stateChanges?: StateChange[]
  /** Excluded from the prompt but still shown. */
  hidden?: boolean
  backendId?: Id
  model?: string
}

export interface Combatant {
  id: Id
  name: string
  hp: number
  max_hp: number
  ac: number
  init_mod: number
  initiative: number | null
  conditions: string[]
  is_player: boolean
  /** Wikilink target of the character note when the combatant is a PC. */
  character?: string
}

export interface CombatState {
  active: boolean
  round: number
  /** Index into combatants (sorted by initiative). */
  turn: number
  combatants: Combatant[]
}

/** Frontmatter of a session note. */
export interface SessionFrontmatter {
  type: 'session'
  id: Id
  title: string
  /** Wikilink, e.g. "[[Campaign]]". */
  campaign: string
  characters: string[]
  persona?: string
  /** Who plays which side (see shared/play.ts); missing means ai-dm. */
  mode?: PlayMode
  created: string
  updated: string
  /** Rolling memory summary. */
  summary?: string
  /** Last message id included in the summary. */
  summary_upto?: Id
  /** Compressed recap written when the session ended (see shared/recap.ts). */
  recap?: string
  /** Last message id the recap covers; a newer message makes it stale. */
  recap_upto?: Id
  recap_at?: string
  combat?: CombatState
  /** Alternative swipes keyed by message id; the active one lives in the body. */
  swipes?: Record<Id, string[]>
  tags?: string[]
}

export interface Session {
  path: VaultPath
  campaignPath: VaultPath
  frontmatter: SessionFrontmatter
  messages: Message[]
  mtimeMs: number
  hash: string
}

// ─── Characters ──────────────────────────────────────────────────────────────

export interface InventoryItem {
  name: string
  qty: number
  weight?: number
  equipped?: boolean
  notes?: string
}

export interface Spell {
  name: string
  level: number
  prepared?: boolean
  notes?: string
}

export interface SpellSlot {
  max: number
  used: number
}

/** The `dnd:` block of a character note. */
export interface DndSheet {
  race: string
  class: string
  level: number
  xp: number
  hp: number
  max_hp: number
  temp_hp: number
  ac: number
  speed: number
  str: number
  dex: number
  con: number
  int: number
  wis: number
  cha: number
  proficiency_bonus: number
  /** Proficient skills, e.g. "stealth". */
  skills: string[]
  /** Proficient saving throws. */
  saves: AbilityKey[]
  inventory: InventoryItem[]
  gold: number
  spells: Spell[]
  /** Keyed by spell level "1".."9". */
  spell_slots: Record<string, SpellSlot>
  conditions: string[]
  hit_dice?: { die: number; max: number; used: number }
}

/** Character note frontmatter: a SillyTavern V2 card plus the D&D sheet. */
export interface CharacterCard {
  name: string
  description: string
  personality: string
  scenario: string
  first_mes: string
  mes_example: string
  system_prompt: string
  /** File name inside Characters/avatars/. */
  avatar?: string
  tags: string[]
  creator_notes?: string
  alternate_greetings?: string[]
  dnd?: DndSheet
}

export interface CharacterNote {
  path: VaultPath
  card: CharacterCard
  /** Markdown body (free-form notes). */
  body: string
  mtimeMs: number
  hash: string
}

// ─── Lorebooks, campaigns, presets ───────────────────────────────────────────

export interface LoreEntry {
  /** H2 heading text; unique within the book. */
  title: string
  keys: string[]
  content: string
  always_on: boolean
  priority: number
  enabled: boolean
}

export interface Lorebook {
  path: VaultPath
  name: string
  entries: LoreEntry[]
  mtimeMs: number
  hash: string
}

export interface Campaign {
  /** Folder path, e.g. "DND Tavern/Campaigns/The Sunken Lantern". */
  path: VaultPath
  name: string
  setting: string
  tone: string
  house_rules: string
  /** Wikilinks to lorebook notes. */
  lorebooks: string[]
  /** Default play mode for new sessions. */
  mode?: PlayMode
  body: string
}

export interface PartyQuest {
  title: string
  status: 'active' | 'done' | 'failed'
  notes?: string
}

export interface Party {
  gold: number
  inventory: InventoryItem[]
  quests: PartyQuest[]
  body: string
}

export interface Preset {
  path: VaultPath
  name: string
  system_prompt: string
  dm_mode: boolean
  body: string
}

// ─── Prompt building ─────────────────────────────────────────────────────────

export const PROMPT_BLOCK_IDS = [
  'preset',
  'character',
  'campaign',
  'lorebook',
  'sheet',
  'combat',
  'recaps',
  'summary',
  'history',
  'extensions'
] as const
export type PromptBlockId = (typeof PROMPT_BLOCK_IDS)[number]

export interface PromptBlock {
  /** A built-in id or an extension-defined one such as "ext:weather". */
  id: PromptBlockId | string
  label: string
  role: 'system' | 'user' | 'assistant'
  content: string
  tokens: number
}

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** What the prompt inspector shows. Secrets are already redacted. */
export interface PromptPreview {
  backendId: Id
  backendName: string
  url: string
  headers: Record<string, string>
  body: unknown
  blocks: PromptBlock[]
  totalTokens: number
  budget: number
}

// ─── Vault index ─────────────────────────────────────────────────────────────

export interface NoteRef {
  path: VaultPath
  /** File name without extension. */
  name: string
  mtimeMs: number
}

export interface CharacterSummary extends NoteRef {
  displayName: string
  /** Vault path of the avatar image (served to the renderer as vault://file/<path>). */
  avatar?: string
  tags: string[]
  race?: string
  class?: string
  level?: number
  hp?: number
  max_hp?: number
}

export interface SessionSummary extends NoteRef {
  id: Id
  title: string
  campaignPath: VaultPath
  created: string
  messageCount: number
}

export interface CampaignSummary extends NoteRef {
  displayName: string
  sessionCount: number
}

export interface LorebookSummary extends NoteRef {
  entryCount: number
}

export interface VaultIndex {
  vaultPath: string
  vaultName: string
  rootFolder: string
  isObsidianVault: boolean
  builtAt: string
  characters: CharacterSummary[]
  npcs: CharacterSummary[]
  campaigns: CampaignSummary[]
  sessions: SessionSummary[]
  lorebooks: LorebookSummary[]
  presets: NoteRef[]
}

export interface DetectedVault {
  path: string
  name: string
  open: boolean
  lastOpened?: number
}

export interface VaultValidation {
  exists: boolean
  writable: boolean
  isObsidianVault: boolean
  name: string
}

// ─── Extensions ──────────────────────────────────────────────────────────────

export type ExtensionPermission =
  | 'vault:read'
  | 'vault:write'
  | 'network'
  | 'generate:text'
  | 'generate:image'

export interface ExtensionCommandDef {
  name: string
  description: string
  usage?: string
}

export interface ExtensionSettingDef {
  key: string
  label: string
  type: 'string' | 'number' | 'boolean' | 'select'
  default: string | number | boolean
  options?: string[]
}

/** Contents of extension.json. */
export interface ExtensionManifest {
  id: string
  name: string
  version: string
  description: string
  author?: string
  permissions: ExtensionPermission[]
  /** Defaults to "main.js" when present. */
  main?: string
  /** Defaults to "ui.js" when present. */
  ui?: string
  commands?: ExtensionCommandDef[]
  settings?: ExtensionSettingDef[]
}

export interface ExtensionInfo {
  manifest: ExtensionManifest
  dir: string
  enabled: boolean
  granted: ExtensionPermission[]
  status: 'disabled' | 'loaded' | 'error'
  error?: string
  hasMain: boolean
  hasUi: boolean
  /** Current values of the extension's settings (defaults filled in). */
  values: Record<string, unknown>
  /** Shipped with DND Tavern (copied from the app on first run). */
  bundled: boolean
}

/** The only API an extension's main.js can reach. */
export interface ExtensionContext {
  extensionId: string
  session: Session | null
  character: CharacterNote | null
  campaign: Campaign | null
  sheet: DndSheet | null
  settings: Record<string, unknown>
  post(role: Exclude<MessageRole, 'image'>, text: string): Promise<void>
  generateText(prompt: string, opts?: { system?: string; maxTokens?: number }): Promise<string>
  generateImage(prompt: string, opts?: { workflowId?: Id; width?: number; height?: number }): Promise<MessageImage>
  roll(expression: string): RollResult
  readNote(path: string): Promise<string>
  writeNote(path: string, content: string): Promise<void>
  notify(message: string): void
}

export interface ExtensionHooks {
  onPromptBuild?(blocks: PromptBlock[], ctx: ExtensionContext): PromptBlock[] | Promise<PromptBlock[]>
  onBeforeSend?(payload: unknown, ctx: ExtensionContext): void | Promise<void>
  onResponse?(text: string, ctx: ExtensionContext): string | Promise<string>
  onDiceRoll?(result: RollResult, ctx: ExtensionContext): void | Promise<void>
  onSessionStart?(ctx: ExtensionContext): void | Promise<void>
}

/**
 * Renderer-only hook provided by ui.js. Generic over the element type so this
 * file doesn't depend on DOM typings (the renderer uses HTMLElement).
 */
export interface ExtensionUiHooks<El = unknown> {
  onMessageRender?(el: El, msg: Message, ctx: { extensionId: string }): void
}

/** A loaded extension's main.js exports. */
export interface Extension {
  manifest: ExtensionManifest
  hooks: ExtensionHooks
  commands: Record<string, (args: string, ctx: ExtensionContext) => void | Promise<void>>
}

// ─── Misc ────────────────────────────────────────────────────────────────────

export type ThemeId = 'dark' | 'parchment' | 'contrast'

export interface AppInfo {
  name: string
  version: string
  platform: string
  osRelease: string
  isWin11: boolean
  /** Window material actually applied. */
  material: 'mica' | 'acrylic' | 'none'
  isPackaged: boolean
  userDataPath: string
}

export interface WindowState {
  maximized: boolean
  focused: boolean
}

export interface ErrorInfo {
  code: string
  message: string
  /** Extra detail for the "copy details" button. Secrets already redacted. */
  detail?: string
}

export interface ToastEvent {
  level: 'info' | 'success' | 'warning' | 'error'
  title: string
  detail?: string
  source?: string
  /** Optional https link shown as a button (opened in the default browser). */
  link?: { label: string; url: string }
}

/** What the image model switcher can offer for a backend. */
export interface ImageModelList {
  models: string[]
  /** The model in use ('' when the server decides). */
  current: string
  /** ComfyUI workflows (empty for other backends). */
  workflows: { id: string; name: string; purpose: string; canSetModel: boolean }[]
  currentWorkflowId: string | null
  /** Why there is nothing to pick, when that's the case. */
  note?: string
}

export interface TestResult {
  ok: boolean
  ms: number
  sample?: string
  imageDataUrl?: string
  error?: ErrorInfo
}
