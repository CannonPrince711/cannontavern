/**
 * "The Sunken Lantern": a ready-to-play sample campaign written into the vault
 * after the first-run wizard. Existing notes are never overwritten.
 */
import { newMessageId, serializeMessage } from '@shared/callouts'
import { CAMPAIGN_FILE, FOLDERS, IMAGES_FOLDER, PARTY_FILE, SESSIONS_FOLDER } from '@shared/layout'
import { formatDate, joinVaultPath, toWikilink } from '@shared/names'
import { serializeLorebookBody } from '@shared/notes'
import { DEFAULT_DM_PROMPT } from '@shared/prompt'
import type { VaultPath } from '@shared/types'
import { serializeNote } from './vault/frontmatter'
import type { Vault } from './vault/vault'

const NAME = 'The Sunken Lantern'

const OPENING = `The ferry's bell clangs twice as the fog parts, and **Saltmere** rises out of the grey: crooked houses on stilts, nets drying like cobwebs, and a hundred lanterns that should be lit but aren't. Only one burns, a green-glass lantern held by a hooded woman at the end of the pier.

"You're the one who answered the letter," she says as you step onto the slick boards. Her voice is calm, but her knuckles are white around the lantern. "Good. Then you already know the Drowned Bell rang last night."

Beneath the black water, so faint you might have imagined it, something tolls once.

What do you do?`

async function writeIfMissing(vault: Vault, path: VaultPath, content: string): Promise<boolean> {
  if (await vault.exists(path)) return false
  await vault.write(path, content, { baseHash: null })
  return true
}

