/**
 * Per-world settings: a campaign can override the global text model, DM
 * prompt, image generation options and image triggers. The overrides live in
 * the `world:` key of Campaign.md, so they can be edited in Obsidian too;
 * anything a world leaves out falls back to Settings.
 */
import { z } from 'zod'
import { DEFAULT_DM_PROMPT, type PromptPreset } from './prompt'
import { IMAGE_PURPOSES, type ImagePurpose, type Settings } from './settings'

const ImageOverrideSchema = z.object({
  /** Image backend id. */
  backend: z.string().max(200),
  /** Checkpoint or model name. */
  model: z.string().max(500),
  /** ComfyUI workflow id. */
  workflow: z.string().max(200),
  width: z.number().int().min(0).max(4096),
  height: z.number().int().min(0).max(4096),
  steps: z.number().int().min(0).max(200),
  style: z.string().max(500),
  negative: z.string().max(1000)
})
export type ImageOverride = Partial<z.infer<typeof ImageOverrideSchema>>

const WorldFieldSchemas = {
  /** Text backend id for the DM (the chat role). */
  text_backend: z.string().max(200),
  text_model: z.string().max(300),
  /** Text backend id for the characters when the AI writes as them; empty: the DM's. */
  character_backend: z.string().max(200),
  temperature: z.number().min(0).max(5),
  /** Model for summaries and recaps, put into the summaries backend only (its fallbacks keep theirs). */
  summary_model: z.string().max(300),
  /** Vault path of a preset note; '' means the built-in DM prompt. */
  preset: z.string().max(500),
  /** Read-aloud voice for the DM and narration in this world; empty: Settings → Speech. */
  narrator_voice: z.string().max(100),
  /** Added to the DM prompt in this world only. */
  dm_instructions: z.string().max(10_000),
  /** System prompt when the AI plays the character in this world. */
  player_prompt: z.string().max(10_000),
  /** false: this world ignores the shared lorebooks in Resources/Lore. */
  shared_resources: z.boolean(),
  auto_portraits: z.boolean(),
  /** Illustrate a scene every N DM replies; 0 turns it off. */
  scene_every: z.number().int().min(0).max(1000),
  scene_on_location_change: z.boolean()
} as const

export type WorldOverrides = { -readonly [K in keyof typeof WorldFieldSchemas]?: z.infer<(typeof WorldFieldSchemas)[K]> } & {
  images?: Partial<Record<ImagePurpose, ImageOverride>>
}

/** What "Generate resources for this world" can write. */
export const WORLD_RESOURCE_KINDS = ['items', 'magic', 'creatures', 'services', 'townsfolk'] as const
export type WorldResourceKind = (typeof WORLD_RESOURCE_KINDS)[number]

/** The overridable groups, for "overridden in …" hints. */
export const WORLD_GROUPS = ['text', 'prompt', 'images', 'triggers'] as const
export type WorldGroup = (typeof WORLD_GROUPS)[number]

/** Strict schema for IPC (a whole overrides object from the renderer). */
export const WorldOverridesSchema: z.ZodType<WorldOverrides> = z
  .object({
    ...Object.fromEntries(Object.entries(WorldFieldSchemas).map(([k, v]) => [k, v.optional()])),
    images: z.partialRecord(z.enum(IMAGE_PURPOSES), ImageOverrideSchema.partial()).optional()
  })
  .strict() as unknown as z.ZodType<WorldOverrides>

function pickValid<T extends Record<string, z.ZodType>>(raw: unknown, schemas: T): { [K in keyof T]?: z.infer<T[K]> } {
  const out: Record<string, unknown> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out as { [K in keyof T]?: z.infer<T[K]> }
  for (const [key, schema] of Object.entries(schemas)) {
    const r = schema.safeParse((raw as Record<string, unknown>)[key])
    if (r.success && r.data !== undefined && r.data !== null) out[key] = r.data
  }
  return out as { [K in keyof T]?: z.infer<T[K]> }
}

/**
 * Reads the `world:` frontmatter leniently: a value that is the wrong type is
 * dropped on its own (it falls back to the global setting) instead of losing
 * the whole block.
 */
