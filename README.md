# DND Tavern

A desktop app for Windows and Linux for playing Dungeons & Dragons with an AI Dungeon Master, in the style of SillyTavern.

Everything it creates is stored as plain Markdown and image files in an **Obsidian vault**: characters, sheets, lorebooks, campaigns, session logs and illustrations. You can read and edit the same notes in Obsidian while you play, and DND Tavern picks up your edits live.

- **Any text model.** OpenAI-compatible servers (OpenRouter, LM Studio, llama.cpp, vLLM, Groq and others), Anthropic Claude, Ollama, KoboldCpp, text-generation-webui, or any HTTP API through a body template. Local, LAN or remote, with an optional fallback chain.
- **Any image backend.** ComfyUI with your own workflows (fully supported, including remote servers behind a proxy), Automatic1111/Forge, OpenAI images, or a custom API.
- **D&D 5e and 3.5e.** A dice engine with 3D dice, checks and saves, character sheets for both editions (3.5 with skill ranks, base attack and Fort/Ref/Will), allowed sourcebooks per campaign, initiative and combat tracking, and optional automatic sheet updates from the story.
- **Who plays.** The AI as DM, you as DM with the AI playing the character, or the AI on both sides while you watch and steer.
- **Multiplayer.** Host a table: friends join from any browser with a link and code, claim a character and play. A read-only player screen for a second monitor or TV, and a DM screen with private rolls and quick reference.
- **Campaigns.** An AI campaign builder, campaign maps with pins and a game-style mini-map, and an Obsidian-style graph of your notes.
- **Memory.** Lorebooks with keyword triggers, a rolling in-session summary, and automatic session recaps, so each new session starts knowing what happened before.
- **Extensions.** Small JavaScript add-ons that run sandboxed and add commands, prompt context, panels and hooks.

## Contents

