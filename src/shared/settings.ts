/**
 * Settings schemas (zod). Settings live in %APPDATA%\DND Tavern\settings.json,
 * never in the vault.
 *
 * Secrets (API keys, secret headers) have three shapes:
 *  - SecretStored: what is written to disk (safeStorage-encrypted or an env reference)
 *  - SecretView:   what the renderer sees (never the value)
 *  - SecretInput:  what the renderer sends when saving a backend
 * Backend schemas are built by a factory so each shape gets its own schema and type.
 */
import { z } from 'zod'
import { PROMPT_BLOCK_IDS } from './types'

// ─── Secrets ─────────────────────────────────────────────────────────────────

export const SecretStoredSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  /** Not secret; used for non-sensitive header values. */
  z.object({ kind: z.literal('plain'), value: z.string() }),
  /** Base64 of safeStorage.encryptString output (DPAPI on Windows). */
  z.object({ kind: z.literal('encrypted'), data: z.string() }),
  /** Read from process.env at request time, written as "env:NAME" in the UI. */
  z.object({ kind: z.literal('env'), name: z.string() })
])

export const SecretViewSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('plain'), value: z.string() }),
  z.object({ kind: z.literal('stored') }),
  z.object({ kind: z.literal('env'), name: z.string() })
])

export const SecretInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('plain'), value: z.string() }),
  /** Encrypt and store this value. */
  z.object({ kind: z.literal('set'), value: z.string() }),
  /** Leave the stored value unchanged. */
  z.object({ kind: z.literal('keep') }),
  z.object({ kind: z.literal('env'), name: z.string() })
])

export type SecretStored = z.infer<typeof SecretStoredSchema>
export type SecretView = z.infer<typeof SecretViewSchema>
export type SecretInput = z.infer<typeof SecretInputSchema>

/** Secret fields default to "none". The factories below take one of these. */
const SecretStoredField = SecretStoredSchema.default({ kind: 'none' })
const SecretViewField = SecretViewSchema.default({ kind: 'none' })
const SecretInputField = SecretInputSchema.default({ kind: 'none' })
type SecretSchema = typeof SecretStoredField | typeof SecretViewField | typeof SecretInputField

// ─── Shared backend parts ────────────────────────────────────────────────────

function networkSchema<S extends SecretSchema>(secret: S) {
  return z.object({
    headers: z.array(z.object({ name: z.string(), value: secret })).default([]),
    /** http://, https:// or socks5:// URL; empty means direct. */
    proxy: z.string().default(''),
    allowSelfSigned: z.boolean().default(false),
    timeoutMs: z.number().int().min(1000).max(600_000).default(120_000),
    retries: z.number().int().min(0).max(10).default(1)
  })
}

export const HttpMethodSchema = z.enum(['POST', 'PUT', 'GET'])

// ─── Text backends ───────────────────────────────────────────────────────────

export const TextBackendTypeSchema = z.enum([
  'openai',
  'anthropic',
  'ollama',
  'koboldcpp',
  'textgen-webui',
  'custom'
])
export type TextBackendType = z.infer<typeof TextBackendTypeSchema>

export const TokenizerSchema = z.enum(['chars4', 'chars3.5'])

export const TextGenerationSchema = z.object({
  stream: z.boolean().default(true),
  /** null means "don't send this field". */
  temperature: z.number().min(0).max(5).nullable().default(0.9),
  topP: z.number().min(0).max(1).nullable().default(null),
  topK: z.number().int().min(0).nullable().default(null),
  minP: z.number().min(0).max(1).nullable().default(null),
  repetitionPenalty: z.number().min(0).max(3).nullable().default(null),
  maxTokens: z.number().int().min(1).max(200_000).default(800),
  contextSize: z.number().int().min(512).max(2_000_000).default(16_384),
  stop: z.array(z.string()).default([]),
  /** JSON object text merged into every request body. */
  extraBody: z.string().default('')
})

export const CustomTextSchema = z.object({
  url: z.string().default(''),
  method: HttpMethodSchema.default('POST'),
  /** Placeholders: {{system}} {{messages_json}} {{prompt}} {{model}} {{max_tokens}} {{temperature}} */
  bodyTemplate: z.string().default(''),
  /** JSONPath to the reply text, e.g. $.choices[0].message.content */
  responsePath: z.string().default(''),
  streamParser: z.enum(['none', 'sse', 'ndjson']).default('none'),
  /** JSONPath to each streamed delta. */
  streamPath: z.string().default('')
})

