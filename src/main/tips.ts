/**
 * AI ideas for the tips bubble: three short suggestions for the user's next
 * move, written by the summaries model from the recent story and the sheet.
 */
import { playModeOf } from '@shared/play'
import { messageToTurn, renderCampaign, renderSheet } from '@shared/prompt'
import { IDEAS_SYSTEM, parseIdeas } from '@shared/tips'
import type { VaultPath } from '@shared/types'
import { backendChain } from './backends/chain'
import { resolveTextBackend, textAdapter } from './backends/text'
import { AppError } from './errors'
import { readCampaign, readCharacter, resolveCharacterLink } from './library'
import { readSession } from './sessions'
import { settingsStore } from './settings-store'
import { vaultService } from './vault/service'

export async function suggestIdeas(sessionPath: VaultPath): Promise<string[]> {
  const s = settingsStore.get()
  const chain = backendChain(s, 'summary')
  if (!chain.length) throw new AppError('NO_BACKEND', 'Add a text backend in Settings first.')
  const vault = vaultService.require()
  const session = await readSession(vault, sessionPath)
  const mode = playModeOf(session.frontmatter)
  const link = session.frontmatter.characters[0]
  const characterPath = link ? await resolveCharacterLink(vault, link) : null
  const character = characterPath ? await readCharacter(vault, characterPath).catch(() => null) : null
  const { campaign, party } = await readCampaign(vault, session.campaignPath).catch(() => ({ campaign: null, party: null }))
  const name = character?.card.name || session.frontmatter.persona || s.general.playerName

  const transcript = session.messages
    .filter((m) => !m.hidden && m.role !== 'image')
    .slice(-12)
    .map((m) => {
      const t = messageToTurn(m, name)
      if (!t) return null
      const who = m.role === 'dm' ? 'DM' : m.role === 'player' ? m.name || name : m.role === 'roll' ? 'Dice' : 'Note'
      return `${who}: ${t.content}`
    })
    .filter(Boolean)
    .join('\n\n')

  // A player shouldn't get hints from the DM's secret campaign notes.
  const parts = [renderCampaign(campaign, party, mode === 'ai-dm')]
  if (character?.card.dnd) parts.push(renderSheet(name, character.card.dnd))
  parts.push(`Recent story:\n${transcript || '(The session has just started.)'}`)
  parts.push('Reply with only a JSON array of exactly 3 strings.')

  let lastError: unknown = null
  for (const backend of chain) {
    try {
      const result = await textAdapter(backend.type).generate(
        resolveTextBackend(backend),
        { system: IDEAS_SYSTEM[mode], messages: [{ role: 'user', content: parts.filter(Boolean).join('\n\n') }], maxTokens: 400 },
        { stream: false }
      )
      const ideas = parseIdeas(result.text)
      if (ideas.length) return ideas
      lastError = new AppError('EMPTY_RESPONSE', `${backend.name} didn’t return any ideas.`)
    } catch (err) {
      lastError = err
    }
  }
  throw lastError
}