export async function createSampleCampaign(vault: Vault, dateFormat: string): Promise<{ campaignPath: VaultPath; sessionPath: VaultPath; characterPath: VaultPath }> {
  const campaignPath = vault.rootPath(FOLDERS.campaigns, NAME)
  const lorePath = vault.rootPath(FOLDERS.lorebooks, 'Sunken Lantern Lore.md')
  const characterPath = vault.rootPath(FOLDERS.characters, 'Kestrel Vane.md')
  await vault.mkdir(joinVaultPath(campaignPath, SESSIONS_FOLDER))
  await vault.mkdir(joinVaultPath(campaignPath, IMAGES_FOLDER))

  await writeIfMissing(
    vault,
    lorePath,
    serializeNote(
      { type: 'lorebook', name: 'Sunken Lantern Lore' },
      serializeLorebookBody('World notes for The Sunken Lantern. Each “## Heading” is an entry; the DM sees it when a trigger word comes up.', [
        { title: 'Saltmere', keys: ['saltmere', 'town', 'harbour', 'harbor'], content: 'A fog-bound fishing town built on stilts over the drowned ruins of Old Saltmere. Its lantern-keepers once kept the harbour lit all night; now most lanterns stay dark. Locals are superstitious, polite to strangers, and quick to lock their doors at dusk.', always_on: false, priority: 5, enabled: true },
        { title: 'The Drowned Bell', keys: ['bell', 'drowned bell', 'toll', 'tolls'], content: 'The great bell of the Temple of the Tide, which sank with Old Saltmere eighty years ago. Folk say that when it rings, someone drowns within the week. It has rung three times this month.', always_on: false, priority: 10, enabled: true },
        { title: 'Mother Ysolde', keys: ['ysolde', 'hooded woman', 'mother'], content: 'The last lantern-keeper, a scarred woman in her sixties who carries a green-glass lantern that never goes out. She wrote the letter. She knows the bell is being rung on purpose, by someone inside the drowned temple, and she suspects the harbourmaster.', always_on: false, priority: 8, enabled: true },
        { title: 'The Lantern Keepers', keys: ['lantern keeper', 'lantern-keeper', 'keepers', 'lanterns'], content: 'An old order that kept Saltmere’s lanterns lit to guide boats and ward off what lives under the water. Disbanded after “the Quiet Year”. Their lighthouse vault still holds charts of the drowned streets.', always_on: false, priority: 4, enabled: true },
        { title: 'Tides of Saltmere', keys: [], content: 'The tide turns every six hours. At low tide the roofs of Old Saltmere break the surface and the temple spire can be reached by boat; at high tide the lower town floods.', always_on: true, priority: 0, enabled: true }
      ])
    )
  )

  await writeIfMissing(
    vault,
    joinVaultPath(campaignPath, CAMPAIGN_FILE),
    serializeNote(
      {
        type: 'campaign',
        name: NAME,
        setting: 'Saltmere, a fog-bound fishing town on stilts above a drowned city, in a low-magic coastal realm.',
        tone: 'Eerie, melancholy coastal horror with moments of warmth and humour. Mysteries over big battles.',
        house_rules: 'Milestone levelling. Healing potions take a bonus action. Critical hits roll double dice.',
        lorebooks: [toWikilink(lorePath, { full: true })]
      },
      `\n# ${NAME}\n\nA beginner-friendly mystery for one player character, levels 1–3.\n\n## The hook\nMother Ysolde, the last lantern-keeper of Saltmere, has sent a letter asking for help: the Drowned Bell has started ringing again.\n\n## Secrets (for the DM)\n- The harbourmaster, **Corwin Hale**, rings the bell from a diving bell beneath the harbour to scare families into selling their stilt-houses cheaply.\n- Something older answered the bell. It has started taking the people who hear it.\n\nEdit this note in Obsidian; DND Tavern sends it to the DM with every prompt.\n`
    )
  )

  await writeIfMissing(
    vault,
    joinVaultPath(campaignPath, PARTY_FILE),
    serializeNote(
      {
        type: 'party',
        gold: 25,
        inventory: [{ name: 'Rowboat (borrowed)', qty: 1 }, { name: 'Map of the harbour', qty: 1 }],
        quests: [
          { title: 'Find out who is ringing the Drowned Bell', status: 'active' },
          { title: 'Relight the lantern at the end of the north pier', status: 'active' }
        ]
      },
      `\n# Party\n\nShared notes, loot and leads.\n`
    )
  )

  await writeIfMissing(
    vault,
    characterPath,
    serializeNote(
      {
        type: 'character',
        name: 'Kestrel Vane',
        description: '{{char}} is a half-elf rogue in their late twenties: quick hands, a salt-stained grey coat, and an old sailor’s knife. Raised on smugglers’ boats, they know tides, knots and how to disappear in a crowd.',
        personality: 'Wry, curious, loyal to people rather than causes. Hates being cold. Can’t resist a locked door.',
        scenario: 'Kestrel has come to Saltmere because Mother Ysolde once pulled them out of the sea, and the letter called in that debt.',
        first_mes: OPENING,
        mes_example: '',
        system_prompt: '',
        tags: ['sample', 'rogue'],
        dnd: {
          race: 'Half-elf',
          class: 'Rogue',
          level: 2,
          xp: 450,
          hp: 15,
          max_hp: 15,
          temp_hp: 0,
          ac: 14,
          speed: 30,
          str: 10,
          dex: 17,
          con: 13,
          int: 12,
          wis: 12,
          cha: 14,
          proficiency_bonus: 2,
          skills: ['stealth', 'sleight of hand', 'perception', 'acrobatics', 'deception'],
          saves: ['dex', 'int'],
          inventory: [
            { name: 'Shortsword', qty: 1, equipped: true },
            { name: 'Shortbow', qty: 1 },
            { name: 'Arrows', qty: 20 },
            { name: "Thieves' tools", qty: 1 },
            { name: 'Leather armour', qty: 1, equipped: true },
            { name: 'Lantern', qty: 1 },
            { name: 'Rope (50 ft)', qty: 1 }
          ],
          gold: 12,
          spells: [],
          spell_slots: {},
          conditions: [],
          hit_dice: { die: 8, max: 2, used: 0 }
        }
      },
      `\n# Kestrel Vane\n\nThe sample character. Change anything on the Sheet tab or right here in Obsidian.\n`
    )
  )

  await writeIfMissing(
    vault,
    vault.rootPath(FOLDERS.npcs, 'Mother Ysolde.md'),
    serializeNote(
      { type: 'npc', name: 'Mother Ysolde', description: 'The last lantern-keeper of Saltmere. Scarred, patient, carries a green-glass lantern that never goes out.', personality: 'Calm, stubborn, carries old guilt.', tags: ['npc', 'saltmere'] },
      `\n# Mother Ysolde\n\n- **Wants:** to silence the bell before anyone else drowns.\n- **Secret:** she was on duty the night Old Saltmere sank.\n`
    )
  )

  await writeIfMissing(vault, vault.rootPath(FOLDERS.presets, 'Classic DM.md'), serializeNote({ type: 'preset', name: 'Classic DM', dm_mode: true }, `\n${DEFAULT_DM_PROMPT}\n`))

  // The first session, opening with the DM's scene.
  const sessionsDir = joinVaultPath(campaignPath, SESSIONS_FOLDER)
  const existing = (await vault.list(sessionsDir)).find((e) => e.name.endsWith('.md'))
  if (existing) return { campaignPath, sessionPath: existing.path, characterPath }
  const now = new Date().toISOString()
  const sessionPath = joinVaultPath(sessionsDir, `${formatDate(new Date(), dateFormat || 'YYYY-MM-DD')} Session 01.md`)
  const body = `${serializeMessage({ id: newMessageId(), role: 'dm', text: OPENING, swipes: [OPENING], swipeIndex: 0, createdAt: now })}\n`
  await vault.write(
    sessionPath,
    serializeNote(
      {
        type: 'session',
        id: `s-sample-${Date.now().toString(36)}`,
        title: 'Session 01',
        campaign: toWikilink(joinVaultPath(campaignPath, CAMPAIGN_FILE), { full: true, alias: NAME }),
        characters: [toWikilink(characterPath, { full: true, alias: 'Kestrel Vane' })],
        persona: 'Kestrel Vane',
        created: now,
        updated: now,
        tags: ['dnd-session']
      },
      `\n${body}`
    ),
    { baseHash: null }
  )
  return { campaignPath, sessionPath, characterPath }
}
