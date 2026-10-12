/**
 * "Generate resources for this world": the world's DM model writes lorebook
 * entries (items, magic, creatures, services, townsfolk) that fit the
 * campaign, into "<Campaign> Resources" in Lorebooks/, which is attached to
 * the campaign. Running it again adds to the same lorebook, skipping titles
 * it already has.
 */
import { extractJson } from '@shared/builder'
import { CAMPAIGN_FILE, FOLDERS } from '@shared/layout'
import { joinVaultPath, sanitizeFileName, toWikilink } from '@shared/names'
import { serializeLorebookBody } from '@shared/notes'
import type { LoreEntry, VaultPath } from '@shared/types'
import { WORLD_RESOURCE_KINDS, type WorldResourceKind } from '@shared/world'
import { backendChain } from './backends/chain'
import { resolveTextBackend, textAdapter } from './backends/text'
import { AppError, toErrorInfo } from './errors'
import { readCampaign, readLorebook, resolveLorebookLinks, saveLorebook } from './library'
import { serializeNote, updateNote } from './vault/frontmatter'
import { vaultService } from './vault/service'
import { settingsFor } from './world'

const KIND_PROMPT: Record<WorldResourceKind, string> = {
  items: 'everyday gear, tools, food, clothing and trade goods people in this world actually use, each with a typical price in the local currency',
  magic: 'magic items, relics or special artifacts that fit this world, each with what it does, how rare it is and a cost or how it is obtained',
  creatures: 'monsters, beasts and typical foes of this world, each with how it behaves, how dangerous it is (a rough challenge rating) and a weakness',
  services: 'inns, shops, guilds and services found here, each with what it offers and typical prices',
  townsfolk: 'generic people the party will meet (guards, merchants, officials and so on) as this world would have them, each with a want and how they treat outsiders'
}

const SYSTEM = `You write lorebook entries for a tabletop roleplaying campaign. Each entry is something the Dungeon Master can use when it comes up in play. Fit the campaign's setting, tone and naming style exactly; invent specific names rather than generic ones. Reply with JSON only, in this shape:
{"entries":[{"title":"short name","keys":["trigger word","another"],"content":"two or three sentences"}]}
Keys are 2 to 5 lowercase words or short phrases a player might type that should bring the entry up. Keep content factual and useful at the table: no dialogue, no lists inside the content.`

export async function generateWorldResources(
  campaignPath: VaultPath,
  opts: { kinds: WorldResourceKind[]; count: number }
): Promise<{ lorebookPath: VaultPath; added: number }> {
  const vault = vaultService.require()
  const { campaign } = await readCampaign(vault, campaignPath)
  const backend = backendChain(settingsFor(campaignPath))[0]
  if (!backend) throw new AppError('NO_BACKEND', 'Add a text backend in Settings first.')
  const kinds = WORLD_RESOURCE_KINDS.filter((k) => opts.kinds.includes(k))
  if (!kinds.length) throw new AppError('NOTHING_CHOSEN', 'Choose at least one kind of resource.')

  // Add to the world's existing resources lorebook, if it has one.
  const name = `${campaign.name} Resources`
  const linked = await resolveLorebookLinks(vault, campaign.lorebooks)
  const target = linked.find((p) => p.toLowerCase().endsWith(`/${sanitizeFileName(name).toLowerCase()}.md`)) ?? vault.rootPath(FOLDERS.lorebooks, `${sanitizeFileName(name)}.md`)
  const existing = (await vault.exists(target)) ? await readLorebook(vault, target) : null
  const titles = new Set((existing?.entries ?? []).map((e) => e.title.toLowerCase()))

  const description = [
    `Campaign: ${campaign.name}`,
    campaign.setting.trim() && `Setting: ${campaign.setting.trim()}`,
    campaign.tone.trim() && `Tone: ${campaign.tone.trim()}`,
    campaign.house_rules.trim() && `House rules: ${campaign.house_rules.trim()}`,
    campaign.body.trim() && `World notes: ${campaign.body.trim().slice(0, 2000)}`
  ]
    .filter(Boolean)
    .join('\n')

  const added: LoreEntry[] = []
  const failures: string[] = []
  // One small request per kind: easier for local models, and one bad reply doesn't lose the rest.
  for (const kind of kinds) {
    const avoid = [...titles].slice(0, 80)
    const ask = `${description}\n\nWrite ${opts.count} entries: ${KIND_PROMPT[kind]}.${avoid.length ? `\nDon't repeat these existing entries: ${avoid.join(', ')}.` : ''}`
    try {
      const r = await textAdapter(backend.type).generate(resolveTextBackend(backend), { system: SYSTEM, messages: [{ role: 'user', content: ask }], maxTokens: 3000 }, { stream: false })
      const raw = extractJson(r.text) as { entries?: unknown }
      for (const e of Array.isArray(raw?.entries) ? raw.entries : []) {
        const o = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>
        const title = typeof o.title === 'string' ? o.title.replace(/^#+\s*/, '').trim().slice(0, 120) : ''
        const content = typeof o.content === 'string' ? o.content.trim().slice(0, 2000) : ''
        if (!title || !content || titles.has(title.toLowerCase())) continue
        const keys = (Array.isArray(o.keys) ? o.keys : [])
          .filter((k): k is string => typeof k === 'string' && !!k.trim())
          .map((k) => k.trim().toLowerCase().slice(0, 60))
          .slice(0, 8)
        titles.add(title.toLowerCase())
        added.push({ title, keys: keys.length ? keys : [title.toLowerCase()], content, always_on: false, priority: kind === 'magic' ? 3 : 1, enabled: true })
      }
    } catch (err) {
      failures.push(`${kind}: ${toErrorInfo(err).message}`)
    }
  }
  if (!added.length) throw new AppError('GENERATE_FAILED', 'The model didn’t write any usable entries.', failures.join('\n') || undefined)

  if (existing) {
    await saveLorebook(vault, { ...existing, entries: [...existing.entries, ...added] })
  } else {
    await vault.mkdir(vault.rootPath(FOLDERS.lorebooks))
    await vault.write(
      target,
      serializeNote({ type: 'lorebook', name }, serializeLorebookBody(`Items, creatures and people made for ${campaign.name}. Edit or delete anything that doesn’t fit.`, added)),
      { baseHash: null }
    )
  }
  // Attach it to the campaign if it isn't already.
  if (!linked.some((p) => p.toLowerCase() === target.toLowerCase())) {
    const links = [...campaign.lorebooks, toWikilink(target, { full: true })]
    await vault.mutate(joinVaultPath(campaignPath, CAMPAIGN_FILE), (cur) => (cur === null ? serializeNote({ type: 'campaign', lorebooks: links }, '\n') : updateNote(cur, { lorebooks: links })))
    await vaultService.reindex(joinVaultPath(campaignPath, CAMPAIGN_FILE))
  }
  await vaultService.reindex(target)
  return { lorebookPath: target, added: added.length }
}
