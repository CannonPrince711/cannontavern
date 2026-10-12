import { CampaignConceptSchema, CampaignDraftSchema, type CampaignConcept, type CampaignDraft, type DraftPiece } from '@shared/builder'
import { PLAY_MODES, type PlayMode } from '@shared/play'
import { buildCampaign, cancelDraft, draftCampaign, redraftPiece } from '../builder'
import { EDITIONS, type Edition } from '@shared/editions'
import { z } from 'zod'
import { CAMPAIGN_FILE, FOLDERS } from '@shared/layout'
import { joinVaultPath, sanitizeFileName, toWikilink } from '@shared/names'
import { DEFAULT_DM_PROMPT } from '@shared/prompt'
import { compactWorld, LEGACY_MODEL_KEYS, WORLD_RESOURCE_KINDS, WorldOverridesSchema } from '@shared/world'
import type { Lorebook } from '@shared/types'
import { AppError } from '../errors'
import { handle } from '../ipc'
import { readCampaign, readLorebook, readPreset, saveLorebook } from '../library'
import { serializeNote, updateNote } from '../vault/frontmatter'
import { vaultService } from '../vault/service'
import { suggestGenerators } from '../world-suggest'
import { generateWorldResources } from '../world-resources'
import { generateRuleset, listRulesets, readRuleset, rulesetValue, saveRuleset } from '../rulesets'
import { rulesetRef } from '@shared/rulesets'

const path = z.string().min(1).max(1024)

const LoreEntrySchema = z.object({
  title: z.string().min(1).max(200),
  keys: z.array(z.string().max(200)),
  content: z.string().max(100_000),
  always_on: z.boolean(),
  priority: z.number(),
  enabled: z.boolean()
})

