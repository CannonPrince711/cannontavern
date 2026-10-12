import { z } from 'zod'
import { newMessageId } from '@shared/callouts'
import { toWikilink } from '@shared/names'
import { normalizeCard } from '@shared/notes'
import { PARTY_LIMITS, PLAY_MODES } from '@shared/play'
import { generateCharacter } from '../chargen'
import type { CharacterNote, CombatState, Message } from '@shared/types'
import { chatService } from '../chat'
import { AppError } from '../errors'
import { handle, send } from '../ipc'
import { createCampaign, createCharacter, readCampaign, readCharacter, saveCharacter, saveParty } from '../library'
import { createSession, deleteMessage, forkSession, postMessage, readSession, updateFrontmatter, updateMessage } from '../sessions'
import { recapService } from '../recap'
import { suggestIdeas } from '../tips'
import { settingsStore } from '../settings-store'
import { vaultService } from '../vault/service'
import { extensionHost } from '../extensions/host'
import { getMainWindow } from '../window'

const path = z.string().min(1).max(1024)

const MessageInput = z.object({
  role: z.enum(['player', 'dm', 'roll', 'system', 'image']),
  name: z.string().optional(),
  text: z.string(),
  swipes: z.array(z.string()).optional(),
  swipeIndex: z.number().int().min(0).optional(),
  roll: z.any().optional(),
  image: z.any().optional(),
  stateChanges: z.any().optional(),
  hidden: z.boolean().optional()
})

/** Publishes an updated session to the window and refreshes the index. */
function publish<T extends { path: string }>(session: T): T {
  send(getMainWindow(), 'session:updated', session as never)
  void vaultService.reindex(session.path)
  return session
}

