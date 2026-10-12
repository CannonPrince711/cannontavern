/**
 * The shared Resources folder: lorebooks and images every campaign can use.
 * Lorebooks in Resources/Lore join each world's lore (keyword-triggered like
 * any lorebook) unless the world turns them off; images in Resources/Images
 * are offered in every campaign's map image chooser.
 *
 * Starter content is written once per vault (a hidden marker remembers it),
 * so deleting the folder or its notes sticks. Existing notes are never
 * overwritten.
 */
import { RESOURCE_FOLDERS, RESOURCES_MARKER } from '@shared/layout'
import { serializeLorebookBody } from '@shared/notes'
import type { LoreEntry, VaultPath } from '@shared/types'
import { serializeNote } from './vault/frontmatter'
import type { Vault } from './vault/vault'

const entry = (title: string, keys: string[], content: string, priority = 0): LoreEntry => ({ title, keys, content, always_on: false, priority, enabled: true })

const STARTER: { file: string; name: string; intro: string; entries: LoreEntry[] }[] = [
  {
    file: 'Gear and Prices.md',
    name: 'Gear and Prices',
    intro: 'Common adventuring gear and typical prices, shared by every campaign. Change prices to suit your world.',
    entries: [
      entry('Healing potion', ['healing potion', 'potion of healing', 'potion'], 'A small vial of shimmering red liquid. Drinking it restores 2d4 + 2 hit points. Sold by temples and alchemists for about 50 gp; rarer, stronger brews cost far more.', 3),
      entry('Rope', ['rope', 'hempen rope', 'silk rope'], '50 feet of hempen rope costs 1 gp; silk rope is lighter and costs 10 gp. Climbing a knotted rope is easy; a smooth one may need an Athletics check.'),
      entry('Torches and lanterns', ['torch', 'torches', 'lantern', 'oil'], 'A torch burns for an hour, lighting 20 feet clearly (1 cp). A hooded lantern burns a flask of oil for six hours (5 gp, oil 1 sp a flask). Light gives away your position in the dark.'),
      entry('Rations and camping', ['rations', 'food', 'bedroll', 'tent', 'camp', 'camping'], 'Trail rations cost 5 sp a day. A bedroll is 1 gp and a two-person tent 2 gp. Travellers without food or shelter grow tired and hungry quickly.'),
      entry('Thieves’ tools', ['thieves tools', "thieves' tools", 'lockpick', 'lock picks', 'picks'], 'A set of picks and files for opening locks and disarming traps (25 gp). Using them without proficiency is hard; guards treat them as proof of bad intentions.'),
      entry('Weapons and armour', ['sword', 'longsword', 'dagger', 'bow', 'crossbow', 'armour', 'armor', 'shield', 'chain mail'], 'Typical prices: dagger 2 gp, shortsword 10 gp, longsword 15 gp, shortbow 25 gp, light crossbow 25 gp, shield 10 gp, leather armour 10 gp, chain mail 75 gp, plate armour 1,500 gp. Fine or magical gear costs far more and is rarely for sale.'),
      entry('Mounts and travel', ['horse', 'pony', 'mule', 'mount', 'cart', 'wagon', 'carriage', 'ship passage'], 'A riding horse costs 75 gp, a pony 30 gp, a mule 8 gp; stabling is 5 sp a night. A seat on a coach is about 3 cp a mile, passage on a ship about 1 sp a mile.'),
      entry('Healer’s kit', ["healer's kit", 'healers kit', 'bandages', 'medicine'], 'Bandages, salves and splints (5 gp, ten uses). Stabilises a dying creature without a check.'),
      entry('Coins', ['gold', 'silver', 'copper', 'platinum', 'coins', 'gp', 'sp', 'cp'], '10 copper = 1 silver, 10 silver = 1 gold, 10 gold = 1 platinum. A labourer earns about 2 sp a day; a skilled artisan about 2 gp.')
    ]
  },
  {
    file: 'Creatures.md',
    name: 'Creatures',
    intro: 'Common foes and beasts with rough difficulty, for any campaign. Adjust numbers to the party.',
    entries: [
      entry('Goblins', ['goblin', 'goblins'], 'Small, cunning raiders who fight in packs, set traps and flee when outmatched. Easy one-on-one (about CR 1/4); dangerous in an ambush. Often serve a stronger bugbear or hobgoblin.', 2),
      entry('Kobolds', ['kobold', 'kobolds'], 'Small reptilian tunnellers who rely on traps, numbers and sling volleys. Cowardly alone, brave in a crowd (CR 1/8). Many revere a dragon.'),
      entry('Orcs', ['orc', 'orcs'], 'Strong, aggressive raiders who charge headlong with greataxes (CR 1/2). A war chief makes a warband far more dangerous.'),
      entry('Bandits', ['bandit', 'bandits', 'highwayman', 'brigand', 'thug', 'thugs'], 'Desperate folk who rob travellers (CR 1/8), led by a tougher captain (CR 2). They prefer surrender and ransom to a fight to the death.'),
      entry('Wolves', ['wolf', 'wolves', 'dire wolf', 'warg'], 'Pack hunters that try to knock prey prone and surround it (CR 1/4). Dire wolves and wargs are bigger and smarter (CR 1).'),
      entry('Skeletons and zombies', ['skeleton', 'skeletons', 'zombie', 'zombies', 'undead', 'ghoul'], 'Mindless undead raised by necromancy. Skeletons are brittle against bludgeoning; zombies are slow but keep getting up. Ghouls paralyse with their claws. Radiant damage and holy water hurt them all.'),
      entry('Giant rats and spiders', ['rat', 'rats', 'giant rat', 'spider', 'giant spider', 'swarm'], 'Vermin of sewers and ruins. Giant rats attack in packs and carry disease; giant spiders web, climb walls and poison (CR 1).'),
      entry('Ogres and trolls', ['ogre', 'ogres', 'troll', 'trolls'], 'Huge brutes. Ogres are dim and greedy (CR 2); trolls regenerate unless burned with fire or acid (CR 5).'),
      entry('Owlbear', ['owlbear', 'owlbears'], 'A ferocious beast with an owl’s head and a bear’s body. Territorial, always hungry, and too angry to flee (CR 3).'),
      entry('Dragons', ['dragon', 'dragons', 'wyrm', 'wyrmling', 'drake'], 'Ancient, intelligent and proud. Even a young dragon can destroy an unprepared party; older ones rule regions and hoard treasure. Most can be bargained with, at a price.', 4)
    ]
  },
  {
    file: 'Settlements and Services.md',
    name: 'Settlements and Services',
    intro: 'Inns, taverns and the services towns offer, for any campaign.',
    entries: [
      entry('Inns and lodging', ['inn', 'room', 'lodging', 'bed', 'stay the night'], 'A squalid common room costs 7 cp a night, a modest private room 5 sp, a comfortable one 8 sp, a wealthy suite 2 gp. Prices include a simple breakfast.'),
      entry('Taverns', ['tavern', 'ale', 'mead', 'wine', 'drink', 'drinks', 'meal'], 'A mug of ale is 4 cp, a bottle of common wine 2 sp, a hot meal 3 sp. Taverns are where rumours, job offers and trouble are found.'),
      entry('Temples and healing', ['temple', 'priest', 'cleric', 'healing', 'cure', 'resurrection'], 'Temples heal wounds and illnesses for a donation (a few gold), and cast greater magic for powerful patrons or worthy causes. Raising the dead is rare, costly and never guaranteed.'),
      entry('Smiths and repairs', ['smith', 'blacksmith', 'forge', 'repair', 'armourer', 'armorer'], 'A blacksmith repairs armour and weapons for about a tenth of their price, and makes common gear in days. Masterwork pieces take weeks.'),
      entry('Hirelings', ['hireling', 'hire', 'mercenary', 'mercenaries', 'guide', 'porter'], 'An unskilled porter or labourer costs 2 sp a day, a skilled guide or craftsperson 2 gp a day, a sellsword 1 gp a day plus a share of loot.'),
      entry('Guards and law', ['guard', 'guards', 'watch', 'city watch', 'law', 'jail', 'fine', 'bribe'], 'Most towns have a watch that keeps the peace, collects gate taxes and breaks up brawls. Small crimes earn fines; a well-placed bribe smooths many problems, unless the captain is honest.')
    ]
  },
  {
    file: 'Townsfolk.md',
    name: 'Townsfolk',
    intro: 'Generic people the DM can bring in anywhere. Give each a name and a want when they appear.',
    entries: [
      entry('Innkeeper', ['innkeeper', 'barkeep', 'bartender', 'landlord', 'landlady'], 'Knows every rumour in town and who to ask about anything. Wants paying customers and no broken furniture.'),
      entry('Merchant', ['merchant', 'trader', 'shopkeeper', 'peddler', 'vendor'], 'Haggles hard, remembers favours, and always has “a special item, only for you”. Wants profit and safe roads.'),
      entry('Town guard', ['guard', 'watchman', 'sentry'], 'Underpaid and bored, suspicious of armed strangers. Wants a quiet shift; can be persuaded, bribed or intimidated.'),
      entry('Village elder', ['elder', 'mayor', 'headman', 'reeve'], 'Speaks for the community and worries about everyone. Wants the trouble gone and the outsiders paid as little as possible.'),
      entry('Street urchin', ['urchin', 'orphan', 'street kid', 'pickpocket'], 'Quick, cheeky and always watching. Will trade information for coin or food, and knows the back alleys.'),
      entry('Noble', ['noble', 'lord', 'lady', 'baron', 'baroness', 'count', 'duke'], 'Proud, well guarded and politically entangled. Wants status and favours; pays well for discretion.')
    ]
  }
]