function textBackendSchema<S extends SecretSchema>(secret: S) {
  return z.object({
    id: z.string(),
    name: z.string().min(1),
    type: TextBackendTypeSchema,
    baseUrl: z.string().default(''),
    apiKey: secret,
    model: z.string().default(''),
    network: networkSchema(secret).prefault({}),
    generation: TextGenerationSchema.prefault({}),
    tokenizer: TokenizerSchema.default('chars4'),
    custom: CustomTextSchema.prefault({}),
    anthropic: z
      .object({
        /** output_config.effort for Claude 4.6+; empty uses the model's default. */
        effort: z.enum(['', 'low', 'medium', 'high', 'xhigh', 'max']).default(''),
        /**
         * Server-side refusal fallback (`fallbacks: "default"`): if the model
         * declines, Anthropic re-runs the request on its recommended fallback
         * model. Only sent to api.anthropic.com for models that support it.
         */
        refusalFallback: z.boolean().default(true)
      })
      .prefault({})
  })
}

export const TextBackendSchema = textBackendSchema(SecretStoredField)
export const TextBackendViewSchema = textBackendSchema(SecretViewField)
export const TextBackendInputSchema = textBackendSchema(SecretInputField)
export type TextBackend = z.infer<typeof TextBackendSchema>
export type TextBackendView = z.infer<typeof TextBackendViewSchema>
export type TextBackendInput = z.infer<typeof TextBackendInputSchema>

// ─── Image backends ──────────────────────────────────────────────────────────

export const ImageBackendTypeSchema = z.enum(['comfyui', 'a1111', 'openai', 'custom'])
export type ImageBackendType = z.infer<typeof ImageBackendTypeSchema>

export const NodeInputSchema = z.object({ nodeId: z.string(), input: z.string() })
export type NodeInput = z.infer<typeof NodeInputSchema>

export const ComfyMappingSchema = z.object({
  positive: NodeInputSchema.nullable().default(null),
  negative: NodeInputSchema.nullable().default(null),
  seed: NodeInputSchema.nullable().default(null),
  width: NodeInputSchema.nullable().default(null),
  height: NodeInputSchema.nullable().default(null),
  steps: NodeInputSchema.nullable().default(null),
  cfg: NodeInputSchema.nullable().default(null),
  checkpoint: NodeInputSchema.nullable().default(null),
  lora: NodeInputSchema.nullable().default(null),
  loraStrength: NodeInputSchema.nullable().default(null),
  /** LoadImage node used for img2img. */
  sourceImage: NodeInputSchema.nullable().default(null)
})
export type ComfyMapping = z.infer<typeof ComfyMappingSchema>

export const ComfyWorkflowSchema = z.object({
  id: z.string(),
  name: z.string(),
  purpose: z.enum(['portrait', 'scene', 'map', 'other']).default('other'),
  /** Where the API-format JSON lives. */
  location: z.enum(['appdata', 'vault']).default('appdata'),
  /** Relative to %APPDATA%\DND Tavern\workflows\ or to the vault root. */
  file: z.string(),
  mapping: ComfyMappingSchema.prefault({}),
  seedMode: z.enum(['random', 'fixed']).default('random'),
  fixedSeed: z.number().int().default(0),
  checkpoint: z.string().default(''),
  lora: z.string().default(''),
  loraStrength: z.number().default(0.8)
})
export type ComfyWorkflow = z.infer<typeof ComfyWorkflowSchema>

export const ImageDefaultsSchema = z.object({
  width: z.number().int().min(64).max(4096).default(832),
  height: z.number().int().min(64).max(4096).default(1216),
  steps: z.number().int().min(1).max(200).default(28),
  cfg: z.number().min(0).max(30).default(6),
  sampler: z.string().default('euler'),
  negativePrompt: z.string().default('lowres, blurry, watermark, text, deformed'),
  stylePrefix: z.string().default(''),
  styleSuffix: z.string().default('')
})

