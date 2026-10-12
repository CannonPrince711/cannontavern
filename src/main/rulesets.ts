/**
 * Rulesets on disk: the built-in ones (shared/rulesets.ts) plus custom notes
 * in Rulesets/, and the AI that writes new ones from a concept.
 */
import { extractJson } from '@shared/builder'
import { sanitizeFileName, toWikilink } from '@shared/names'
import {
  BUILTIN_RULESETS,
  builtinRuleset,
  RULESET_SYSTEM,
  RULESETS_FOLDER,
  rulesetDesignPrompt,
  rulesetForEdition,
  rulesetFromNote,
  rulesetRef,
  rulesetToNote,
  type Ruleset
} from '@shared/rulesets'
import type { Campaign } from '@shared/types'
import { backendChain } from './backends/chain'
import { resolveTextBackend, textAdapter } from './backends/text'
import { AppError, toErrorInfo } from './errors'
import { parseNote, serializeNote } from './vault/frontmatter'
import { settingsStore } from './settings-store'
import type { Vault } from './vault/vault'

/** A built-in id or a custom ruleset note; null when the note is gone. */
export async function readRuleset(vault: Vault, value: string | undefined): Promise<Ruleset | null> {
  const ref = rulesetRef(value, vault.rootFolder)
  if (!ref) return null
  const builtin = builtinRuleset(ref)
  if (builtin) return builtin
  const file = await vault.readIfExists(ref).catch(() => null)
  if (!file) return null
  const { data, body } = parseNote(file.content)
  return rulesetFromNote(ref, data, body)
}

/** The campaign's ruleset; without one (or with a missing note), its D&D edition. */
export async function campaignRuleset(vault: Vault, campaign: Pick<Campaign, 'ruleset' | 'edition'>): Promise<Ruleset> {
  return (await readRuleset(vault, campaign.ruleset)) ?? rulesetForEdition(campaign.edition)
}

export async function listRulesets(vault: Vault): Promise<Ruleset[]> {
  const dir = vault.rootPath(RULESETS_FOLDER)
  const entries = await vault.list(dir).catch(() => [])
  const custom = await Promise.all(
    entries
      .filter((e) => !e.isDir && e.name.toLowerCase().endsWith('.md'))
      .map(async (e) => {
        const file = await vault.readIfExists(e.path).catch(() => null)
        if (!file) return null
        const { data, body } = parseNote(file.content)
        return data.type === 'ruleset' || data.type === undefined ? rulesetFromNote(e.path, data, body) : null
      })
  )
  return [...BUILTIN_RULESETS, ...custom.filter((r): r is Ruleset => !!r).sort((a, b) => a.name.localeCompare(b.name))]
}

/** Writes a custom ruleset (new, or over `id` when it's an existing note). */
export async function saveRuleset(vault: Vault, r: Omit<Ruleset, 'id'> & { id?: string }): Promise<Ruleset> {
  if (r.id && builtinRuleset(r.id)) throw new AppError('BUILTIN_RULESET', 'Built-in rulesets can’t be changed. Make a custom one instead.')
  const { data, body } = rulesetToNote(r)
  let path = r.id
  if (!path) {
    const dir = vault.rootPath(RULESETS_FOLDER)
    await vault.mkdir(dir)
    path = await vault.uniquePath(dir, sanitizeFileName(r.name || 'Custom rules'), '.md')
  }
  await vault.write(path, serializeNote(data, body))
  return rulesetFromNote(path, data, body)
}

/** The value a campaign stores: the id, or a link to the note. */
export function rulesetValue(r: Ruleset): string {
  return r.custom ? toWikilink(r.id, { full: true, alias: r.name }) : r.id
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const strs = (v: unknown, n: number): string[] => (Array.isArray(v) ? v.map((x) => str(x, 60)).filter(Boolean).slice(0, n) : [])

/** Asks the DM's text model to design a ruleset. Returns a draft; nothing is saved. */
export async function generateRuleset(concept: string): Promise<Omit<Ruleset, 'id'>> {
  if (!concept.trim()) throw new AppError('NO_CONCEPT', 'Describe the game first.')
  const backend = backendChain(settingsStore.get())[0]
  if (!backend) throw new AppError('NO_BACKEND', 'Add a text backend in Settings first: it writes the rules.')
  const resolved = resolveTextBackend(backend)
  const streaming = backend.generation.stream
  const net = streaming ? resolved.net : { ...resolved.net, timeoutMs: Math.max(resolved.net.timeoutMs, 600_000) }
  const ask = rulesetDesignPrompt(concept)
  let raw: Record<string, unknown> | null = null
  let last = ''
  // A reply that can't be read gets one stricter retry.
  for (const retry of [false, true]) {
    try {
      const r = await textAdapter(backend.type).generate(
        { ...resolved, net },
        { system: RULESET_SYSTEM, messages: [{ role: 'user', content: retry ? `${ask}\n\nReply with the JSON object only, nothing else.` : ask }], maxTokens: 2000 },
        { stream: streaming }
      )
      last = r.text
    } catch (err) {
      throw new AppError('RULESET_FAILED', `Couldn’t ask ${backend.name} for the rules: ${toErrorInfo(err).message}`)
    }
    try {
      const parsed = extractJson(last)
      if (parsed && typeof parsed === 'object' && str((parsed as Record<string, unknown>).rules, 10)) {
        raw = parsed as Record<string, unknown>
        break
      }
    } catch {
      /* retry */
    }
  }
  if (!raw) throw new AppError('RULESET_FAILED', 'The model didn’t reply with a ruleset. Try again.', `${backend.name} replied: ${last.trim().slice(0, 300) || '(an empty reply)'}`)
  const terms = (raw.terms && typeof raw.terms === 'object' ? raw.terms : {}) as Record<string, unknown>
  const name = str(raw.name, 80) || 'Custom rules'
  return {
    name,
    short: str(raw.short, 14) || name.slice(0, 14),
    engine: raw.engine === '3.5e' ? '3.5e' : '5e',
    math: false,
    sourcebooks: false,
    rules: `Rules: ${name}. ${str(raw.rules, 6000)}`,
    classes: strs(raw.classes, 20),
    ancestries: strs(raw.ancestries, 20),
    terms: {
      race: str(terms.race, 30) || 'Race',
      class: str(terms.class, 30) || 'Class',
      level: str(terms.level, 30) || 'Level',
      spells: str(terms.spells, 30) || 'Spells'
    },
    blurb: str(raw.blurb, 200),
    custom: true
  }
}

