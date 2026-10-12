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
import { PLAY_MODES } from './play'

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
  purpose: z.enum(['portrait', 'scene', 'map', 'battlemap', 'other']).default('other'),
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
        defaultWorkflowId: z.string().nullable().default(null),
        /** Checkpoint for the built-in workflow (used when no workflow is imported); '' = the server's first. */
        checkpoint: z.string().default(''),
        /**
         * Leave nothing on the server: SaveImage nodes become PreviewImage (ComfyUI's temp folder, which it
         * empties when it restarts) and the job is cleared from the server's history once the image is downloaded.
         */
        deleteAfterDownload: z.boolean().default(false)
      })
      .prefault({}),
    openai: z
      .object({
        model: z.string().default('gpt-image-1'),
        size: z.string().default('1024x1024'),
        quality: z.string().default('')
      })
      .prefault({}),
    a1111: z
      .object({
        /** Checkpoint title from /sdapi/v1/sd-models; empty keeps whatever the server has loaded. */
        model: z.string().default('')
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
  /** Fold older messages into the summary once the prompt reaches this % of the context window; 0 disables it. */
  autoCompressAt: z.number().int().min(0).max(100).default(80),
  /** System prompt for the AI when it plays the character (You are DM / AI only). Empty uses the built-in one. */
  playerPrompt: z.string().default(''),
  /** Compress a session into a recap when the player leaves it. */
  autoRecap: z.boolean().default(true),
  /** How many earlier sessions' recaps a session's prompt includes. */
  recapCount: z.number().int().min(0).max(20).default(3),
  autoState: z.boolean().default(false)
})

/** What an image is for; each can use its own backend, model and size. */
export const IMAGE_PURPOSES = ['scene', 'portrait', 'map', 'battlemap', 'other'] as const
export type ImagePurpose = (typeof IMAGE_PURPOSES)[number]

