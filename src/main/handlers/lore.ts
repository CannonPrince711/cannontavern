import { CampaignConceptSchema, CampaignDraftSchema, type CampaignConcept, type CampaignDraft } from '@shared/builder'
import { PLAY_MODES, type PlayMode } from '@shared/play'
import { buildCampaign, cancelDraft, draftCampaign } from '../builder'
import { EDITIONS, type Edition } from '@shared/editions'
import { z } from 'zod'
import { CAMPAIGN_FILE, FOLDERS } from '@shared/layout'
import { joinVaultPath, sanitizeFileName, toWikilink } from '@shared/names'
import { DEFAULT_DM_PROMPT } from '@shared/prompt'
import type { Lorebook } from '@shared/types'
import { AppError } from '../errors'
import { handle } from '../ipc'
import { readCampaign, readLorebook, readPreset, saveLorebook } from '../library'
import { serializeNote, updateNote } from '../vault/frontmatter'
import { vaultService } from '../vault/service'

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
    'campaigns:build',
    async (_e, draft, opts) => {
      const r = await buildCampaign(draft, opts)
      return { index: vaultService.getIndex()!, ...r }
    },
    z.tuple([
      CampaignDraftSchema,
      z.object({ mode: z.enum(PLAY_MODES), session: z.boolean(), characterPath: path.optional(), edition: z.enum(EDITIONS).optional() })
    ]) as unknown as z.ZodType<[CampaignDraft, { mode: PlayMode; session: boolean; characterPath?: string; edition?: Edition }]>
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
      if (patch.sources !== undefined) fields.sources = patch.sources.map((s) => s.trim()).filter(Boolean)
      if (patch.mode !== undefined) fields.mode = patch.mode === 'ai-dm' ? undefined : patch.mode
      await vault.mutate(joinVaultPath(campaignPath, CAMPAIGN_FILE), (cur) => (cur === null ? serializeNote({ type: 'campaign', ...fields }, '\n') : updateNote(cur, fields)))
      void vaultService.reindex(joinVaultPath(campaignPath, CAMPAIGN_FILE))
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
        mode: z.enum(PLAY_MODES).optional()
      })
    ])
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
