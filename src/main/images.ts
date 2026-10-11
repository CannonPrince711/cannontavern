import { randomUUID } from 'node:crypto'
import { newMessageId } from '@shared/callouts'
import type { InvokeArgs } from '@shared/ipc'
import { FOLDERS, IMAGES_FOLDER } from '@shared/layout'
import { formatDate, joinVaultPath, sanitizeFileName } from '@shared/names'
import { messageToTurn } from '@shared/prompt'
import type { ImageBackend } from '@shared/settings'
import type { CharacterNote, Message, MessageImage, Session, VaultPath } from '@shared/types'
import { buildImageRequest, imageAdapter, resolveImageBackend } from './backends/image'
import type { ImageRequest } from './backends/image/types'
import { resolveTextBackend, textAdapter } from './backends/text'
import { backendChain, chatService } from './chat'
import { AppError, toErrorInfo } from './errors'
import { send } from './ipc'
import { readCharacter, resolveCharacterLink } from './library'
import { postMessage, readSession } from './sessions'
import { settingsStore } from './settings-store'
import { updateNote } from './vault/frontmatter'
import { vaultService } from './vault/service'
import { getMainWindow } from './window'

type GenerateOpts = InvokeArgs<'images:generate'>[0]

const PROMPT_WRITER = `You write prompts for a text-to-image model. Describe one image as a single line of comma-separated visual details: subject, setting, lighting, mood, colours, composition, art style. Fantasy illustration. No story, no dialogue, no text in the image, no real artist names. At most 70 words. Reply with the prompt only.`

function slug(text: string, max = 40): string {
  const words = text.replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter(Boolean)
  let out = ''
  for (const w of words) {
    if ((out + ' ' + w).trim().length > max) break
    out = `${out} ${w}`.trim()
  }
  return sanitizeFileName(out || 'image')
}

class ImageService {
  private jobs = new Map<string, AbortController>()

  generate(opts: GenerateOpts): { requestId: string } {
    const s = settingsStore.get()
    const backend = s.imageBackends.find((b) => b.id === (opts.backendId ?? s.defaultImageBackendId)) ?? s.imageBackends[0]
    if (!backend) throw new AppError('NO_IMAGE_BACKEND', 'Add an image backend in Settings → Image backends first.')
    const requestId = randomUUID()
    const controller = new AbortController()
    this.jobs.set(requestId, controller)
    void this.run(requestId, backend, opts, controller.signal).finally(() => {
      this.jobs.delete(requestId)
      if (this.jobs.size === 0) getMainWindow()?.setProgressBar(-1)
    })
    return { requestId }
  }

  cancel(requestId: string): void {
    this.jobs.get(requestId)?.abort()
  }

