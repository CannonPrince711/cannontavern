/**
 * The character generator: the DM's model turns a player's concept into a
 * full character (card + D&D sheet) for a campaign, then the rules maths is
 * recalculated (shared/chargen.ts) and the note is written to Characters/.
 */
import { adultRuleFrom, extractJson } from '@shared/builder'
import { CHARGEN_SYSTEM, chargenPrompt, fixSheet, repairCharacterJson, sheetOnlyPrompt } from '@shared/chargen'
import { editionOf, type Edition } from '@shared/editions'
import { CAMPAIGN_FILE } from '@shared/layout'
import { joinVaultPath, sanitizeFileName, toWikilink } from '@shared/names'
import { defaultSheet, normalizeCard } from '@shared/notes'
import type { VaultPath } from '@shared/types'
import { backendChain } from './backends/chain'
import { resolveTextBackend, textAdapter } from './backends/text'
import { AppError, toErrorInfo } from './errors'
import { createCharacterFromCard, readCampaign } from './library'
import { settingsStore } from './settings-store'
import { vaultService } from './vault/service'
import { settingsFor } from './world'

export interface GenerateCharacterOpts {
  concept: string
  level: number
  race?: string
  cls?: string
  campaignPath?: VaultPath
  edition?: Edition
  npc?: boolean
}

export async function generateCharacter(opts: GenerateCharacterOpts): Promise<{ path: VaultPath; name: string; changes: string[] }> {
  const vault = vaultService.require()
  const s = opts.campaignPath ? settingsFor(opts.campaignPath) : settingsStore.get()
  const campaign = opts.campaignPath ? (await readCampaign(vault, opts.campaignPath).catch(() => null))?.campaign ?? null : null
  const edition: Edition = opts.edition ?? (campaign ? editionOf(campaign) : '5e')
  const index = vaultService.getIndex()
  const request = {
    concept: opts.concept,
    level: Math.min(20, Math.max(1, Math.round(opts.level) || 1)),
    race: opts.race?.trim() || undefined,
    cls: opts.cls?.trim() || undefined,
    edition,
    minAge: adultRuleFrom(settingsStore.get().extensions.settings['mature-mode']).minAge,
    campaign: campaign ? { name: campaign.name, setting: campaign.setting, tone: campaign.tone, houseRules: campaign.house_rules, sources: campaign.sources ?? [] } : undefined,
    avoidNames: [...(index?.characters ?? []), ...(index?.npcs ?? [])].map((c) => c.displayName)
  }
  const prompt = chargenPrompt(request)

  const backend = backendChain(s, 'chat')[0]
  if (!backend) throw new AppError('NO_BACKEND', 'Add a text backend in Settings first.')
  const resolved = resolveTextBackend(backend)
  const streaming = backend.generation.stream
  // Streaming keeps slow remote servers alive; a reply that only arrives at the end gets 10 minutes.
  const net = streaming ? resolved.net : { ...resolved.net, timeoutMs: Math.max(resolved.net.timeoutMs, 600_000) }

  let raw: Record<string, unknown> | null = null
  let lastError: unknown = null
  for (const retry of [false, true]) {
    try {
      const r = await textAdapter(backend.type).generate(
        { ...resolved, net },
        { system: CHARGEN_SYSTEM, messages: [{ role: 'user', content: retry ? `${prompt}\n\nReply with the JSON object only, nothing else.` : prompt }], maxTokens: 2500 },
        { stream: streaming }
      )
      const parsed = extractJson(repairCharacterJson(r.text))
      if (parsed && typeof parsed === 'object' && typeof (parsed as { name?: unknown }).name === 'string') {
        raw = parsed as Record<string, unknown>
        break
      }
      lastError = new Error('The reply had no character in it.')
    } catch (err) {
      lastError = err
    }
  }
  if (!raw) throw new AppError('CHARGEN_FAILED', 'The model’s reply couldn’t be read as a character. Try again, or simplify the concept.', toErrorInfo(lastError).message)

  const card = normalizeCard(raw, 'New character')
  // Small models sometimes leave the sheet out: ask for just the sheet once.
  if (!card.dnd?.class.trim()) {
    try {
      const r = await textAdapter(backend.type).generate(
        { ...resolved, net },
        { system: CHARGEN_SYSTEM, messages: [{ role: 'user', content: sheetOnlyPrompt(request, card.name, card.description) }], maxTokens: 1500 },
        { stream: streaming }
      )
      const sheetRaw = extractJson(repairCharacterJson(r.text)) as { dnd?: unknown } | null
      const again = normalizeCard({ name: card.name, dnd: sheetRaw?.dnd ?? sheetRaw }, card.name)
      if (again.dnd?.class.trim()) card.dnd = again.dnd
    } catch {
      // Keep the character without a full sheet; the player can fill it in.
    }
  }
  const sheet = { ...(card.dnd ?? defaultSheet(edition)), edition }
  const fixed = fixSheet(sheet)
  card.dnd = fixed.sheet
  if (campaign) card.tags = [...new Set([...card.tags, sanitizeFileName(campaign.name).toLowerCase().replace(/\s+/g, '-')])]

  const link = campaign ? ` for ${toWikilink(joinVaultPath(campaign.path, CAMPAIGN_FILE), { full: true, alias: campaign.name })}` : ''
  const body = `\n# ${card.name}\n\nMade with the character generator${link}.${opts.concept.trim() ? `\n\n> Concept: ${opts.concept.trim()}` : ''}\n`
  const note = await createCharacterFromCard(vault, card, body, opts.npc === true)
  await vaultService.reindex(note.path)
  return { path: note.path, name: card.name, changes: fixed.changes }
}
