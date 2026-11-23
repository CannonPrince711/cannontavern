/**
 * Idea generator (see shared/ideas.ts): rolls the idea dice, asks the chat
 * model to turn them into pitches, and appends kept ideas to the vault's
 * Ideas note. Generating writes nothing.
 */
import { adultRuleFrom, adultRuleLine, needsAdultRule } from '@shared/builder'
import { IDEAS_NOTE, IDEAS_SYSTEM, ideaMarkdown, ideasPrompt, parseIdeas, rollIdeaDice, type Idea, type IdeaRequest } from '@shared/ideas'
import type { VaultPath } from '@shared/types'
import { backendChain } from './backends/chain'
import { resolveTextBackend, textAdapter } from './backends/text'
import { AppError, toErrorInfo } from './errors'
import { settingsStore } from './settings-store'
import { vaultService } from './vault/service'

export async function generateIdeas(req: IdeaRequest): Promise<Idea[]> {
  const chain = backendChain(settingsStore.get(), 'chat')
  if (!chain.length) throw new AppError('NO_BACKEND', 'Add a text backend in Settings first: it writes the ideas.')
  const rule = adultRuleFrom(settingsStore.get().extensions.settings['mature-mode'])
  const rolls = rollIdeaDice(req.kind, req.count)
  const ask = ideasPrompt(req, rolls, needsAdultRule(req.vibes, rule) ? adultRuleLine(rule) : '')
  let lastError: unknown = null
  let lastReply = ''
  // Connection errors move on to the next backend; an unreadable reply gets one stricter retry.
  for (const backend of chain) {
    const resolved = resolveTextBackend(backend)
    const streaming = backend.generation.stream
    const net = streaming ? resolved.net : { ...resolved.net, timeoutMs: Math.max(resolved.net.timeoutMs, 600_000) }
    for (const retry of [false, true]) {
      try {
        const r = await textAdapter(backend.type).generate(
          { ...resolved, net },
          { system: IDEAS_SYSTEM, messages: [{ role: 'user', content: retry ? `${ask}\n\nReply with the JSON object only, nothing else.` : ask }], maxTokens: Math.min(4000, 700 * req.count + 400) },
          { stream: streaming }
        )
        lastReply = r.text
      } catch (err) {
        lastError = err
        break
      }
      const ideas = parseIdeas(lastReply, req.kind)
      if (ideas.length) return ideas
    }
  }
  if (lastReply) throw new AppError('IDEAS_FAILED', 'The model didn’t reply with ideas. Try again.', `It replied: ${lastReply.trim().slice(0, 300) || '(an empty reply)'}`)
  throw new AppError('IDEAS_FAILED', `Couldn’t reach a text backend for ideas: ${toErrorInfo(lastError).message}`)
}

/** Appends an idea to Ideas.md at the vault root (created on first save). Returns the note's path. */
export async function saveIdea(idea: Idea): Promise<VaultPath> {
  const vault = vaultService.require()
  const path = vault.rootPath(IDEAS_NOTE)
  await vault.mutate(path, (cur) => {
    const head = cur ?? '# Ideas\n\nSaved from CannonTavern’s idea generator. Use one from the app, or copy it into the campaign builder.\n'
    return `${head.replace(/\s*$/, '')}\n\n${ideaMarkdown(idea)}`
  })
  await vaultService.reindex(path)
  return path
}
