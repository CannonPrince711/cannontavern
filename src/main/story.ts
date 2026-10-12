/**
 * Applies the DM's story tags (shared/bonds.ts): relationship turns go into
 * the campaign's Party.md, each turn or big event gets a short note in the
 * chat, and events that change how someone looks (and becoming lovers,
 * engaged or married) paint a new portrait that becomes their picture. The
 * old portrait stays in their portrait history.
 */
import { BOND_PORTRAIT_LOOK, bondIcon, setBond, type Bond, type Milestone } from '@shared/bonds'
import { newMessageId } from '@shared/callouts'
import type { VaultPath } from '@shared/types'
import { chatService } from './chat'
import { toErrorInfo } from './errors'
import { imageService } from './images'
import { send } from './ipc'
import { forCampaign } from '@shared/membership'
import { readCampaign, saveParty } from './library'
import { postMessage, readSession } from './sessions'
import { vaultService } from './vault/service'
import { getMainWindow } from './window'
import { settingsForSession } from './world'

/** A character or NPC note by name: the full name, else the first name. */
function findCharacter(name: string, campaignPath: VaultPath): VaultPath | null {
  const index = vaultService.getIndex()
  if (!index) return null
  // A character copied into several campaigns: this campaign's copy.
  const all = [...forCampaign(index.characters, campaignPath), ...index.npcs]
  const want = name.trim().toLowerCase()
  const full = all.find((c) => c.displayName.trim().toLowerCase() === want)
  if (full) return full.path
  const first = all.filter((c) => c.displayName.trim().toLowerCase().split(/\s+/).includes(want.split(/\s+/)[0]!))
  return first.length === 1 ? first[0]!.path : null
}

export async function applyStory(sessionPath: VaultPath, story: { bonds: Bond[]; milestones: Milestone[] }): Promise<void> {
  const vault = vaultService.require()
  const session = await readSession(vault, sessionPath)
  const s = settingsForSession(sessionPath)
  const notes: string[] = []
  const repaint: { who: string; event: string; look: string }[] = []

  if (story.bonds.length) {
    const { party } = await readCampaign(vault, session.campaignPath)
    let bonds = party.bonds ?? []
    for (const b of story.bonds) {
      const r = setBond(bonds, { ...b, since: session.frontmatter.title })
      if (!r.changed) continue
      bonds = r.bonds
      notes.push(`${bondIcon(b.status)} ${b.a} & ${b.b} are now ${b.status}${r.previous ? ` (were ${r.previous})` : ''}.`)
      const look = BOND_PORTRAIT_LOOK[b.status]
      if (look) {
        repaint.push({ who: b.a, event: `became ${b.status} with ${b.b}`, look })
        repaint.push({ who: b.b, event: `became ${b.status} with ${b.a}`, look })
      }
    }
    if (bonds !== party.bonds) await saveParty(vault, session.campaignPath, { ...party, bonds })
  }
  for (const m of story.milestones) {
    notes.push(`✨ ${m.who}: ${m.event}`)
    if (m.look) repaint.push({ who: m.who, event: m.event, look: m.look })
  }

  if (notes.length) {
    const updated = await postMessage(vault, sessionPath, {
      id: newMessageId(),
      role: 'system',
      name: 'Story',
      text: notes.join('\n'),
      swipes: [notes.join('\n')],
      swipeIndex: 0,
      createdAt: new Date().toISOString()
    })
    send(getMainWindow(), 'session:updated', updated)
  }

  // New portraits for big events, one per character (the last event wins).
  if (!s.imageTriggers.milestonePortraits || !s.imageBackends.length) return
  const byPath = new Map<VaultPath, { event: string; look: string }>()
  for (const r of repaint) {
    const path = findCharacter(r.who, session.campaignPath)
    if (path) byPath.set(path, { event: r.event, look: r.look })
  }
  for (const [characterPath, r] of byPath) {
    const { requestId } = imageService.generate({ kind: 'portrait', sessionPath, characterPath, prompt: r.look, setAvatar: true, event: r.event })
    send(getMainWindow(), 'images:progress', { requestId, value: 0, label: `New portrait: ${r.event}` })
  }
}

chatService.onStory = (sessionPath, story) => {
  void applyStory(sessionPath, story).catch((err) => console.warn('[story] could not apply story tags:', toErrorInfo(err).message))
}