function imageBackendSchema<S extends SecretSchema>(secret: S) {
  return z.object({
    id: z.string(),
    name: z.string().min(1),
    type: ImageBackendTypeSchema,
    baseUrl: z.string().default(''),
    apiKey: secret,
    network: networkSchema(secret).prefault({}),
    defaults: ImageDefaultsSchema.prefault({}),
    comfy: z
      .object({
        workflows: z.array(ComfyWorkflowSchema).default([]),
        defaultWorkflowId: z.string().nullable().default(null)
      })
      .prefault({}),
    openai: z
      .object({
        model: z.string().default('gpt-image-1'),
        size: z.string().default('1024x1024'),
        quality: z.string().default('')
      })
      .prefault({}),
    custom: z
      .object({
        url: z.string().default(''),
        method: HttpMethodSchema.default('POST'),
        bodyTemplate: z.string().default(''),
        /** JSONPath to the image URL or base64 string. */
        imagePath: z.string().default(''),
        resultKind: z.enum(['url', 'base64']).default('base64')
      })
      .prefault({})
  })
}

export const ImageBackendSchema = imageBackendSchema(SecretStoredField)
export const ImageBackendViewSchema = imageBackendSchema(SecretViewField)
export const ImageBackendInputSchema = imageBackendSchema(SecretInputField)
export type ImageBackend = z.infer<typeof ImageBackendSchema>
export type ImageBackendView = z.infer<typeof ImageBackendViewSchema>
export type ImageBackendInput = z.infer<typeof ImageBackendInputSchema>

// ─── Other sections ──────────────────────────────────────────────────────────

export const ThemeSchema = z.enum(['dark', 'parchment', 'contrast'])

export const AppearanceSchema = z.object({
  theme: ThemeSchema.default('dark'),
  /** Hex colour overriding the theme's gold accent; null uses the theme default. */
  accent: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .default(null),
  uiScale: z.number().min(0.9).max(1.3).default(1),
  chatFontSize: z.number().int().min(12).max(28).default(17),
  reduceMotion: z.enum(['system', 'on', 'off']).default('system'),
  dice3d: z.boolean().default(false),
  windowMaterial: z.enum(['auto', 'mica', 'acrylic', 'none']).default('auto')
})
export type Appearance = z.infer<typeof AppearanceSchema>

export const PromptSettingsSchema = z.object({
  blocks: z
    .array(z.object({ id: z.string(), enabled: z.boolean() }))
    .default(PROMPT_BLOCK_IDS.map((id) => ({ id, enabled: true }))),
  /** Tokens available for the whole prompt; 0 means use the backend's context size. */
  contextBudget: z.number().int().min(0).default(0),
  lorebookScanDepth: z.number().int().min(1).max(100).default(6),
  lorebookTokenBudget: z.number().int().min(0).default(1024),
  /** Update the rolling summary every N messages; 0 disables it. */
  summaryEvery: z.number().int().min(0).default(20),
  /** Compress a session into a recap when the player leaves it. */
  autoRecap: z.boolean().default(true),
  /** How many earlier sessions' recaps a session's prompt includes. */
  recapCount: z.number().int().min(0).max(20).default(3),
  autoState: z.boolean().default(false)
})

export const SettingsSchema = z.object({
  version: z.literal(1).default(1),
  setupComplete: z.boolean().default(false),
  vault: z
    .object({
      path: z.string().default(''),
      rootFolder: z.string().default('DND Tavern')
    })
    .prefault({}),
  textBackends: z.array(TextBackendSchema).default([]),
  defaultTextBackendId: z.string().nullable().default(null),
  /** Try the next backend in list order when the default fails. */
  fallbackChain: z.boolean().default(true),
  roles: z
    .object({
      chat: z.string().nullable().default(null),
      summary: z.string().nullable().default(null),
      imagePrompt: z.string().nullable().default(null)
    })
    .prefault({}),
  imageBackends: z.array(ImageBackendSchema).default([]),
  defaultImageBackendId: z.string().nullable().default(null),
  imageTriggers: z
    .object({
      everyNDmTurns: z.number().int().min(0).default(0),
      onLocationChange: z.boolean().default(false),
      sceneContextMessages: z.number().int().min(1).max(50).default(8)
    })
    .prefault({}),
  prompt: PromptSettingsSchema.prefault({}),
  general: z
    .object({
      playerName: z.string().default('Adventurer'),
      defaultCharacter: z.string().nullable().default(null),
      defaultCampaign: z.string().nullable().default(null),
      defaultPreset: z.string().nullable().default(null),
      sessionDateFormat: z.string().default('YYYY-MM-DD')
    })
    .prefault({}),
  appearance: AppearanceSchema.prefault({}),
  behavior: z
    .object({
      launchOnStartup: z.boolean().default(false),
      minimizeToTray: z.boolean().default(false),
      autoUpdateCheck: z.boolean().default(false)
    })
    .prefault({}),
  security: z
    .object({
      warnInsecureHttp: z.boolean().default(true)
    })
    .prefault({}),
  extensions: z
    .object({
      enabled: z.record(z.string(), z.object({ granted: z.array(z.string()) })).default({}),
      settings: z.record(z.string(), z.record(z.string(), z.unknown())).default({})
    })
    .prefault({})
})

