# DND Tavern

A Windows desktop app for playing Dungeons & Dragons with an AI Dungeon Master, in the style of SillyTavern.

Everything it creates is stored as plain Markdown and image files in an **Obsidian vault**: characters, sheets, lorebooks, campaigns, session logs and illustrations. You can read and edit the same notes in Obsidian while you play, and DND Tavern picks up your edits live.

- **Any text model.** OpenAI-compatible servers (OpenRouter, LM Studio, llama.cpp, vLLM, Groq and others), Anthropic Claude, Ollama, KoboldCpp, text-generation-webui, or any HTTP API through a body template. Local, LAN or remote, with an optional fallback chain.
- **Any image backend.** ComfyUI with your own workflows (fully supported, including remote servers behind a proxy), Automatic1111/Forge, OpenAI images, or a custom API.
- **D&D mechanics.** A dice engine with 3D dice, ability checks and saves, a 5e character sheet, initiative and combat tracking, and optional automatic sheet updates from the story.
- **Memory.** Lorebooks with keyword triggers, a rolling in-session summary, and automatic session recaps, so each new session starts knowing what happened before.
- **Extensions.** Small JavaScript add-ons that run sandboxed and add commands, prompt context, panels and hooks.

## Contents

- [Install](#install)
- [First run](#first-run)
- [Your vault](#your-vault)
- [Playing](#playing)
- [Text backends](#text-backends)
- [Image backends and ComfyUI](#image-backends-and-comfyui)
- [Memory: summaries and session recaps](#memory-summaries-and-session-recaps)
- [Settings, keys and privacy](#settings-keys-and-privacy)
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
            ├── Campaign.md    setting, tone, house rules, linked lorebooks
            ├── Party.md       shared gold, inventory, quests
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
| Search everything | **Ctrl+K** |

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
| `/image <prompt>`, `/image scene`, `/image portrait` | Generate an illustration |
| `/note <name>` | Pull any vault note into the conversation |
| `/sys <text>` | Add a narrator/system note |
| `/compress` | Compress this session into a recap now |
| `/title <title>`, `/new`, `/help` | Rename, new session, list commands |

Extensions add more (for example `/loot cr 3`, `/npc`, `/weather`, `/pin`).

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

**Settings → Image backends**. Images are saved into the campaign's `Images/` folder and embedded in the session note as `![[…]]`. Generate them with `/image`, from a message's toolbar, as character portraits, or automatically every N DM turns or when the location changes (**Settings → Image backends → Triggers**).

### ComfyUI

1. In ComfyUI, enable **Dev mode** in the settings, then use **Workflow → Export (API)** to save your workflow as API-format JSON.
2. In DND Tavern, add a ComfyUI backend (`http://127.0.0.1:8188` by default) and click **Import workflow**.
3. DND Tavern guesses which nodes hold the positive and negative prompt, seed, size, steps, checkpoint and LoRA. Check the mapping and fix anything it got wrong. Each mapping is a node id and an input name, and you can also inject values into any other input.
4. Optionally mark a workflow as the default for scenes or portraits, choose random or fixed seeds, and override the checkpoint or LoRA (and its strength).
5. Press **Test**. Progress streams over ComfyUI's websocket (falling back to polling) and can be cancelled.

Workflows that take an input image (img2img, IP-Adapter) are supported: the reference image is uploaded to ComfyUI first. Workflows are stored in `%APPDATA%\DND Tavern\workflows\` by default, or in the vault if you prefer.

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

Summaries and recaps use the backend assigned to the **Summaries** role, or the default backend if none is assigned. A cheaper or local model works well here.

The prompt is assembled from blocks you can reorder and switch off in **Settings → Prompt**: DM preset, character card, campaign and party, lorebook, sheet, combat, previous sessions, session summary, chat history, and extension blocks. The prompt inspector shows each block's size.

## Settings, keys and privacy

- Settings live in `%APPDATA%\DND Tavern\settings.json`. Your vault holds your content; nothing else is written there.
- API keys and secret headers are encrypted with Windows DPAPI (Electron `safeStorage`), so they can only be decrypted by your Windows account on this PC. Instead of storing a key, you can enter `env:NAME` to read it from an environment variable at request time.
- Keys never reach the app's UI process, and they are redacted from logs, error messages and the prompt inspector.
- DND Tavern makes no network requests except to the backends you configure. The optional **Check for updates** setting (off by default) asks GitHub for the latest release once per launch and shows a download link; nothing installs automatically.
- **Minimise to tray** keeps the app in the notification area when you close the window. Quit from the tray icon's menu.

## Writing extensions

Extensions are folders in `%APPDATA%\DND Tavern\extensions\` (open it from **Settings → Extensions**). Five examples are installed on first run: Weather & Time, Loot Generator, NPC Generator, Session Recap and Map Pins. New extensions start disabled; enabling one shows the permissions it asks for, and you can grant or refuse each one.

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

Dev runs keep their data in `%APPDATA%\DND Tavern (dev)\`, so they never interfere with an installed copy.

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

### Code signing

Unsigned builds trigger SmartScreen warnings until they build up reputation. To sign, get a code-signing certificate (an OV certificate, or Azure Trusted Signing) and set `CSC_LINK` (path or base64 of the `.pfx`) and `CSC_KEY_PASSWORD` before running `npm run dist`; electron-builder signs automatically. See the [electron-builder code signing docs](https://www.electron.build/code-signing).

## Troubleshooting

| Problem | Fix |
| --- | --- |
| "Connection refused" | The server isn't running, or isn't listening on that address. For Ollama on another PC, set `OLLAMA_HOST=0.0.0.0`. |
| 401 / 403 | Wrong or missing API key or proxy headers. Use **Test** in the backend editor; error details can be copied from the toast. |
| The reply is cut off | Raise **Max reply tokens**, or type `/continue`. |
| The model forgets earlier events | Check the rolling summary and session recaps are on (**Settings → Prompt**), and look at the prompt inspector to see what is being sent. |
| ComfyUI test fails with a node error | The workflow references a model or custom node the server doesn't have. Open it in ComfyUI on that server first. |
| Edits in Obsidian don't show up | They appear within a second or two. If a note was changed in both places at once, the app asks which version to keep. |
| SmartScreen blocks the installer | **More info → Run anyway**, or sign your build. |

## License

MIT
