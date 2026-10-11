import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCampaign, createCharacter, readCampaign, readCharacter, saveCharacter } from '../src/main/library'
import { createSession, deleteMessage, forkSession, postMessage, readSession, updateFrontmatter, updateMessage } from '../src/main/sessions'
import { parseNote } from '../src/main/vault/frontmatter'
import { Vault, VaultConflictError } from '../src/main/vault/vault'
import type { Message } from '@shared/types'

let dir: string
let vault: Vault

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dnd-sessions-'))
  vault = new Vault({ vaultPath: dir, rootFolder: 'DND Tavern' })
})
afterEach(() => rm(dir, { recursive: true, force: true }))

const msg = (id: string, role: Message['role'], text: string): Message => ({ id, role, text, swipes: [text], swipeIndex: 0, createdAt: '' })

describe('campaigns and characters', () => {
  it('creates a campaign folder with Campaign.md, Party.md, Sessions/ and Images/', async () => {
    const c = await createCampaign(vault, 'The Sunken Lantern', { setting: 'A drowned city' })
    expect(c.path).toBe('DND Tavern/Campaigns/The Sunken Lantern')
    const { campaign, party } = await readCampaign(vault, c.path)
    expect(campaign).toMatchObject({ name: 'The Sunken Lantern', setting: 'A drowned city' })
    expect(party.gold).toBe(0)
    expect(await vault.exists(`${c.path}/Images`)).toBe(true)
    await expect(createCampaign(vault, 'The Sunken Lantern')).rejects.toThrow(/already exists/)
  })

  it('creates and saves characters, keeping keys added in Obsidian', async () => {
    const note = await createCharacter(vault, 'Aria: the Grey?')
    expect(note.path).toBe('DND Tavern/Characters/Aria the Grey.md')
    // The user adds an alias and a comment in Obsidian.
    const abs = vault.resolve(note.path)
    const raw = await readFile(abs, 'utf8')
    await writeFile(abs, raw.replace('---\n', '---\naliases: [Grey]\n'))
    const fresh = await readCharacter(vault, note.path)
    const saved = await saveCharacter(vault, { ...fresh, card: { ...fresh.card, personality: 'Quiet', dnd: { ...(await import('@shared/notes')).defaultSheet(), hp: 7 } } })
    expect(saved.card.personality).toBe('Quiet')
    expect(saved.card.dnd?.hp).toBe(7)
    expect(parseNote(await readFile(abs, 'utf8')).data.aliases).toEqual(['Grey'])
  })

  it('refuses a stale character save', async () => {
    const note = await createCharacter(vault, 'Bob')
    await writeFile(vault.resolve(note.path), (await readFile(vault.resolve(note.path), 'utf8')).replace('name: Bob', 'name: Bobby'))
    await expect(saveCharacter(vault, { ...note, body: 'new' })).rejects.toBeInstanceOf(VaultConflictError)
  })
})

describe('session notes', () => {
  async function setup(): Promise<string> {
    const c = await createCampaign(vault, 'Lantern')
    const s = await createSession(vault, { campaignPath: c.path, dateFormat: 'YYYY-MM-DD', firstMessage: 'The fog rolls in.', persona: 'Aria' })
    return s.path
  }

  it('creates a numbered session with wikilinks and the greeting', async () => {
    const path = await setup()
    expect(path).toMatch(/^DND Tavern\/Campaigns\/Lantern\/Sessions\/\d{4}-\d{2}-\d{2} Session 01\.md$/)
    const s = await readSession(vault, path)
    expect(s.frontmatter.campaign).toBe('[[DND Tavern/Campaigns/Lantern/Campaign|Lantern]]')
    expect(s.campaignPath).toBe('DND Tavern/Campaigns/Lantern')
    expect(s.messages.map((m) => [m.role, m.text])).toEqual([['dm', 'The fog rolls in.']])
  })

  it('posts, edits, swipes and deletes messages', async () => {
    const path = await setup()
    await postMessage(vault, path, msg('p1', 'player', 'I light a lantern.'))
    let s = await postMessage(vault, path, msg('d1', 'dm', 'Shadows flee.'))
    expect(s.messages.map((m) => m.id)).toContain('d1')

    s = await updateMessage(vault, path, 'd1', (m) => ({ ...m, text: 'Take two.', swipes: [...m.swipes, 'Take two.'], swipeIndex: 1 }))
    const d1 = s.messages.find((m) => m.id === 'd1')!
    expect(d1).toMatchObject({ text: 'Take two.', swipes: ['Shadows flee.', 'Take two.'], swipeIndex: 1 })
    expect(s.frontmatter.swipes?.d1).toEqual(['Shadows flee.', 'Take two.'])

    s = await deleteMessage(vault, path, 'd1')
    expect(s.messages.map((m) => m.id)).not.toContain('d1')
    expect(s.frontmatter.swipes).toBeUndefined()
  })

  it('merges with edits made in Obsidian between app writes', async () => {
    const path = await setup()
    await postMessage(vault, path, msg('p1', 'player', 'Hello.'))
    // The user adds a heading and fixes a typo in Obsidian.
    const abs = vault.resolve(path)
    const raw = await readFile(abs, 'utf8')
    await writeFile(abs, raw.replace('> Hello.', '> Hello there.') + '\n## Notes\nRemember the bell.\n')
    const s = await postMessage(vault, path, msg('d2', 'dm', 'A bell answers.'))
    const text = await readFile(abs, 'utf8')
    expect(text).toContain('## Notes\nRemember the bell.')
    expect(s.messages.find((m) => m.id === 'p1')!.text).toBe('Hello there.')
    expect(s.messages[s.messages.length - 1]!.id).toBe('d2')
  })

  it('stores combat and summary in the frontmatter', async () => {
    const path = await setup()
    const combat = { active: true, round: 1, turn: 0, combatants: [] }
    const s = await updateFrontmatter(vault, path, { combat, summary: 'They arrived.' })
    expect(s.frontmatter.combat).toEqual(combat)
    expect(s.frontmatter.summary).toBe('They arrived.')
  })

  it('forks a session at a message', async () => {
    const path = await setup()
    await postMessage(vault, path, msg('p1', 'player', 'One.'))
    await postMessage(vault, path, msg('d1', 'dm', 'Two.'))
    await postMessage(vault, path, msg('p2', 'player', 'Three.'))
    const fork = await forkSession(vault, path, 'd1')
    expect(fork.path).toMatch(/Session 01 \(fork\)\.md$/)
    expect(fork.messages.map((m) => m.text)).toEqual(['The fog rolls in.', 'One.', 'Two.'])
    expect(fork.frontmatter.title).toBe('Session 01 (fork)')
    expect((await readSession(vault, path)).messages).toHaveLength(4)
  })

  it('numbers the next session after existing ones', async () => {
    const c = await createCampaign(vault, 'Two')
    await createSession(vault, { campaignPath: c.path, dateFormat: 'YYYY-MM-DD' })
    await mkdir(join(dir, 'DND Tavern', 'Campaigns', 'Two', 'Sessions'), { recursive: true })
    const second = await createSession(vault, { campaignPath: c.path, dateFormat: 'YYYY-MM-DD' })
    expect(second.frontmatter.title).toBe('Session 02')
  })
})