- [Install](#install)
- [First run](#first-run)
- [Your vault](#your-vault)
- [Playing](#playing)
- [Who plays: AI DM, you as DM, or AI only](#who-plays-ai-dm-you-as-dm-or-ai-only)
- [Campaigns, editions and sourcebooks](#campaigns-editions-and-sourcebooks)
- [Maps and the graph view](#maps-and-the-graph-view)
- [Multiplayer](#multiplayer)
- [Text backends](#text-backends)
- [Image backends and ComfyUI](#image-backends-and-comfyui)
- [Memory: summaries and session recaps](#memory-summaries-and-session-recaps)
- [Settings, keys and privacy](#settings-keys-and-privacy)
- [Updates](#updates)
- [Writing extensions](#writing-extensions)
- [Development](#development)
- [Building the installer](#building-the-installer)
- [Troubleshooting](#troubleshooting)

## Install

Download one of these from the Releases page:

| File | Use it when |
| --- | --- |
| `DND Tavern Setup <version>.exe` | You want a normal install with Start menu and desktop shortcuts. It installs per user, so no admin rights are needed. |
| `DND Tavern <version>.exe` | You want a portable app that runs from any folder or a USB stick. |

The builds are not code-signed, so Windows SmartScreen may say *"Windows protected your PC"* the first time. Click **More info → Run anyway**. See [Code signing](#code-signing) if you build and distribute it yourself.

Requires Windows 10 or 11 (x64). Mica and acrylic window materials need Windows 11 22H2 or later; older versions use a solid background.

### Linux

Two builds for x64 Linux (Ubuntu 22.04 or newer, Debian 12, Fedora and others):

| File | Use it when |
| --- | --- |
| `DND Tavern-<version>-x86_64.AppImage` | Any distribution. Runs without installing and updates itself. |
| `dnd-tavern_<version>_amd64.deb` | Ubuntu or Debian, with a menu entry. Updates come as a new `.deb`. |

```bash
chmod +x "DND Tavern-0.2.0-x86_64.AppImage"
```

```bash
./"DND Tavern-0.2.0-x86_64.AppImage"
```

AppImages need FUSE 2. Ubuntu 24.04 and later don't include it: `sudo apt install libfuse2t64` (on 22.04, `libfuse2`). For the `.deb`:

```bash
sudo apt install ./dnd-tavern_0.2.0_amd64.deb
```

API keys are encrypted with the desktop keyring (GNOME Keyring or KWallet), which GNOME and KDE run by default. Without a keyring (some minimal window managers, or WSL), keys can't be stored; type `env:NAME` in the key field to read the key from an environment variable instead. Settings live in `~/.config/DND Tavern/`. Obsidian is found whether it was installed natively, as a Flatpak or as a Snap.

## First run

A short setup wizard walks you through:

1. **Vault.** Pick an Obsidian vault. DND Tavern lists the vaults Obsidian knows about, or you can browse to any folder; it doesn't have to be an Obsidian vault yet. All of its files go in one folder inside the vault, `DND Tavern/` by default.
2. **Text model.** Choose a preset, enter the URL and key, and press **Test**. You can skip this and add one later.
3. **Images and character** (optional). Set up an image backend, create a character, or import SillyTavern character cards (PNG or JSON).
4. **Finish.** Leave **Start with "The Sunken Lantern"** ticked to get a ready-to-play sample: a short mystery campaign with a lorebook, an NPC, a level 2 rogue with a full sheet, and a first session waiting for your move.

Press **Ctrl+K** at any time to search commands, sessions, characters, lorebooks and any note in your vault.

## Your vault

```text
<your vault>/
└── DND Tavern/
    ├── Characters/            one note per character (card + D&D sheet in frontmatter)
    │   └── avatars/
    ├── NPCs/
    ├── Lorebooks/             each "## Heading" is a lore entry
    ├── Presets/               DM system prompts
    └── Campaigns/
        └── <Campaign>/
            ├── Campaign.md    setting, tone, house rules, edition, sourcebooks, lorebooks
            ├── Party.md       shared gold, inventory, quests
            ├── <Name> Map.md  the campaign map: image, pins, the party's position
            ├── Sessions/      one note per session: the chat log
            └── Images/        generated illustrations
```

Session notes are readable in Obsidian. Each message is a callout:

```markdown
> [!dm] DM
> The ferry's bell clangs twice as the fog parts…
<!-- id:m1a2b3c t:2026-10-10T19:02:11Z swipes:2 swipe:0 model:claude-opus-5-5 -->
```

You can edit, add or delete messages in Obsidian; the app keeps the rest of the file exactly as you left it. Alternative replies ("swipes"), the rolling summary, the session recap and the combat tracker are stored in the note's frontmatter.

How DND Tavern treats your files:

- It only ever writes inside its root folder, and never touches `.obsidian/`.
- Every write is atomic (written to a temporary file and then renamed). If a note changed on disk since it was read, the app merges or asks; it never silently overwrites your edits.
- Deleted notes go to the Windows Recycle Bin.
- Wikilinks (`[[Campaigns/The Sunken Lantern/Campaign|The Sunken Lantern]]`) connect sessions, characters, campaigns and lorebooks, so Obsidian's graph and backlinks work.

The **Open in Obsidian** buttons use `obsidian://` links, so Obsidian must have the vault open at least once.

## Playing

Type what your character does and press **Enter** (Shift+Enter for a new line). The DM's reply streams in.

| Action | How |
| --- | --- |
| Regenerate the last reply | **Ctrl+R**, or the ↻ button |
| Switch between alternative replies | **Alt+←/→**, or the arrows under the message |
| Stop generating | **Esc** |
| Continue a reply that stopped early | `/continue` |
| Edit, delete or fork from a message | The message's hover toolbar |
| See exactly what is sent to the model | The **Prompt inspector** button in the chat header |
| Switch the text or image model | The model pickers in the chat header and title bar |
| Search everything | **Ctrl+K** |
| Message actions | Right-click a message (copy, edit, replies, regenerate, fork, delete) |
| Edit your own message | Double-click it |
| Previous / next reply | Your mouse's back / forward buttons (or back/forward through sessions, in Settings) |
| Zoom the interface | **Ctrl+scroll** (**Ctrl+0** resets) |
| Open a session or character in Obsidian | Middle-click it in the sidebar |

The lightbulb above the message box offers **tips and ideas**: three AI suggestions for your next move (or, as the DM, a complication, an NPC line and a check to call), plus rotating tips. Click an idea to put it in the message box.

The clock button next to the message box turns on the **turn timer**: a countdown for your turn after each AI reply and for each combatant in combat. When it runs out it chimes, or (if you choose) the story moves on. Settings → General → Turn timer.

When the DM asks for a check (`[CHECK perception DC 13]`), a button appears that rolls it with your sheet's modifiers.

### Slash commands

| Command | What it does |
| --- | --- |
| `/roll 2d6+3` | Roll dice. Supports `4d6kh3`, `2d20kl1`, `adv`, `dis`, labels. |
| `/check dex 15`, `/save wis 13` | Ability or skill check / saving throw from your sheet |
| `/init`, `/next`, `/prev`, `/endcombat` | Start and run combat |
| `/add Goblin hp 7 ac 15 init +2` | Add a combatant |
| `/dmg Goblin 5`, `/heal Aria 4` | Change hit points |
| `/rest short 2`, `/rest long` | Rests (hit dice, HP, spell slots) |
| `/party` | Add your character to the combat tracker |
| `/image <prompt>`, `/image scene`, `/image portrait [name]`, `/image battlemap [place]` | Generate an illustration, a portrait, or a top-down battlemap of the current scene (or of the place you describe) |
| `/note <name>` | Pull any vault note into the conversation |
| `/sys <text>` | Add a narrator/system note |
| `/compress` | Compress this session into a recap now |
| `/mode ai-dm \| user-dm \| ai-only` | Who plays (see below) |
| `/autoplay [turns]` | AI-only sessions: let the story play itself |
| `/title <title>`, `/new`, `/help` | Rename, new session, list commands |

Extensions add more (for example `/loot cr 3`, `/npc`, `/weather`, `/pin`, `/stat`).

## Who plays: AI DM, you as DM, or AI only

Each session (and, as a default, each campaign) has a mode, switched from the chat header or with `/mode`:

| Mode | You | The AI |
| --- | --- | --- |
| **AI is the DM** (default) | play your character | runs the game |
| **You are the DM** | narrate, voice NPCs, call for checks | plays the character, using its own player prompt (Settings → Prompt) and never seeing the campaign note's DM secrets |
| **AI only** | watch, or steer with director's notes | plays both sides, one turn at a time |

As the DM, writing `[CHECK perception DC 13]` rolls the check for the character instead of asking the AI. In AI-only sessions, **Next turn** asks for one reply and **Auto-play** keeps going for a number of turns, rolling any checks the DM asks for. Messages keep their story role whoever wrote them, so you can switch modes mid-session.

**AI companions** (AI is the DM): the people button in the chat header picks characters or NPCs for the AI to play as party members. After each of your messages, every companion takes a short turn as its own character, from its own card and sheet, then the DM answers the whole party, treating companions as player characters it never acts for. In **AI only** sessions, companions join the session's character as extra party members: each character takes its own turn (Next turn or Auto-play), then the DM. It works at a multiplayer table too: after a player acts, the companions take their turns, then the DM answers. Two or three companions work best; up to four. Stop ends the party turn.

## Campaigns, editions and sourcebooks

- **Campaign builder** (campaign menu or Ctrl+K): describe a premise, tone, setting, length and who plays. The AI drafts a campaign (pitch, setting, hook, opening scene, locations, NPCs with wants and secrets, factions, an outline, quests and DM secrets) that you review and edit before anything is written. Or fill it in by hand. The draft streams in with a live view of what it's writing, how many tokens and how fast, and can be cancelled; streaming also keeps long drafts on slow models from timing out. If the server stops the reply early (KoboldCpp caps replies at 2048 tokens), the builder asks for the missing places, people and story in a second request. It creates the campaign note, the party sheet, a linked lorebook with what players may learn, a note per NPC, a starter map with the locations, and Session 01.
- **Campaign settings** (campaign menu or Ctrl+K): the rules edition, allowed sourcebooks, the default play mode, setting, tone and house rules, all saved in Campaign.md.
- **D&D 3.5 edition**: choose it per campaign and per character sheet. 3.5 sheets have skill ranks, base attack bonus, Fortitude/Reflex/Will base saves and feats; checks add ranks and saves add base saves (a natural 20 or 1 on a save always succeeds or fails); the 3.5 XP table and conditions apply, and resting heals 1 HP per level. Sourcebooks include the core books and expansions such as the Complete series, Races of…, Player's Handbook II, Spell and Magic Item Compendium, Tome of Battle, Expanded Psionics Handbook, the Monster Manuals, Eberron and Forgotten Realms. The DM is told the edition, the allowed books and to use 3.5 check names such as `[CHECK spot DC 15]`.

## Maps and the graph view

- **Campaign map** (map button in the chat header): use a picture (any file, an image from the campaign, or one painted by your image backend) or a blank grid. Add pins (location, point of interest, danger, note) with descriptions and linked notes, drag them around, and move the green party token. Dropping the party on a pin tells the DM ("The party travels to …") and puts the location in the prompt. Set the map's width for a scale bar. The map is a normal note with a readable pin list.
- **Mini-map**: a game-style schematic in the corner of the chat, centred on the party's HERE marker, with a compass and scale bar. Click it to open the map; hide it from its corner button or the map view.
- **Graph view**: an Obsidian-style graph of your campaign notes and the wikilinks between them, plus dashed links where a session mentions a character or NPC. The right panel's Graph tab shows the local graph around the open session; Ctrl+K → Graph view shows everything, with search and filters. Click a note to open it.

In the map's image chooser, **Paint from a sketch…** turns a rough drawing (coastlines, mountains, roads, in any paint program) into a finished map with img2img, keeping its proportions. It needs Automatic1111/Forge, or a ComfyUI workflow with a Load Image node picked for Maps. Map LoRAs such as Fantasy Map (world maps) and Mapcraft (battlemaps) work well with the Maps and Battlemaps generation options.

## Multiplayer

Open a session, then the right panel's **Table** tab:

1. Choose **Local network & online** (phones and laptops on your Wi-Fi, or anyone you share it with through port forwarding or Tailscale) or **This PC only**, and press **Start hosting**. Windows may ask to let DND Tavern use the network; allow it for private networks.
2. Share the link shown (the join code is in it). Players open it in any browser, enter their name, and pick a character, which joins the session's party.
3. Players read the story as it's written, act as their character, and roll their checks and dice from their page (rolls happen on the host). When the DM asks for a check, players get a **Roll it** button.

With the AI as DM, choose whether it answers every player message, waits until everyone has acted, or waits for you. With you as DM, players act and you narrate from your screen. You can remove a player at any time.

- **Player screen**: a read-only window with the story in large type and the party's HP, for a second monitor or a TV at the table.
- **DM screen** tab: private dice rolls that aren't posted, the DC ladder for the campaign's edition, condition reminders, the campaign note's secrets and your NPCs.

Players only see the session's visible messages, the party's public stats and the campaign's images. They never see the vault, settings, prompts or hidden notes.

### Automatic sheet updates

With **Settings → Prompt → Automatic sheet updates** on, the DM adds a hidden `<state>{"hp":-4,"add_item":"rope"}</state>` line when your HP, gold, XP, items or conditions change. The app applies the change to your sheet, hides the line, and posts what changed with an **Undo** button.

## Text backends

Add as many as you like in **Settings → Text backends**. One is the default. Optionally, different ones can handle chat, summaries and image prompts, and the **fallback chain** tries the next backend when one fails before any text arrives.

| Type | Works with |
| --- | --- |
| OpenAI-compatible | OpenAI, OpenRouter, LM Studio, llama.cpp server, vLLM, TabbyAPI, KoboldCpp (`/v1`), Groq, Together, DeepSeek… |
| Anthropic | Claude models via the official SDK, with an effort setting and refusal fallback |
| Ollama | Native `/api/chat` with streaming |
| KoboldCpp | Native API |
| text-generation-webui | Native API |
| Custom | Any HTTP API: a JSON body template with `{{prompt}}`, `{{messages}}`, `{{system}}` and so on, plus a JSONPath to the reply (and optionally to each streamed chunk) |

**Context size** is how much text DND Tavern plans to send. Self-hosted servers fix their own window when they start (KoboldCpp's `--contextsize` defaults to 4096), so the app asks KoboldCpp, llama.cpp and vLLM what they actually loaded and never plans for more. **Test** shows that number, warns when your setting is bigger, and can set it for you. To get a bigger window, restart the server with a larger setting (for KoboldCpp, `--contextsize 8192` or more; models trained on 4k, like Llama 2, get less coherent well past 8k). Ollama loads whatever Context size you set.

Every backend has a **Network** section for custom headers, an HTTP/HTTPS/SOCKS5 proxy, a timeout, retries, and an option to accept self-signed certificates. Plain `http://` to a non-local address shows a warning, because your prompts and key travel unencrypted.

### Example: OpenRouter

- Preset: **OpenRouter** (`https://openrouter.ai/api/v1`)
- API key: your OpenRouter key
- Model: press **Fetch models** and pick one, e.g. `anthropic/claude-sonnet-5.5`

### Example: Anthropic

- Preset: **Anthropic (Claude)**
- Model: `claude-opus-5-5` (or `claude-sonnet-5-5`, `claude-haiku-5-5`)
- **Effort** controls how much the model thinks before answering. With **Refusal fallback** on, a request the main model declines is retried once on a fallback model.

### Example: Ollama on another PC over Tailscale

1. On the PC running Ollama, make it listen on all interfaces: set the environment variable `OLLAMA_HOST=0.0.0.0` and restart Ollama.
2. In DND Tavern, choose the **Ollama** preset and set the URL to that machine's Tailscale name, e.g. `http://gaming-pc.tail1234.ts.net:11434`.
3. Press **Fetch models**, pick one, then **Test**.

Tailscale encrypts the connection, so the plain-`http` warning can be ignored here.

### Example: a server behind Cloudflare Access

Add two headers in the backend's **Network** section:

```text
CF-Access-Client-Id:     <service token id>.access
CF-Access-Client-Secret: <service token secret>
```

Header values are stored encrypted, like API keys.

## Image backends and ComfyUI

**Settings → Image backends**. Under **Generation options**, scenes, portraits, maps, battlemaps and plain `/image` prompts can each use their own backend, model or checkpoint, ComfyUI workflow, size, steps, style and negative prompt (for example a cartography checkpoint at 1024×768 for maps and a portrait model for characters); anything left empty uses the backend's settings and the model switcher. Turn on **Paint portraits for new characters and NPCs** (under Image triggers) and every new character or NPC without a portrait gets one, painted in the background one at a time and set as their picture: from New character (once it has a description), the campaign builder, `/npc`, or notes you add in Obsidian. Existing characters are left alone. Images are saved into the campaign's `Images/` folder and embedded in the session note as `![[…]]`. Generate them with `/image`, from a message's toolbar, as character portraits, or automatically every N DM turns or when the location changes (**Settings → Image backends → Triggers**).

### ComfyUI

1. In ComfyUI, enable **Dev mode** in the settings, then use **Workflow → Export (API)** to save your workflow as API-format JSON.
2. In DND Tavern, add a ComfyUI backend (`http://127.0.0.1:8188` by default) and click **Import workflow**.
3. DND Tavern guesses which nodes hold the positive and negative prompt, seed, size, steps, checkpoint and LoRA. Check the mapping and fix anything it got wrong. Each mapping is a node id and an input name, and you can also inject values into any other input.
4. Optionally mark a workflow as the default for scenes or portraits, choose random or fixed seeds, and override the checkpoint or LoRA (and its strength).
5. Press **Test**. Progress streams over ComfyUI's websocket (falling back to polling) and can be cancelled.

Workflows that take an input image (img2img, IP-Adapter) are supported: the reference image is uploaded to ComfyUI first. Workflows are stored in the app's data folder (`%APPDATA%\DND Tavern\workflows\`, or `~/.config/DND Tavern/workflows/` on Linux) by default, or in the vault if you prefer.

#### Remote ComfyUI behind a reverse proxy

For a ComfyUI server on another machine, put it behind HTTPS (Caddy, nginx or a Cloudflare Tunnel) and point the backend at the public URL, e.g. `https://comfy.example.com`. If it is protected by Cloudflare Access, add the `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers as shown above. The headers are sent on HTTP requests, image uploads and the progress websocket. For basic auth, add an `Authorization: Basic …` header. Make sure the proxy forwards websockets on `/ws`.

### Automatic1111 / Forge

Start it with `--api`, then add an **Automatic1111 / Forge** backend (`http://127.0.0.1:7860`).

### OpenAI images and custom APIs

The **OpenAI images** backend works with `gpt-image-1` and compatible servers. **Custom** describes any image API with a body template plus a JSONPath to a URL or base64 image.

## Memory: summaries and session recaps

A long campaign doesn't fit in a model's context, so DND Tavern compresses old material in three ways:

- **Rolling summary (within a session).** Every N messages (**Settings → Prompt**, 20 by default), older messages are folded into a running "story so far" stored in the session's frontmatter. The newest messages are always sent in full.
- **Session recaps (between sessions).** When you leave a session (switch to another one, start a new one, or close the app and come back later), its whole chat is compressed into a recap: what happened, open threads, and where things stand. The recap is saved in the session note's frontmatter (`recap:`), and a toast confirms it. New sessions in the same campaign include the last few recaps (3 by default) as a **Previous sessions** block in the prompt, and show the latest one in a **Previously** card at the top of the chat. Recaps are only redone when the session has new messages. Type `/compress` to make one immediately. Turn the feature off with **Settings → Prompt → Compress finished sessions**.
- **Lorebooks.** Entries are only sent when their keywords appear in recent messages, within a token budget, ordered by priority. Entries marked *always on* are always sent.
- **NPCs.** Every note in `NPCs/` works like a lore entry, so the DM knows who's who: it is sent when the NPC's name comes up (the full name, or a distinctive first or last name) or one of their **aliases** (Obsidian's `aliases` property, or *Also known as* in the editor). The DM gets the whole note, wants and secrets included; when the AI speaks as a player character, it only gets the description and personality. An NPC belongs to a campaign when their note links to it (or to one of its sessions) or the campaign note links to them; NPCs linked to no campaign can turn up in any. A lorebook entry with the same name as an NPC is merged into theirs.

Summaries and recaps use the backend assigned to the **Summaries** role, or the default backend if none is assigned. A cheaper or local model works well here.

The prompt is assembled from blocks you can reorder and switch off in **Settings → Prompt**: DM preset, character card, campaign and party, lorebook, sheet, combat, previous sessions, session summary, chat history, and extension blocks. The prompt inspector shows each block's size.

## Settings, keys and privacy

- Settings live in `%APPDATA%\DND Tavern\settings.json` (Linux: `~/.config/DND Tavern/settings.json`). Your vault holds your content; nothing else is written there.
- API keys and secret headers are encrypted with Windows DPAPI, or the desktop keyring on Linux (Electron `safeStorage`), so they can only be decrypted by your account on this computer. Instead of storing a key, you can enter `env:NAME` to read it from an environment variable at request time.
- Keys never reach the app's UI process, and they are redacted from logs, error messages and the prompt inspector.
- DND Tavern makes no network requests except to the backends you configure, the update check if you turn it on, and the multiplayer server while you host.
- **Minimise to tray** keeps the app in the notification area when you close the window. Quit from the tray icon's menu.

## Updates

Settings → **Updates**: one **Update** button checks GitHub, downloads the new version and offers a restart. You can also check on startup and download in the background (a gold dot on the Updates page means one is waiting). Installed copies (and Linux AppImages) update themselves from GitHub Releases: when a new version is ready, a pill in the title bar offers **Restart to update** (it also installs when you quit). Portable, `.deb` and development copies can't replace themselves, so they link to the release page instead. Nothing installs without you.

## Writing extensions

Extensions are folders in `%APPDATA%\DND Tavern\extensions\` (Linux: `~/.config/DND Tavern/extensions/`; open it from **Settings → Extensions**). Six examples are installed: Weather & Time, Loot Generator, NPC Generator, Session Recap, Map Pins, and **Mature Mode (18+)**, which (once enabled and confirmed 18+) allows adult content between consenting adult characters and tracks its own per-character stat blocks such as Arousal, Affection and Stamina, updated by the model and editable in its panel. New extensions start disabled; enabling one shows the permissions it asks for, and you can grant or refuse each one.

```text
extensions/my-extension/
├── extension.json   manifest
├── main.js          logic: commands and hooks (runs sandboxed in the main process)
└── ui.js            optional: a side panel and message decorations (runs in a sandboxed iframe)
```

### extension.json

```json
{
  "id": "my-extension",
  "name": "My Extension",
  "version": "1.0.0",
  "description": "What it does.",
  "permissions": ["generate:text"],
  "commands": [{ "name": "omen", "description": "Draw an omen", "usage": "/omen [topic]" }],
  "settings": [{ "key": "tone", "label": "Tone", "type": "select", "default": "grim", "options": ["grim", "whimsical"] }]
}
```

Permissions: `vault:read`, `vault:write` (only inside the DND Tavern folder), `network`, `generate:text`, `generate:image`.

### main.js

```js
module.exports = {
  commands: {
    // "/omen the voyage" → args = "the voyage"
    async omen(args, ctx) {
      const tone = ctx.settings.tone
      const text = await ctx.generateText(`Write a one-sentence ${tone} omen about ${args || 'the road ahead'}.`)
      await ctx.post('system', `**Omen:** ${text}`)
    }
  },
  hooks: {
    // Add or change prompt blocks before each request.
    onPromptBuild(blocks, ctx) {
      return [...blocks, { id: 'ext:omen', label: 'Omens', role: 'system', content: 'Omens matter in this world.', tokens: 6 }]
    },
    // Rewrite the DM's reply before it is saved.
    onResponse(text, ctx) {
      return text
    },
    // Notifications (return values ignored).
    onBeforeSend(payload, ctx) {},
    onDiceRoll(result, ctx) {},
    onSessionStart(_, ctx) {}
  }
}
```

`ctx` gives read-only snapshots of `session`, `character`, `campaign`, `sheet` and your extension's `settings`, plus:

| Method | Needs |
| --- | --- |
| `post(role, text)` | |
| `roll(expr)` returns `{ total, … }` | |
| `notify(message)` | |
| `store.get(key)` / `store.set(key, value)` (per-extension storage) | |
| `readNote(path)` | `vault:read` |
| `writeNote(path, content)` | `vault:write` |
| `fetch(url, opts)` | `network` |
| `generateText(prompt, opts)` | `generate:text` |
| `generateImage(prompt, opts)` | `generate:image` |

`main.js` runs in a locked-down V8 context: no `require`, no Node or Electron APIs, no `eval`, and only JSON-serialisable data crosses the boundary. A hook that throws or takes too long is skipped and the extension is marked as failing; it never breaks the chat.

### ui.js

```js
export default {
  // Rendered in the right panel's Extensions tab.
  panel(root, tavern) {
    tavern.onState((state) => {
      root.innerHTML = `<div class="card"><h3>${state.campaign?.name ?? 'No campaign'}</h3></div>`
    })
  },
  // Text shown under each DM message.
  onMessageRender(el, message) {
    el.textContent = message.text.includes('dragon') ? '🐉 A dragon was mentioned.' : ''
  }
}
```

`tavern` offers `onState(fn)`, `getState()`, `runCommand(name, args)`, `notify(message)` and `resize(height)`. The page is styled with the app's theme colours (`.card`, `.muted`, `button.secondary`), cannot reach the network, and cannot touch the app.

## Development

Requirements: Node.js 22+, Windows 10/11.

```bash
npm install
npm run dev          # hot-reloading dev build
npm test             # vitest unit tests
npm run typecheck
```

npm 11 blocks dependency install scripts by default. The ones this project needs are already approved in `package.json` (`allowScripts`). Electron downloads its binary the first time it runs.

Dev runs keep their data in `%APPDATA%\DND Tavern (dev)\` (Linux: `~/.config/DND Tavern (dev)/`), so they never interfere with an installed copy.

`TestVault/` is a small Obsidian vault for trying things out: point the wizard at it.

Project layout (details in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)):

```text
src/main/       Electron main process: vault, backends, chat, images, extensions, IPC handlers
src/preload/    the typed bridge exposed to the UI
src/renderer/   React UI (Tailwind, Radix, zustand)
src/shared/     types, schemas and pure logic shared by both sides (prompt, dice, callouts…)
extensions/     bundled example extensions
tests/          vitest
```

## Building the installer

```bash
npm run dist
```

This type-checks, builds, and writes both installers to `dist/`:

- `dist/DND Tavern Setup <version>.exe` (NSIS installer)
- `dist/DND Tavern <version>.exe` (portable)

`npm run dist:dir` builds an unpacked app in `dist/win-unpacked/` for quick testing. Regenerate the icon from `build/icon.svg` with `npm run icon`.

### Building for Linux

Build on Linux, or in WSL on Windows (Ubuntu under WSL 2 works, and WSLg can run the result). Use Node.js 22 or newer, and clone the repository inside the Linux file system (for example `~/cannontavern`), not under `/mnt/c`, so `npm ci` installs Linux binaries:

```bash
npm ci
```

```bash
npm run dist:linux
```

This writes `dist/DND Tavern-<version>-x86_64.AppImage`, `dist/dnd-tavern_<version>_amd64.deb` and `dist/latest-linux.yml`. Building needs no extra packages (electron-builder downloads its own tools). Running the app needs the usual Electron libraries, which desktop installs already have; `sudo apt install ./dnd-tavern_<version>_amd64.deb` pulls in any that are missing (on a bare WSL install too).

### Publishing a release (for in-app updates)

Bump `version` in `package.json`, set `GH_TOKEN` to a GitHub token that can create releases, and run:

```bash
npm run release
```

This uploads the installer, its blockmap and `latest.yml` to a GitHub release, which installed copies check. The releases must be readable without a token, so the repository (or at least its releases) has to be public for updates to download.

`release.bat [version] [--dry]` does the same with prompts: it bumps the version, finds a token (`GH_TOKEN`, the GitHub CLI's login, or a hidden prompt; never saved), publishes, and offers to commit the bump. On Linux, `./release.sh [version] [--dry]` publishes the AppImage, `.deb` and `latest-linux.yml` the same way (`npm run release:linux`). For one release with both, run each for the same version within two hours of each other; they upload to the same GitHub release.

### Code signing

Unsigned builds trigger SmartScreen warnings until they build up reputation. To sign, get a code-signing certificate (an OV certificate, or Azure Trusted Signing) and set `CSC_LINK` (path or base64 of the `.pfx`) and `CSC_KEY_PASSWORD` before running `npm run dist`; electron-builder signs automatically. See the [electron-builder code signing docs](https://www.electron.build/code-signing).

## Troubleshooting

| Problem | Fix |
| --- | --- |
| "Connection refused" | The server isn't running, or isn't listening on that address. For Ollama on another PC, set `OLLAMA_HOST=0.0.0.0`. |
| 401 / 403 | Wrong or missing API key or proxy headers. Use **Test** in the backend editor; error details can be copied from the toast. |
| The reply is cut off | Raise **Max reply tokens**, or type `/continue`. |
| Stuck at 4096 tokens of context | That's the server's window, not the app's. Restart KoboldCpp with `--contextsize 8192` (llama.cpp: `--ctx-size`), then press **Test** and match the Context size. |
| The model forgets earlier events | Check the rolling summary and session recaps are on (**Settings → Prompt**), and look at the prompt inspector to see what is being sent. |
| ComfyUI test fails with a node error | The workflow references a model or custom node the server doesn't have. Open it in ComfyUI on that server first. |
| Edits in Obsidian don't show up | They appear within a second or two. If a note was changed in both places at once, the app asks which version to keep. |
| SmartScreen blocks the installer | **More info → Run anyway**, or sign your build. |
| The AppImage closes at once on Ubuntu 24.04 or later (a sandbox error when started from a terminal) | Ubuntu restricts the sandbox Electron uses. Install the `.deb` instead, which adds an AppArmor profile for it, or start the AppImage with `--no-sandbox`. |
| Linux: "No system keyring is running" | Log in to a GNOME or KDE session (they start a keyring), or type `env:NAME` in the key field and set that environment variable. |

## License

MIT