export function registerSessionHandlers(): void {
  // ── Sessions ──────────────────────────────────────────────────────────────
  handle('sessions:get', (_e, p) => readSession(vaultService.require(), p), z.tuple([path]))

  handle(
    'sessions:compress',
    (_e, p, force) => (force ? recapService.compress(p, { force: true }) : (recapService.onLeave(p), Promise.resolve(null))),
    z.tuple([path, z.boolean().optional()])
  )

  handle(
    'sessions:recaps',
    async (_e, p, limit) => recapService.recapsFor(await readSession(vaultService.require(), p), limit),
    z.tuple([path, z.number().int().min(1).max(20)])
  )

  handle(
    'sessions:create',
    async (_e, { campaignPath, characterPath, title, mode }) => {
      const vault = vaultService.require()
      const s = settingsStore.get()
      const character = characterPath ? await readCharacter(vault, characterPath) : null
      const playMode = mode ?? (await readCampaign(vault, campaignPath).catch(() => null))?.campaign.mode ?? s.play.defaultMode
      const session = await createSession(vault, {
        campaignPath,
        characterPath,
        characterName: character?.card.name,
        title,
        persona: character?.card.name,
        dateFormat: s.general.sessionDateFormat,
        firstMessage: character?.card.first_mes,
        mode: playMode
      })
      extensionHost.notify('onSessionStart', null, session.path)
      recapService.onSessionCreated(session)
      return publish(session)
    },
    z.tuple([z.object({ campaignPath: path, characterPath: path.optional(), title: z.string().max(200).optional(), mode: z.enum(PLAY_MODES).optional() })])
  )

  handle('sessions:fork', async (_e, p, id) => publish(await forkSession(vaultService.require(), p, id)), z.tuple([path, z.string()]))

  handle(
    'sessions:post',
    async (_e, p, input) => {
      const text = input.text
      const message: Message = {
        ...input,
        id: newMessageId(),
        swipes: input.swipes?.length ? input.swipes : [text],
        swipeIndex: input.swipeIndex ?? 0,
        createdAt: new Date().toISOString()
      }
      const session = publish(await postMessage(vaultService.require(), p, message))
      if (message.role === 'roll' && message.roll) extensionHost.diceRolled(message.roll, p)
      return session
    },
    z.tuple([path, MessageInput]) as never
  )

  handle(
    'sessions:updateMessage',
    async (_e, p, id, patch) =>
      publish(
        await updateMessage(vaultService.require(), p, id, (m) => {
          const next = { ...m }
          if (patch.swipeIndex !== undefined) {
            const i = Math.max(0, Math.min(patch.swipeIndex, m.swipes.length - 1))
            next.swipeIndex = i
            next.text = m.swipes[i] ?? m.text
          }
          if (patch.text !== undefined) {
            next.text = patch.text
            next.swipes = [...next.swipes]
            next.swipes[next.swipeIndex] = patch.text
          }
          if (patch.hidden !== undefined) next.hidden = patch.hidden || undefined
          return next
        })
      ),
    z.tuple([path, z.string(), z.object({ text: z.string().optional(), swipeIndex: z.number().int().optional(), hidden: z.boolean().optional() })])
  )

  handle('sessions:deleteMessage', async (_e, p, id) => publish(await deleteMessage(vaultService.require(), p, id)), z.tuple([path, z.string()]))

  handle(
    'sessions:saveCombat',
    async (_e, p, combat) => publish(await updateFrontmatter(vaultService.require(), p, { combat: combat ?? undefined })),
    z.tuple([path, z.any()]) as unknown as z.ZodType<[string, CombatState | null]>
  )

  handle(
    'sessions:updateMeta',
    async (_e, p, patch) => {
      const vault = vaultService.require()
      const fm: Record<string, unknown> = {}
      if (patch.title !== undefined) fm.title = patch.title.trim() || undefined
      if (patch.persona !== undefined) fm.persona = patch.persona.trim() || undefined
      if (patch.summary !== undefined) fm.summary = patch.summary.trim() || undefined
      if (patch.mode !== undefined) fm.mode = patch.mode === 'ai-dm' ? undefined : patch.mode
      if (patch.companions !== undefined) {
        const notes = await Promise.all(patch.companions.map((cp) => readCharacter(vault, cp)))
        fm.companions = notes.length ? notes.map((c) => toWikilink(c.path, { full: true, alias: c.card.name })) : undefined
      }
      if (patch.party !== undefined) {
        // The party sets the lead characters and the companions too (in turn order), so everything else keeps working.
        const link = async (cp: string): Promise<string> => {
          const c = await readCharacter(vault, cp)
          return toWikilink(c.path, { full: true, alias: c.card.name })
        }
        const groups = await Promise.all(patch.party.map(async (g) => ({ lead: await link(g.lead), companions: await Promise.all(g.companions.map(link)) })))
        fm.party = groups.length ? groups : undefined
        fm.characters = groups.map((g) => g.lead)
        fm.companions = groups.flatMap((g) => g.companions).length ? groups.flatMap((g) => g.companions) : undefined
      }
      if (patch.characterPath !== undefined) {
        if (patch.characterPath) {
          const c = await readCharacter(vault, patch.characterPath)
          fm.characters = [toWikilink(c.path, { full: true, alias: c.card.name })]
        } else fm.characters = []
      }
      return publish(await updateFrontmatter(vault, p, fm))
    },
    z.tuple([
      path,
      z.object({ title: z.string().max(200).optional(), persona: z.string().max(200).optional(), characterPath: path.nullable().optional(), summary: z.string().max(100_000).optional(), mode: z.enum(PLAY_MODES).optional(),
        companions: z.array(path).max(8).optional(),
        party: z.array(z.object({ lead: path, companions: z.array(path).max(PARTY_LIMITS.companions) })).max(PARTY_LIMITS.leads).optional()
      })
    ])
  )

  // ── Chat ──────────────────────────────────────────────────────────────────
  handle(
    'chat:send',
    (_e, { sessionPath, text, persona, speaker, as }) => chatService.send(sessionPath, text, persona, speaker, as),
    z.tuple([z.object({ sessionPath: path, text: z.string().max(200_000), persona: z.string().max(200).optional(), speaker: z.enum(['dm', 'player']).optional(), as: z.string().max(1000).optional() })])
  )
  handle('chat:regenerate', (_e, { sessionPath }) => chatService.regenerate(sessionPath), z.tuple([z.object({ sessionPath: path })]))
  handle('chat:continue', (_e, { sessionPath }) => chatService.continue(sessionPath), z.tuple([z.object({ sessionPath: path })]))
  handle('chat:stop', (_e, requestId) => chatService.stop(requestId), z.tuple([z.string()]))
  handle('chat:ideas', (_e, p) => suggestIdeas(p), z.tuple([path]))
  handle(
    'chat:inspectPrompt',
    (_e, { sessionPath, speaker, as }) => chatService.inspect(sessionPath, { speaker, as }),
    z.tuple([z.object({ sessionPath: path, speaker: z.enum(['dm', 'player']).optional(), as: path.optional() })])
  )

  // ── Characters & campaigns (basics; import/export live in characters.ts) ─
  handle('characters:get', (_e, p) => readCharacter(vaultService.require(), p), z.tuple([path]))
  handle(
    'characters:save',
    async (_e, note, force) => {
      const saved = await saveCharacter(vaultService.require(), { ...note, card: normalizeCard(note.card as never, note.card.name) }, force === true)
      void vaultService.reindex(saved.path)
      return saved
    },
    z.tuple([z.object({ path, card: z.record(z.string(), z.unknown()), body: z.string(), mtimeMs: z.number(), hash: z.string() }), z.boolean().optional()]) as unknown as z.ZodType<[CharacterNote, boolean?]>
  )
  handle(
    'characters:create',
    async (_e, name, npc) => {
      const note = await createCharacter(vaultService.require(), name, npc)
      await vaultService.reindex(note.path)
      return note
    },
    z.tuple([z.string().min(1).max(120), z.boolean().optional()])
  )

  handle(
    'characters:generate',
    (_e, opts) => generateCharacter(opts),
    z.tuple([
      z.object({
        concept: z.string().max(2000),
        level: z.number().int().min(1).max(20),
        race: z.string().max(80).optional(),
        cls: z.string().max(120).optional(),
        campaignPath: path.optional(),
        edition: z.enum(['5e', '3.5e']).optional(),
        npc: z.boolean().optional()
      })
    ])
  )

  handle('campaigns:get', (_e, p) => readCampaign(vaultService.require(), p), z.tuple([path]))
  handle(
    'campaigns:create',
    async (_e, name) => {
      const vault = vaultService.require()
      const campaign = await createCampaign(vault, name)
      await vaultService.reindex(`${campaign.path}/Campaign.md`)
      return campaign
    },
    z.tuple([z.string().min(1).max(120)])
  )
  handle('campaigns:saveParty', (_e, p, party) => saveParty(vaultService.require(), p, party), z.tuple([path, z.any()]) as never)
}

/** Pushes sessions edited outside the app (e.g. in Obsidian) to the window. */
export function watchExternalSessionEdits(): void {
  vaultService.on('change', ({ path: p, kind, event }) => {
    if (kind !== 'session' || event === 'unlink') return
    const vault = vaultService.vault
    if (!vault) return
    readSession(vault, p)
      .then((s) => send(getMainWindow(), 'session:updated', s))
      .catch((err) => {
        if (!(err instanceof AppError)) console.warn('[sessions] could not re-read', p, err)
      })
  })
}