/** Generation options for one purpose. Empty / 0 / null means "the backend's own setting". */
export const ImageProfileSchema = z.object({
  /** null: the default image backend (the one the model switcher picks). */
  backendId: z.string().nullable().default(null),
  /** Checkpoint or model name; '' keeps the backend's. */
  model: z.string().max(500).default(''),
  /** ComfyUI workflow; null picks one tagged for this purpose. */
  workflowId: z.string().nullable().default(null),
  /** 0 = automatic: the backend's size, shaped for the purpose. */
  width: z.number().int().min(0).max(4096).default(0),
  height: z.number().int().min(0).max(4096).default(0),
  /** 0 = the backend's steps. */
  steps: z.number().int().min(0).max(200).default(0),
  /** Added to the front of every prompt for this purpose, e.g. "parchment map, ink and watercolour". */
  style: z.string().max(500).default(''),
  /** Added to the backend's negative prompt. */
  negative: z.string().max(1000).default('')
})
export type ImageProfile = z.infer<typeof ImageProfileSchema>

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
      /** The DM (and every reply when Characters is empty). */
      chat: z.string().nullable().default(null),
      /** The characters when the AI writes as them (AI only, You are the DM, companions); null: same as chat. */
      character: z.string().nullable().default(null),
      summary: z.string().nullable().default(null),
      imagePrompt: z.string().nullable().default(null)
    })
    .prefault({}),
  imageBackends: z.array(ImageBackendSchema).default([]),
  defaultImageBackendId: z.string().nullable().default(null),
  imageProfiles: z
    .object({
      scene: ImageProfileSchema.prefault({}),
      portrait: ImageProfileSchema.prefault({}),
      map: ImageProfileSchema.prefault({}),
      battlemap: ImageProfileSchema.prefault({}),
      other: ImageProfileSchema.prefault({})
    })
    .prefault({}),
  imageTriggers: z
    .object({
      everyNDmTurns: z.number().int().min(0).default(0),
      onLocationChange: z.boolean().default(false),
      /** Paint a portrait for each new character or NPC note that has none. */
      autoPortraits: z.boolean().default(false),
      sceneContextMessages: z.number().int().min(1).max(50).default(8)
    })
    .prefault({}),
  /** Read-aloud: the OS voices, or an OpenAI-compatible /v1/audio/speech server. */
  tts: z
    .object({
      enabled: z.boolean().default(false),
      mode: z.enum(['system', 'server']).default('system'),
      baseUrl: z.string().max(500).default(''),
      model: z.string().max(200).default('tts-1'),
      voice: z.string().max(200).default(''),
      speed: z.number().min(0.25).max(4).default(1)
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
      autoUpdateCheck: z.boolean().default(false),
      /** Download updates in the background as soon as they're found. */
      autoDownloadUpdates: z.boolean().default(false),
      /** Double-click to edit, middle-click to open in Obsidian, Ctrl+wheel to zoom. */
      mouseShortcuts: z.boolean().default(true),
      /** What the mouse's back/forward buttons do. */
      mouseSideButtons: z.enum(['replies', 'sessions', 'off']).default('replies'),
      /** Corner thumbnail of the campaign map in the chat. */
      miniMap: z.boolean().default(true)
    })
    .prefault({}),
  play: z
    .object({
      /** Mode for new sessions in campaigns that don't set one (the last one used). */
      defaultMode: z.enum(PLAY_MODES).default('ai-dm'),
      /** AI-only play: turns per press of Auto-play, and the pause between them. */
      autoplayTurns: z.number().int().min(1).max(100).default(10),
      autoplayDelaySec: z.number().min(0).max(30).default(2),
      /** Post "The party travels to …" when the party token moves to a pin. */
      announceTravel: z.boolean().default(true),
      /** The tips & ideas bubble above the message box. */
      tipsBubble: z.boolean().default(true),
      /** Refresh its AI ideas after every reply (uses the summaries model each time). */
      ideasAuto: z.boolean().default(false),
      /** Optional countdown for your turn in chat and for each combatant in combat. */
      turnTimer: z
        .object({
          enabled: z.boolean().default(false),
          seconds: z.number().int().min(5).max(3600).default(90),
          combatSeconds: z.number().int().min(5).max(3600).default(60),
          /** remind: chime and a notice; pass: the turn moves on. */
          onExpire: z.enum(['remind', 'pass']).default('remind')
        })
        .prefault({})
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
    imageProfiles: patchOf(unwrapObject(S.imageProfiles)).optional(),
    prompt: patchOf(PromptSettingsSchema).optional(),
    tts: patchOf(unwrapObject(S.tts)).optional(),
    general: patchOf(unwrapObject(S.general)).optional(),
    appearance: patchOf(AppearanceSchema).optional(),
    behavior: patchOf(unwrapObject(S.behavior)).optional(),
    play: patchOf(unwrapObject(S.play)).optional(),
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
  imageProfiles?: Partial<Settings['imageProfiles']>
  prompt?: Partial<Settings['prompt']>
  tts?: Partial<Settings['tts']>
  general?: Partial<Settings['general']>
  appearance?: Partial<Settings['appearance']>
  behavior?: Partial<Settings['behavior']>
  play?: Partial<Settings['play']>
  security?: Partial<Settings['security']>
}

export function defaultSettings(): Settings {
  return SettingsSchema.parse({})
}

/** A backend from an export made without keys: a "none" key or secret header means "keep this PC's". */
export function keepMissingKeys(b: unknown): unknown {
  if (!b || typeof b !== 'object') return b
  const keep = (v: unknown): unknown => ((v as { kind?: string } | null)?.kind === 'none' ? { kind: 'keep' } : v)
  const backend = b as { apiKey?: unknown; network?: { headers?: { name: string; value: unknown }[] } }
  return {
    ...backend,
    apiKey: keep(backend.apiKey),
    ...(backend.network ? { network: { ...backend.network, headers: (backend.network.headers ?? []).map((h) => ({ ...h, value: keep(h.value) })) } } : {})
  }
}