export type Settings = z.infer<typeof SettingsSchema>

export const ExtensionPermissionSchema = z.enum(['vault:read', 'vault:write', 'network', 'generate:text', 'generate:image'])

/** extension.json */
export const ExtensionManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/, 'id must be lowercase letters, digits and dashes'),
  name: z.string().min(1).max(80),
  version: z.string().max(40).default('0.0.0'),
  description: z.string().max(500).default(''),
  author: z.string().max(80).optional(),
  permissions: z.array(ExtensionPermissionSchema).default([]),
  main: z.string().max(120).optional(),
  ui: z.string().max(120).optional(),
  commands: z
    .array(z.object({ name: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/), description: z.string().max(200).default(''), usage: z.string().max(120).optional() }))
    .default([]),
  settings: z
    .array(
      z.object({
        key: z.string().max(40),
        label: z.string().max(80),
        type: z.enum(['string', 'number', 'boolean', 'select']),
        default: z.union([z.string(), z.number(), z.boolean()]),
        options: z.array(z.string()).optional()
      })
    )
    .default([])
})

/** Settings as the renderer sees them: every secret replaced by a SecretView. */
export type PublicSettings = Omit<Settings, 'textBackends' | 'imageBackends'> & {
  textBackends: TextBackendView[]
  imageBackends: ImageBackendView[]
}

/**
 * Turns an object schema into a patch schema: every field optional and every
 * default removed. (zod 4's .partial() still fills defaults for missing keys,
 * which would reset settings the patch never mentioned.)
 */
function patchOf<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  const shape: Record<string, z.ZodType> = {}
  for (const [key, field] of Object.entries(schema.shape)) {
    let inner = field as z.ZodType
    while (inner instanceof z.ZodDefault || inner instanceof z.ZodPrefault) {
      inner = inner.unwrap() as z.ZodType
    }
    shape[key] = inner.optional()
  }
  return z.object(shape).strict()
}

function unwrapObject<T extends z.ZodRawShape>(
  schema: z.ZodPrefault<z.ZodObject<T>> | z.ZodObject<T>
): z.ZodObject<T> {
  return schema instanceof z.ZodPrefault ? (schema.unwrap() as z.ZodObject<T>) : schema
}

const S = SettingsSchema.shape

/**
 * Patch for scalar sections. Backends are changed through their own IPC
 * channels so secrets are always handled by the main process.
 */
export const SettingsPatchSchema = z
  .object({
    setupComplete: z.boolean().optional(),
    vault: patchOf(unwrapObject(S.vault)).optional(),
    defaultTextBackendId: z.string().nullable().optional(),
    fallbackChain: z.boolean().optional(),
    roles: patchOf(unwrapObject(S.roles)).optional(),
    defaultImageBackendId: z.string().nullable().optional(),
    imageTriggers: patchOf(unwrapObject(S.imageTriggers)).optional(),
    prompt: patchOf(PromptSettingsSchema).optional(),
    general: patchOf(unwrapObject(S.general)).optional(),
    appearance: patchOf(AppearanceSchema).optional(),
    behavior: patchOf(unwrapObject(S.behavior)).optional(),
    security: patchOf(unwrapObject(S.security)).optional()
  })
  .strict()

/** Typed view of a patch (the runtime schema above loses field types). */
export type SettingsPatch = {
  setupComplete?: boolean
  vault?: Partial<Settings['vault']>
  defaultTextBackendId?: string | null
  fallbackChain?: boolean
  roles?: Partial<Settings['roles']>
  defaultImageBackendId?: string | null
  imageTriggers?: Partial<Settings['imageTriggers']>
  prompt?: Partial<Settings['prompt']>
  general?: Partial<Settings['general']>
  appearance?: Partial<Settings['appearance']>
  behavior?: Partial<Settings['behavior']>
  security?: Partial<Settings['security']>
}

export function defaultSettings(): Settings {
  return SettingsSchema.parse({})
}