  /** Writes an image prompt with the "image prompts" text backend; falls back to plain text. */
  private async writePrompt(instruction: string, fallback: string): Promise<string> {
    const backend = backendChain(settingsStore.get(), 'imagePrompt')[0]
    if (!backend) return fallback
    try {
      const r = await textAdapter(backend.type).generate(
        resolveTextBackend(backend),
        { system: PROMPT_WRITER, messages: [{ role: 'user', content: instruction }], maxTokens: 200 },
        { stream: false }
      )
      const text = r.text.replace(/^["'\s]+|["'\s]+$/g, '').replace(/^prompt:\s*/i, '').trim()
      return text || fallback
    } catch {
      return fallback
    }
  }

  private async scenePrompt(session: Session, messageId?: string, extra?: string): Promise<string> {
    const s = settingsStore.get()
    const visible = session.messages.filter((m) => !m.hidden && m.role !== 'image')
    let context: Message[]
    if (messageId) {
      const i = visible.findIndex((m) => m.id === messageId)
      context = i === -1 ? visible.slice(-1) : visible.slice(Math.max(0, i - 2), i + 1)
    } else {
      context = visible.slice(-s.imageTriggers.sceneContextMessages)
    }
    const persona = session.frontmatter.persona || s.general.playerName
    const transcript = context
      .map((m) => {
        const t = messageToTurn(m, persona)
        return t ? `${t.role === 'assistant' ? 'DM' : 'Player'}: ${t.content}` : null
      })
      .filter(Boolean)
      .join('\n\n')
    const focus = context[context.length - 1]?.text ?? ''
    return this.writePrompt(
      `Illustrate the current moment of this scene${extra ? ` (${extra})` : ''}:\n\n${transcript}`,
      focus.replace(/\[CHECK[^\]]*\]/gi, '').replace(/[*_#>]/g, '').slice(0, 350)
    )
  }

  private async portraitPrompt(c: CharacterNote, extra?: string): Promise<string> {
    const d = c.card.dnd
    const who = [d?.race, d?.class].filter(Boolean).join(' ')
    const fallback = `portrait of ${c.card.name}${who ? `, ${who}` : ''}, ${c.card.description.slice(0, 240)}`
    return this.writePrompt(
      `Character portrait (head and shoulders) of ${c.card.name}${who ? `, a ${who}` : ''}.${extra ? ` ${extra}.` : ''}\nDescription: ${c.card.description}\nPersonality: ${c.card.personality}`,
      fallback
    )
  }

  private pickWorkflow(backend: ImageBackend, purpose: 'portrait' | 'scene' | null, wanted?: string): string | undefined {
    if (backend.type !== 'comfyui') return undefined
    const wfs = backend.comfy.workflows
    return (wfs.find((w) => w.id === wanted) ?? (purpose ? wfs.find((w) => w.purpose === purpose) : undefined) ?? wfs.find((w) => w.id === backend.comfy.defaultWorkflowId) ?? wfs[0])?.id
  }

  private async run(requestId: string, backend: ImageBackend, opts: GenerateOpts, signal: AbortSignal): Promise<void> {
    const win = getMainWindow()
    const progress = (value: number, label?: string): void => {
      send(win, 'images:progress', { requestId, value, label })
      win?.setProgressBar(value > 0 ? Math.min(1, value) : 2)
    }
    try {
      const { image, session } = await this.produce(backend, opts, signal, progress)
      send(win, 'images:done', { requestId, image, ...(session ? { session } : {}) })
    } catch (err) {
      send(win, 'images:error', { requestId, error: toErrorInfo(err) })
    }
  }

  /** Generates without the event plumbing, for extensions: resolves with the saved image. */
  async generateNow(opts: GenerateOpts): Promise<MessageImage> {
    const s = settingsStore.get()
    const backend = s.imageBackends.find((b) => b.id === (opts.backendId ?? s.defaultImageBackendId)) ?? s.imageBackends[0]
    if (!backend) throw new AppError('NO_IMAGE_BACKEND', 'No image backend is configured.')
    return (await this.produce(backend, opts, undefined, () => {})).image
  }

  private async produce(
    backend: ImageBackend,
    opts: GenerateOpts,
    signal: AbortSignal | undefined,
    progress: (value: number, label?: string) => void
  ): Promise<{ image: MessageImage; session?: Session }> {
    const win = getMainWindow()
    {
      const vault = vaultService.require()
      const session = opts.sessionPath ? await readSession(vault, opts.sessionPath) : null
      progress(0, 'Writing the prompt…')

      let character: CharacterNote | null = null
      let prompt = opts.prompt?.trim() ?? ''
      let purpose: 'portrait' | 'scene' | null = null
      if (opts.kind === 'scene') {
        if (!session) throw new AppError('NO_SESSION', 'Open a session to illustrate a scene.')
        purpose = 'scene'
        prompt = await this.scenePrompt(session, opts.messageId, prompt || undefined)
      } else if (opts.kind === 'portrait') {
        purpose = 'portrait'
        const charPath =
          opts.characterPath ?? (session?.frontmatter.characters[0] ? await resolveCharacterLink(vault, session.frontmatter.characters[0]) : null)
        if (!charPath) throw new AppError('NO_CHARACTER', 'Choose a character for the portrait.')
        character = await readCharacter(vault, charPath)
        prompt = await this.portraitPrompt(character, prompt || undefined)
      }
      if (!prompt) throw new AppError('NO_PROMPT', 'Describe what to draw, e.g. /image a misty harbour at dusk.')

      // Scenes are landscape, portraits are portrait; the defaults decide the size.
      const d = backend.defaults
      const long = Math.max(d.width, d.height)
      const short = Math.min(d.width, d.height)
      const size = purpose === 'scene' ? { width: long, height: short } : purpose === 'portrait' ? { width: short, height: long } : {}
      const workflowId = this.pickWorkflow(backend, purpose, opts.workflowId)
      const over: Partial<ImageRequest> = { ...size, workflowId }

      // img2img from the avatar, when the chosen ComfyUI workflow has a LoadImage mapping.
      const wf = backend.comfy.workflows.find((w) => w.id === workflowId)
      if (character?.card.avatar && wf?.mapping.sourceImage) {
        const avatarPath = character.card.avatar.includes('/') ? character.card.avatar : vault.rootPath(FOLDERS.avatars, character.card.avatar)
        const data = await vault.readBinary(avatarPath).catch(() => null)
        if (data) over.source = { data, filename: avatarPath.split('/').pop()! }
      }

      progress(0.02, 'Generating…')
      const resolved = resolveImageBackend(backend)
      const req = buildImageRequest(backend, prompt, over)
      const result = await imageAdapter(backend.type).generate(resolved, req, { signal, onProgress: progress })

      // Where the file goes: the campaign's Images/ for sessions, avatars/ for portraits without a session.
      const date = formatDate(new Date(), 'YYYY-MM-DD')
      let dir: VaultPath
      if (session) dir = joinVaultPath(session.campaignPath, IMAGES_FOLDER)
      else if (character) dir = vault.rootPath(FOLDERS.avatars)
      else dir = vault.rootPath(IMAGES_FOLDER)
      await vault.mkdir(dir)
      const base = character ? `${sanitizeFileName(character.card.name)} portrait` : `${date} ${slug(opts.prompt || prompt)}`
      const path = await vault.uniquePath(dir, base, `.${result.ext}`)
      await vault.writeBinary(path, result.data)
      const file = path.split('/').pop()!
      const image: MessageImage = { file, prompt, backendId: backend.id, ...(workflowId ? { workflowId } : {}), ...(result.seed !== undefined ? { seed: result.seed } : {}) }

      let updated: Session | undefined
      if (session) {
        const caption = character ? `Portrait of ${character.card.name}` : (opts.prompt?.trim() || prompt).slice(0, 80)
        updated = await postMessage(vault, session.path, {
          id: newMessageId(),
          role: 'image',
          name: caption,
          text: `![[${file}]]`,
          swipes: [`![[${file}]]`],
          swipeIndex: 0,
          createdAt: new Date().toISOString(),
          image
        })
        send(win, 'session:updated', updated)
        void vaultService.reindex(session.path)
      } else if (character) {
        // A portrait made outside a session becomes the avatar.
        await vault.mutate(character.path, (cur) => (cur === null ? null : updateNote(cur, { avatar: file })))
        void vaultService.reindex(character.path)
      }
      return { image, session: updated }
    }
  }

  /** Automatic images after DM replies (every N turns, or on an apparent location change). */
  maybeAuto(sessionPath: VaultPath, dmText: string): void {
    const s = settingsStore.get()
    const t = s.imageTriggers
    if (!s.imageBackends.length || (!t.everyNDmTurns && !t.onLocationChange)) return
    void (async () => {
      const session = await readSession(vaultService.require(), sessionPath)
      let dmSince = 0
      for (let i = session.messages.length - 1; i >= 0; i--) {
        const m = session.messages[i]!
        if (m.role === 'image') break
        if (m.role === 'dm') dmSince++
      }
      const moved = t.onLocationChange && /\b(you (arrive|enter|reach|step into|emerge)|as you (approach|enter)|(?:^|\n)#{1,3} )/i.test(dmText)
      if ((t.everyNDmTurns && dmSince >= t.everyNDmTurns) || moved) {
        const { requestId } = this.generate({ sessionPath, kind: 'scene' })
        send(getMainWindow(), 'images:progress', { requestId, value: 0, label: 'Automatic illustration…' })
      }
    })().catch(() => {})
  }
}

export const imageService = new ImageService()

// Auto-illustration hooks into finished DM replies.
chatService.onReply = (sessionPath, text) => imageService.maybeAuto(sessionPath, text)
