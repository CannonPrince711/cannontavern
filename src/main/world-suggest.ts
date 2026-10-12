/**
 * "Pick the best generators for this world": asks the DM's text model to
 * match a campaign's setting and tone to the text and image models that are
 * actually installed on the user's backends. The answer is validated against
 * those lists and returned as world overrides for the user to review; nothing
 * is saved here.
 */
import { extractJson } from '@shared/builder'
import type { VaultPath } from '@shared/types'
import { validateSuggestion, type ImageInventory, type TextInventory, type WorldOverrides } from '@shared/world'
import { listImageModels } from './backends/image/models'
import { resolveTextBackend, textAdapter } from './backends/text'
import { backendChain } from './backends/chain'
import { AppError, toErrorInfo } from './errors'
import { readCampaign } from './library'
import { settingsStore } from './settings-store'
import { vaultService } from './vault/service'

const SYSTEM = `You choose AI models for a tabletop roleplaying campaign. You get the campaign's description and the models installed on the user's servers, and pick the best installed model for each job. Reply with JSON only.

Rules:
- Only use backend ids, model names and workflow ids exactly as listed. If nothing listed fits a job, leave that job out.
- ComfyUI without a workflow runs a standard checkpoint graph: it suits SD 1.5, SDXL, Illustrious, NoobAI and Pony checkpoints. FLUX, SD3, Z-Image and similar models only work with a listed workflow made for them, so pick them only together with such a workflow.
- Match the look to the campaign: anime or manga worlds want anime checkpoints (Illustrious, NoobAI, Pony, Animagine, WAI); gritty or realistic worlds want photoreal checkpoints (Juggernaut, RealVis and similar); classic fantasy can use painterly or illustrated ones. Battlemaps and maps should use a model or workflow made for maps when one exists.
- "style" is a short list of comma-separated tags put in front of every prompt for that job, written for the chosen model (Illustrious, NoobAI and Pony models expect quality tags such as "masterpiece, best quality"). "negative" is optional extra negative tags.
- For text, pick the backend and model best at long-form roleplay and storytelling; keep the current one unless another listed model is clearly better for this world.

Reply shape:
{"text":{"backend":"<id>","model":"<name>"},"images":{"scene":{"backend":"<id>","model":"<name>","workflow":"<id or empty>","style":"…","negative":"…"},"portrait":{…},"map":{…},"battlemap":{…}},"notes":"one or two sentences on why"}`

async function imageInventory(): Promise<ImageInventory[]> {
  const s = settingsStore.get()
  return Promise.all(
    s.imageBackends.map(async (b) => {
      try {
        const list = await listImageModels(b)
        return { id: b.id, name: b.name, type: b.type, models: list.models.slice(0, 200), workflows: list.workflows.map(({ id, name, purpose }) => ({ id, name, purpose })) }
      } catch {
        // A backend that's offline just offers nothing.
        return { id: b.id, name: b.name, type: b.type, models: [], workflows: [] }
      }
    })
  )
}

async function textInventory(): Promise<TextInventory[]> {
  const s = settingsStore.get()
  return Promise.all(
    s.textBackends.map(async (b) => {
      const models = await textAdapter(b.type)
        .listModels(resolveTextBackend(b))
        .catch(() => [])
      return { id: b.id, name: b.name, models: [...new Set([...(b.model ? [b.model] : []), ...models])].slice(0, 100), current: b.model }
    })
  )
}

export async function suggestGenerators(campaignPath: VaultPath): Promise<{ world: WorldOverrides; notes: string }> {
  const vault = vaultService.require()
  const { campaign } = await readCampaign(vault, campaignPath)
  const backend = backendChain(settingsStore.get())[0]
  if (!backend) throw new AppError('NO_BACKEND', 'Add a text backend in Settings first: it chooses the models.')
  const [images, texts] = await Promise.all([imageInventory(), textInventory()])
  if (!images.some((b) => b.models.length || b.workflows.length) && !texts.some((b) => b.models.length > 1)) {
    throw new AppError('NO_MODELS', 'None of your backends listed any models to choose from. Check that they are running.')
  }

  const description = [
    `Campaign: ${campaign.name}`,
    campaign.setting.trim() && `Setting: ${campaign.setting.trim()}`,
    campaign.tone.trim() && `Tone: ${campaign.tone.trim()}`,
    campaign.body.trim() && `Notes: ${campaign.body.trim().slice(0, 1500)}`
  ]
    .filter(Boolean)
    .join('\n')
  const inventory = JSON.stringify({ imageBackends: images, textBackends: texts.map(({ id, name, models, current }) => ({ id, name, current, models })) })

  const ask = `${description}\n\nInstalled:\n${inventory}`
  const resolved = resolveTextBackend(backend)
  const streaming = backend.generation.stream
  // Streaming keeps slow remote servers alive; a reply that only arrives at the end gets 10 minutes.
  const net = streaming ? resolved.net : { ...resolved.net, timeoutMs: Math.max(resolved.net.timeoutMs, 600_000) }
  let raw: unknown = null
  let lastReply = ''
  // A reply that can't be read gets one stricter retry.
  for (const retry of [false, true]) {
    let reply: string
    try {
      const r = await textAdapter(backend.type).generate(
        { ...resolved, net },
        { system: SYSTEM, messages: [{ role: 'user', content: retry ? `${ask}\n\nReply with the JSON object only, nothing else.` : ask }], maxTokens: 2000 },
        { stream: streaming }
      )
      reply = r.text
    } catch (err) {
      throw new AppError('SUGGEST_FAILED', `Couldn’t ask ${backend.name} for suggestions: ${toErrorInfo(err).message}`)
    }
    lastReply = reply
    try {
      const parsed = extractJson(reply)
      if (parsed && typeof parsed === 'object') {
        raw = parsed
        break
      }
    } catch {
      /* retry */
    }
  }
  if (!raw) {
    const start = lastReply.trim().slice(0, 300) || '(an empty reply)'
    throw new AppError('SUGGEST_FAILED', 'The model didn’t reply with a choice of models. Try again, or pick them yourself.', `${backend.name} replied: ${start}`)
  }
  const world = validateSuggestion(raw, images, texts)
  const n = (raw as Record<string, unknown> | null)?.notes
  const notes = typeof n === 'string' ? n.trim().slice(0, 600) : ''
  return { world, notes }
}