export function registerLoreHandlers(): void {
  handle('lorebooks:get', (_e, p) => readLorebook(vaultService.require(), p), z.tuple([path]))

  handle(
    'lorebooks:save',
    async (_e, book, force) => {
      const vault = vaultService.require()
      if (!vault.isInRoot(book.path)) throw new AppError('VAULT_READONLY', 'Lorebooks live in the DND Tavern folder.')
      const saved = await saveLorebook(vault, book, force === true)
      await vaultService.reindex(saved.path)
      return saved
    },
    z.tuple([
      z.object({ path, name: z.string(), entries: z.array(LoreEntrySchema), mtimeMs: z.number(), hash: z.string() }),
      z.boolean().optional()
    ]) as unknown as z.ZodType<[Lorebook, boolean?]>
  )

  handle(
    'lorebooks:create',
    async (_e, name) => {
      const vault = vaultService.require()
      const dir = vault.rootPath(FOLDERS.lorebooks)
      await vault.mkdir(dir)
      const p = await vault.uniquePath(dir, sanitizeFileName(name), '.md')
      const book = await saveLorebook(vault, {
        path: p,
        name,
        mtimeMs: 0,
        hash: '',
        intro: 'Each “## Heading” is one entry. List trigger words after keys::, and the DM sees the entry when one appears in the chat.',
        entries: [{ title: 'Example entry', keys: ['example'], content: 'Describe a place, person or legend here.', always_on: false, priority: 0, enabled: true }]
      })
      await vaultService.reindex(p)
      return book
    },
    z.tuple([z.string().min(1).max(120)])
  )

  handle('campaigns:draft', (_e, concept) => draftCampaign(concept), z.tuple([CampaignConceptSchema]) as unknown as z.ZodType<[CampaignConcept]>)
  handle('campaigns:cancelDraft', () => cancelDraft())
  handle(
    'campaigns:redraftPiece',
    (_e, concept, draft, piece) => redraftPiece(concept, draft, piece),
    z.tuple([CampaignConceptSchema, CampaignDraftSchema, z.enum(['overview', 'locations', 'npcs', 'factions', 'story'])]) as unknown as z.ZodType<[CampaignConcept, CampaignDraft, DraftPiece]>
  )

  handle(
    'campaigns:build',
    async (_e, draft, opts) => {
      const r = await buildCampaign(draft, opts)
      return { index: vaultService.getIndex()!, ...r }
    },
    z.tuple([
      CampaignDraftSchema,
      z.object({ mode: z.enum(PLAY_MODES), session: z.boolean(), characterPath: path.optional(), edition: z.enum(EDITIONS).optional(), ruleset: z.string().max(1024).optional() })
    ]) as unknown as z.ZodType<[CampaignDraft, { mode: PlayMode; session: boolean; characterPath?: string; edition?: Edition; ruleset?: string }]>
  )

  handle(
    'campaigns:update',
    async (_e, campaignPath, patch) => {
      const vault = vaultService.require()
      const fields: Record<string, unknown> = {}
      if (patch.setting !== undefined) fields.setting = patch.setting.trim()
      if (patch.tone !== undefined) fields.tone = patch.tone.trim()
      if (patch.house_rules !== undefined) fields.house_rules = patch.house_rules.trim()
      if (patch.edition !== undefined) fields.edition = patch.edition
      if (patch.ruleset !== undefined) {
        // The ruleset picks the sheet engine too.
        const r = patch.ruleset ? await readRuleset(vault, patch.ruleset) : null
        if (patch.ruleset && !r) throw new AppError('NO_RULESET', 'That ruleset isn’t in the vault any more.')
        fields.ruleset = r ? rulesetValue(r) : undefined
        if (r) fields.edition = r.engine === '5e' ? undefined : r.engine
      }
      if (patch.sources !== undefined) fields.sources = patch.sources.map((s) => s.trim()).filter(Boolean)
      if (patch.mode !== undefined) fields.mode = patch.mode === 'ai-dm' ? undefined : patch.mode
      // undefined deletes the key: a world without overrides leaves no trace in Campaign.md.
      if (patch.world !== undefined) {
        fields.world = patch.world ? compactWorld(patch.world) : undefined
        // The older image_models / text_models keys were read into the world block; it replaces them now.
        for (const k of LEGACY_MODEL_KEYS) fields[k] = undefined
      }
      await vault.mutate(joinVaultPath(campaignPath, CAMPAIGN_FILE), (cur) => (cur === null ? serializeNote({ type: 'campaign', ...fields }, '\n') : updateNote(cur, fields)))
      // Awaited so world settings apply to the very next reply or image.
      await vaultService.reindex(joinVaultPath(campaignPath, CAMPAIGN_FILE))
      return (await readCampaign(vault, campaignPath)).campaign
    },
    z.tuple([
      path,
      z.object({
        setting: z.string().max(10_000).optional(),
        tone: z.string().max(4000).optional(),
        house_rules: z.string().max(10_000).optional(),
        edition: z.enum(EDITIONS).optional(),
        sources: z.array(z.string().max(200)).max(200).optional(),
        mode: z.enum(PLAY_MODES).optional(),
        world: WorldOverridesSchema.nullable().optional(),
        ruleset: z.string().max(1024).nullable().optional()
      })
    ])
  )

  handle('rulesets:list', () => listRulesets(vaultService.require()))
  handle(
    'rulesets:save',
    async (_e, r) => {
      const vault = vaultService.require()
      const saved = await saveRuleset(vault, r)
      if (r.id) {
        // Campaigns hold a link with the name as its text: keep it current.
        for (const c of vaultService.getIndex()?.campaigns ?? []) {
          const { campaign } = await readCampaign(vault, c.path).catch(() => ({ campaign: null }))
          if (campaign?.ruleset && rulesetRef(campaign.ruleset, vault.rootFolder)?.toLowerCase() === r.id.toLowerCase()) {
            await vault.mutate(joinVaultPath(c.path, CAMPAIGN_FILE), (cur) => (cur === null ? null : updateNote(cur, { ruleset: rulesetValue(saved) })))
          }
        }
      }
      return saved
    },
    z.tuple([
      z.object({
        id: z.string().max(1024).optional(),
        name: z.string().min(1).max(80),
        short: z.string().max(14),
        engine: z.enum(EDITIONS),
        math: z.boolean(),
        sourcebooks: z.boolean(),
        rules: z.string().max(12_000),
        classes: z.array(z.string().max(60)).max(40),
        ancestries: z.array(z.string().max(60)).max(40),
        terms: z.object({ race: z.string().max(30), class: z.string().max(30), level: z.string().max(30), spells: z.string().max(30) }),
        blurb: z.string().max(300),
        custom: z.boolean().optional()
      })
    ])
  )
  handle('rulesets:generate', (_e, concept) => generateRuleset(concept), z.tuple([z.string().min(1).max(2000)]))
  handle(
    'rulesets:delete',
    async (_e, id) => {
      const vault = vaultService.require()
      const r = await readRuleset(vault, id)
      if (!r?.custom) throw new AppError('BUILTIN_RULESET', 'Only custom rulesets can be deleted.')
      // To the Recycle Bin; campaigns using it fall back to their D&D edition.
      await vault.delete(r.id)
    },
    z.tuple([z.string().min(1).max(1024)])
  )

  handle('campaigns:suggestGenerators', (_e, campaignPath) => suggestGenerators(campaignPath), z.tuple([path]))
  handle(
    'campaigns:generateResources',
    (_e, campaignPath, opts) => generateWorldResources(campaignPath, opts),
    z.tuple([path, z.object({ kinds: z.array(z.enum(WORLD_RESOURCE_KINDS)).min(1).max(WORLD_RESOURCE_KINDS.length), count: z.number().int().min(1).max(20) })])
  )

  handle(
    'campaigns:setLorebooks',
    async (_e, campaignPath, lorebookPaths) => {
      const vault = vaultService.require()
      const links = lorebookPaths.map((p) => toWikilink(p, { full: true }))
      await vault.mutate(joinVaultPath(campaignPath, CAMPAIGN_FILE), (cur) =>
        cur === null ? serializeNote({ type: 'campaign', lorebooks: links }, '\n') : updateNote(cur, { lorebooks: links })
      )
      return (await readCampaign(vault, campaignPath)).campaign
    },
    z.tuple([path, z.array(path)])
  )

  handle(
    'presets:get',
    async (_e, p) => {
      const preset = await readPreset(vaultService.require(), p)
      if (!preset) throw new AppError('NOT_FOUND', 'That preset note no longer exists.')
      return { path: p, ...preset }
    },
    z.tuple([path])
  )

  handle(
    'presets:create',
    async (_e, name) => {
      const vault = vaultService.require()
      const dir = vault.rootPath(FOLDERS.presets)
      await vault.mkdir(dir)
      const p = await vault.uniquePath(dir, sanitizeFileName(name), '.md')
      await vault.write(p, serializeNote({ type: 'preset', name, dm_mode: true }, `\n${DEFAULT_DM_PROMPT}\n`), { baseHash: null })
      await vaultService.reindex(p)
      return p
    },
    z.tuple([z.string().min(1).max(120)])
  )

  handle(
    'presets:save',
    async (_e, p, systemPrompt) => {
      const vault = vaultService.require()
      await vault.mutate(p, (cur) => (cur === null ? serializeNote({ type: 'preset' }, `\n${systemPrompt.trim()}\n`) : updateNote(cur, {}, `\n${systemPrompt.trim()}\n`)))
    },
    z.tuple([path, z.string().max(200_000)])
  )
}