const ABOUT = `
# Resources

Shared material every campaign can use.

- **Lore/**: lorebooks every world sees. Their entries reach the DM when a trigger word comes up, like any lorebook. A world can turn them off in its campaign settings, on the **This world** tab.
- **Images/**: generic portraits, maps and battlemaps. They are offered in every campaign's map image chooser.

DND Tavern wrote the starter lorebooks once. Edit them, add your own, or delete what you don't need: they won't come back.
`

async function writeIfMissing(vault: Vault, path: VaultPath, content: string): Promise<void> {
  if (!(await vault.exists(path))) await vault.write(path, content, { baseHash: null })
}

/** Writes the starter Resources folder (missing pieces only). */
export async function createResources(vault: Vault): Promise<void> {
  for (const folder of Object.values(RESOURCE_FOLDERS)) await vault.mkdir(vault.rootPath(folder))
  for (const sub of ['Portraits', 'Maps', 'Battlemaps']) await vault.mkdir(vault.rootPath(RESOURCE_FOLDERS.images, sub))
  await writeIfMissing(vault, vault.rootPath(RESOURCE_FOLDERS.root, 'About Resources.md'), ABOUT)
  for (const book of STARTER) {
    await writeIfMissing(vault, vault.rootPath(RESOURCE_FOLDERS.lore, book.file), serializeNote({ type: 'lorebook', name: book.name }, serializeLorebookBody(book.intro, book.entries)))
  }
  await vault.write(vault.rootPath(RESOURCES_MARKER), 'Remembers that DND Tavern already set up the Resources folder in this vault.\n', { baseHash: null }).catch(() => {})
}

/** First time a vault is opened with this version: set up Resources. Later opens leave it alone. */
export async function ensureResources(vault: Vault): Promise<void> {
  if (await vault.exists(vault.rootPath(RESOURCES_MARKER))) return
  await createResources(vault)
}

/** Generic images under Resources/Images, for every campaign's image choosers. */
export async function resourceImages(vault: Vault, isImage: (name: string) => boolean): Promise<VaultPath[]> {
  return vault.walk(vault.rootPath(RESOURCE_FOLDERS.images), (p) => isImage(p), 2000).catch(() => [])
}