export function parseWorld(raw: unknown): WorldOverrides {
  const world: WorldOverrides = pickValid(raw, WorldFieldSchemas)
  const imagesRaw = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).images : undefined
  const images: Partial<Record<ImagePurpose, ImageOverride>> = {}
  for (const p of IMAGE_PURPOSES) {
    const o = pickValid(imagesRaw && typeof imagesRaw === 'object' ? (imagesRaw as Record<string, unknown>)[p] : undefined, ImageOverrideSchema.shape)
    if (Object.keys(o).length) images[p] = o
  }
  if (Object.keys(images).length) world.images = images
  return world
}

/** Older per-campaign model keys in Campaign.md, read into the world overrides. */
export const LEGACY_MODEL_KEYS = ['image_models', 'text_models'] as const

function stringMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string' && !!e[1].trim()).map(([k, v]) => [k, v.trim()]))
}

/**
 * A campaign's overrides from its whole frontmatter: the `world:` block, plus
 * the older `image_models: {portrait: …}` and `text_models: {chat, summary}`
 * keys, which count wherever `world:` doesn't set the same thing.
 */
export function worldFromFrontmatter(data: Record<string, unknown>): WorldOverrides | undefined {
  const world = parseWorld(data.world)
  const images = stringMap(data.image_models)
  for (const p of IMAGE_PURPOSES) {
    if (!images[p] || world.images?.[p]?.model !== undefined) continue
    world.images = { ...world.images, [p]: { ...world.images?.[p], model: images[p] } }
  }
  const text = stringMap(data.text_models)
  if (text.chat && world.text_model === undefined) world.text_model = text.chat
  if (text.summary && world.summary_model === undefined) world.summary_model = text.summary
  return compactWorld(world)
}

/** Drops empty image entries so an untouched world writes nothing. */
export function compactWorld(w: WorldOverrides): WorldOverrides | undefined {
  const out: WorldOverrides = { ...w }
  if (out.images) {
    const images = Object.fromEntries(Object.entries(out.images).filter(([, o]) => o && Object.values(o).some((v) => v !== undefined)))
    if (Object.keys(images).length) out.images = images
    else delete out.images
  }
  for (const k of Object.keys(out) as (keyof WorldOverrides)[]) if (out[k] === undefined) delete out[k]
  return Object.keys(out).length ? out : undefined
}

/** Which groups a world overrides. */
export function worldGroups(w: WorldOverrides | undefined): WorldGroup[] {
  if (!w) return []
  const has = (...keys: (keyof WorldOverrides)[]): boolean => keys.some((k) => w[k] !== undefined)
  const groups: WorldGroup[] = []
  if (has('text_backend', 'text_model', 'character_backend', 'temperature', 'summary_model')) groups.push('text')
  if (has('preset', 'dm_instructions', 'player_prompt', 'shared_resources', 'narrator_voice')) groups.push('prompt')
  if (w.images && Object.values(w.images).some((o) => o && Object.keys(o).length)) groups.push('images')
  if (has('auto_portraits', 'scene_every', 'scene_on_location_change')) groups.push('triggers')
  return groups
}

/** The text backend the DM uses: the chat role, the default, then the first. */
export function chatBackendId(s: { roles: { chat: string | null }; defaultTextBackendId: string | null; textBackends: { id: string }[] }): string | null {
  const id = s.roles.chat ?? s.defaultTextBackendId
  return (s.textBackends.find((b) => b.id === id) ?? s.textBackends[0])?.id ?? null
}

/** Global settings with a world's overrides applied. Unknown backend ids are ignored. */
export function applyWorld<S extends Settings>(s: S, w: WorldOverrides | undefined | null): S {
  if (!w || !Object.keys(w).length) return s
  const next = structuredClone(s)

  if (w.text_backend && next.textBackends.some((b) => b.id === w.text_backend)) next.roles.chat = w.text_backend
  if (w.character_backend && next.textBackends.some((b) => b.id === w.character_backend)) next.roles.character = w.character_backend
  if (w.text_model !== undefined || w.temperature !== undefined) {
    const id = chatBackendId(next)
    next.textBackends = next.textBackends.map((b) =>
      b.id !== id
        ? b
        : {
            ...b,
            ...(w.text_model?.trim() ? { model: w.text_model.trim() } : {}),
            generation: { ...b.generation, ...(w.temperature !== undefined ? { temperature: w.temperature } : {}) }
          }
    ) as S['textBackends']
  }

  if (w.preset !== undefined) next.general.defaultPreset = w.preset.trim() || null
  if (w.player_prompt !== undefined) next.prompt.playerPrompt = w.player_prompt

  for (const purpose of IMAGE_PURPOSES) {
    const o = w.images?.[purpose]
    if (!o) continue
    const p = next.imageProfiles[purpose]
    if (o.backend !== undefined && next.imageBackends.some((b) => b.id === o.backend)) p.backendId = o.backend
    if (o.model !== undefined) p.model = o.model
    if (o.workflow !== undefined) p.workflowId = o.workflow || null
    if (o.width !== undefined) p.width = o.width
    if (o.height !== undefined) p.height = o.height
    if (o.steps !== undefined) p.steps = o.steps
    if (o.style !== undefined) p.style = o.style
    if (o.negative !== undefined) p.negative = o.negative
  }

  if (w.auto_portraits !== undefined) next.imageTriggers.autoPortraits = w.auto_portraits
  if (w.scene_every !== undefined) next.imageTriggers.everyNDmTurns = w.scene_every
  if (w.scene_on_location_change !== undefined) next.imageTriggers.onLocationChange = w.scene_on_location_change
  return next
}

/** The DM preset with a world's extra instructions added (on top of the built-in prompt when there is no preset). */
export function withWorldInstructions<P extends PromptPreset>(preset: P | null, instructions: string | undefined): P | PromptPreset | null {
  const extra = instructions?.trim()
  if (!extra) return preset
  const base = preset?.system_prompt.trim() || DEFAULT_DM_PROMPT
  return { ...(preset ?? { name: 'DM preset', dm_mode: true }), system_prompt: `${base}\n\nInstructions for this world:\n${extra}` }
}

// ─── Picking generators for a world ─────────────────────────────────────────

const SUGGEST_PURPOSES = ['scene', 'portrait', 'map', 'battlemap'] as const satisfies readonly ImagePurpose[]

/** Model families the built-in ComfyUI graph (checkpoint → KSampler, CFG ~6) can't run well; they need a workflow made for them. */
const NEEDS_WORKFLOW = /flux|sd3|z[_-]?image|hidream|qwen|wan2|chroma|lumina|cosmos/i

export interface ImageInventory {
  id: string
  name: string
  type: string
  models: string[]
  workflows: { id: string; name: string; purpose: string }[]
}

export interface TextInventory {
  id: string
  name: string
  models: string[]
  current: string
}

const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)
const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/** Keeps only choices that name installed backends, models and workflows. */
export function validateSuggestion(raw: unknown, images: ImageInventory[], texts: TextInventory[]): WorldOverrides {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const world: WorldOverrides = {}

  const t = (r.text && typeof r.text === 'object' ? r.text : {}) as Record<string, unknown>
  const tb = texts.find((b) => b.id === t.backend || (typeof t.backend === 'string' && sameName(b.name, t.backend)))
  if (tb) {
    world.text_backend = tb.id
    const model = str(t.model, 300)
    const known = model ? tb.models.find((m) => sameName(m, model)) : undefined
    if (known && known !== tb.current) world.text_model = known
  }

  const imgs = (r.images && typeof r.images === 'object' ? r.images : {}) as Record<string, unknown>
  const out: Partial<Record<ImagePurpose, ImageOverride>> = {}
  for (const purpose of SUGGEST_PURPOSES) {
    const o = (imgs[purpose] && typeof imgs[purpose] === 'object' ? imgs[purpose] : null) as Record<string, unknown> | null
    if (!o) continue
    const b = images.find((x) => x.id === o.backend || (typeof o.backend === 'string' && sameName(x.name, o.backend)))
    if (!b) continue
    const pick: ImageOverride = { backend: b.id }
    const wfName = str(o.workflow, 200)
    const wf = wfName ? b.workflows.find((w) => w.id === wfName || sameName(w.name, wfName)) : undefined
    if (wf) pick.workflow = wf.id
    const modelName = str(o.model, 500)
    const model = modelName ? b.models.find((m) => sameName(m, modelName)) : undefined
    // A FLUX-style model on the built-in graph would come out broken; leave the model alone instead.
    if (model && (wf || !(b.type === 'comfyui' && NEEDS_WORKFLOW.test(model)))) pick.model = model
    const style = str(o.style, 500)
    if (style) pick.style = style
    const negative = str(o.negative, 1000)
    if (negative) pick.negative = negative
    out[purpose] = pick
  }
  if (Object.keys(out).length) world.images = out
  return world
}

