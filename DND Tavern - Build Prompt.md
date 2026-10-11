# Build Prompt: "DND Tavern", a Windows desktop app (.exe) that stores its data in an Obsidian vault

> Copy everything below the line into your coding assistant.

---

## Role and goal

You are a senior full-stack TypeScript and Electron developer with a strong eye for UI design. Build **DND Tavern**, a **standalone Windows desktop app**. It is a chat frontend in the style of SillyTavern for running Dungeons & Dragons–style text adventures with LLMs. It is **not** an Obsidian plugin and not a browser app. It ships as an **`.exe`**: an installer plus a portable version. The user double-clicks it and gets a polished, good-looking native window.

All of its data is stored as plain Markdown and image files inside a folder of an **Obsidian vault**. That data includes characters, lorebooks, campaigns, session logs, character sheets and generated images. The user can keep Obsidian open next to the app and browse, link, search and edit the same files. Changes made in either one appear in the other.

Text and image generators may run **outside the user's local network**, for example on a rented GPU server, a home server reached over VPN or Tailscale, or a cloud API. The settings must let the user add **any number** of text and image backends. ComfyUI must be fully supported as an image backend.

## Tech stack

- **Shell:** **Electron** (latest stable) with TypeScript, scaffolded with `electron-vite`.
  - **Main process:** handles everything with system access:
    - reading and writing the vault, and watching it for outside edits
    - calling every LLM and image backend (no CORS problems, and keys never reach the UI)
    - settings
    - extensions
  - **Renderer:** UI only.
  - **Talking between them:** typed IPC through a `preload` script using `contextBridge`. Streamed tokens arrive as IPC events.
  - **Security settings:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and a strict CSP.
- **UI:**
  - **React + TypeScript + Tailwind CSS + shadcn/ui** (built on Radix primitives).
  - **Framer Motion** for animation and **lucide-react** for icons.
  - **Zustand** for state.
  - **react-markdown** for message rendering.
- **Libraries:**
  - `chokidar` to watch the vault
  - `gray-matter` (or `yaml`) to read and write frontmatter
  - `ws` for the ComfyUI websocket
  - `zod` to validate settings and IPC data
  - `undici` for HTTP requests with proxy support
- **Packaging:** use **electron-builder** to produce:
  - an **NSIS installer** `DND Tavern Setup x.y.z.exe`, with a Start Menu entry, a desktop shortcut and an uninstaller
  - a **portable** `DND Tavern x.y.z.exe`
  - a proper app icon (`.ico`)
  - an app ID and a product name
  - Auto-update with `electron-updater` is optional and turned off by default.
- **Scripts:**
  - `npm run dev`: hot reload
  - `npm run build`
  - `npm run dist`: builds both `.exe` files into `dist/`
- **Not allowed:** `eval`, loading code from remote servers, and `remote` module usage.

## Obsidian vault as storage

- **Settings:** a **vault path** setting (for example `C:\Users\Me\Documents\MyVault`), chosen with the native folder-picker dialog, and a **root folder** inside it (default `DND Tavern/`).
  - On first launch, a setup wizard asks for the vault. It can also find existing vaults by reading Obsidian's `%APPDATA%\obsidian\obsidian.json` and offering them in a list.
  - The app checks that the path contains `.obsidian/`. If it doesn't, the app warns the user but still works with any plain folder.
  - The app **never** reads or writes `.obsidian/`.
- **Writing files safely:**
  - Write to a temporary file, then rename it over the original. This way Obsidian never sees a half-written file.
  - Keep a record of each file's last-modified time and content hash. If a file changed on disk since the app read it, don't overwrite it: merge the change or ask the user.
- **Two-way sync:**
  - Use chokidar to watch the root folder. When the user edits a note in Obsidian, the app re-reads it, re-parses it and pushes the update to the UI over IPC.
  - Ignore the change events caused by the app's own writes.
- **Obsidian-friendly output:**
  - YAML frontmatter, `[[wikilinks]]` between notes (a session links to its character and campaign), callouts for chat turns, and embedded images written as `![[image.png]]`.
  - File names must be valid on Windows (strip `\ / : * ? " < > |`).
- **Links into Obsidian:** an "Open in Obsidian" button on characters, sessions and other notes. It uses the URI `obsidian://open?vault=<name>&file=<path>`.
- **Index:** the app builds an in-memory index of notes (characters, lorebooks, campaigns, sessions) at startup and updates it when files change. Do not use a separate database. The vault is the only source of truth.

### Vault layout

```
<Vault>/DND Tavern/
  Characters/     <name>.md          frontmatter = character card + D&D sheet; body = notes
  Characters/avatars/<name>.png
  Lorebooks/      <book>.md          one H2 section per entry, keys in an inline field: `keys:: dragon, wyrm`
  Campaigns/<campaign>/
     Campaign.md                     setting, tone, house rules, linked lorebooks
     Party.md                        shared inventory, gold, quest log
     Sessions/2026-10-10 Session 01.md
     Images/
  Presets/        <preset>.md        system prompt / DM style presets
  NPCs/           <name>.md          generated or hand-written NPCs
```

- **Character note frontmatter:** `name, description, personality, scenario, first_mes, mes_example, system_prompt, avatar, tags`, plus a `dnd:` block containing `race, class, level, xp, hp, max_hp, temp_hp, ac, speed, str, dex, con, int, wis, cha, proficiency_bonus, skills[], saves[], inventory[], gold, spells[], spell_slots{}, conditions[]`.
- **Session note format:** each chat turn is a callout. The app must be able to read the note back into messages exactly as it wrote it (no loss in either direction), even after the user edits it in Obsidian.
  - `> [!player] Name` for the player
  - `> [!dm]` for the DM / LLM
  - `> [!roll]` for dice results
  - `> [!system]` for system notes
  - `> [!image]` for generated images
  - Store message IDs, swipes and metadata in an HTML comment at the end of each callout, e.g. `<!-- id:abc swipes:2 -->`.
- **SillyTavern import and export:** support V1/V2 JSON cards and PNG cards. For PNG cards, read the `chara` tEXt chunk and base64-decode it. Write each imported card to a Character note and save its avatar.

## UI design (it must look great)

**Visual direction:** a dark-fantasy look that is modern, not tacky. Think of a premium game launcher crossed with Obsidian's clean layout.

- **Colours:**
  - deep charcoal / ink background (`#121014`-ish)
  - warm parchment highlight for the narration text
  - a gold accent (`#c9a227`-ish) for primary actions
  - crimson for damage and HP
  - emerald for healing and success
- **Themes:** ship three themes and use CSS variables so it is easy to add more:
  - **Dark** (default)
  - **Parchment** (light)
  - **High contrast**
- **Fonts:** a serif display font for headings and DM narration (e.g. *Cinzel* for titles, *EB Garamond* or *Literata* for narration) and *Inter* for the interface. Bundle the fonts with the app; do not load them from a CDN.

**Custom window:** a frameless window with a custom title bar.
- The title bar has the app logo, the campaign name, the active-model chip, and minimise/maximise/close buttons that work with Windows 11 snap layouts. Use `titleBarOverlay` where it fits.
- Apply Mica/acrylic `backgroundMaterial` on Windows 11, with a fallback for Windows 10.
- Remember the window size and position between launches.

**Layout:** three panes whose widths you can drag to resize. Both side panes can be collapsed.
- **Left sidebar:**
  - campaign switcher at the top
  - characters with round avatar portraits and HP rings
  - sessions grouped by campaign
  - a search box
- **Centre:** the chat (see below).
- **Right panel:** tabs for the Sheet, Combat, Lore, Images and Extensions.
- **Settings** open as a full-screen overlay with a left-hand nav, not as a panel.

**Messages:**
- DM messages look like illuminated pages: a slightly lighter card with a subtle paper texture, a drop-cap on the first letter of a new scene, and the character's avatar.
- Player messages are compact, right-aligned bubbles.
- `[!roll]` results appear as small dice chips that flip in with animation (show critical hits in gold and fumbles in red).
- Images appear inline with a lightbox.

**Dice:**
- A dice tray button opens an animated roller with d4, d6, d8, d10, d12, d20 and d100 and an advantage/disadvantage toggle.
- Animations are 2D/CSS by default. 3D dice using three.js are an optional setting.

**Polish:**
- **Command palette:** `Ctrl+K` opens a palette for commands, characters, sessions and notes.
- **Keyboard shortcuts:** `Enter` sends, `Shift+Enter` adds a new line, `Ctrl+R` regenerates, `Alt+←/→` switches swipes, `Esc` stops generation.
- **Toasts** for errors, with a "copy details" button.
- **Skeleton loaders** while content loads, and **empty states with illustrations**: no characters yet, no backend configured.
- **Smooth transitions**, kept subtle. Turn them off when the system "reduce motion" setting is on.
- **Accessibility:** focus rings, ARIA labels, and contrast that meets WCAG AA in every theme.
- **Scaling:** a UI scale setting (90–130%) and a chat font size setting.

**First-run wizard** with four steps:
1. Welcome
2. Pick the Obsidian vault
3. Add a first text backend, with Test connection
4. Optionally add an image backend, then create or import a character

After the wizard, drop the user into a ready-to-play sample campaign, "The Sunken Lantern", generated into the vault.

## Chat UI

- Three-column layout, as described under UI design:
  - **Left:** characters, campaigns and sessions.
  - **Centre:** the chat.
  - **Right:** tabbed panels for the sheet, combat, lore, images and extensions. Settings open as a full-screen overlay.
- **Messages:** streaming, a stop button, regenerate, swipes (left/right between alternative replies), editing and deleting, continuing the last reply, and "fork session from here", which creates a new session note.
- **Header:** dropdowns to choose the persona or player name and to switch the active text backend and image backend at any time.
- **Input box:** slash commands with autocomplete.
- **Wikilinks:** `[[wikilinks]]` in messages are shown as links that open in Obsidian. The `/note <name>` command pulls any vault note into the context.
- **Prompt inspector:** shows the exact final payload sent to the backend, with API keys hidden.

## Prompt building

Assemble prompts in this order. Each block can be turned on or off, and the user can reorder blocks in settings.

1. Preset system prompt, including the **DM mode** instruction: narrate in second person, never roll for the player, and request checks using the format `[CHECK dex DC 14]`.
2. Character card.
3. Campaign note and party sheet.
4. **Lorebook entries** that are triggered by keywords found in the last N messages. Support entries that are always on, a priority, and a token budget.
5. A summary of the D&D sheet (HP, AC, stats with modifiers, conditions, inventory).
6. Combat state, if a fight is active.
7. Rolling session summary (memory), stored in the session note's frontmatter.
8. Chat history trimmed to fit the context budget, using a `chars / 4` estimate or a tokenizer chosen per backend.
9. Extension hooks.

## D&D mechanics (built in)

- **Dice:** `/roll 2d6+3`, `/roll 1d20 adv`, `/roll 4d6kh3`. Results are posted as `[!roll]` callouts and included in the context.
- **Checks and saves:**
  - `/check dex 15` and `/save wis 13` add the stat modifier, plus the proficiency bonus when the character is proficient.
  - When the DM writes `[CHECK <stat> DC <n>]`, show it as a "Roll it" button.
- **Combat tracker panel:**
  - Add combatants with `/add Goblin hp 7 ac 15 init +2`, roll initiative, step to the next or previous turn, apply damage or healing, and track conditions.
  - Save the combat state into the session note's frontmatter.
- **Sheet panel:** an editable sheet whose changes are written back to the character note's frontmatter. It also handles short and long rests, XP and level-ups, and spell slots.
- **Optional auto-state:** a toggle that asks the LLM to add a hidden block to its reply, such as `<state>{"hp":-4,"add_item":"rope"}</state>`.
  - The app applies those changes to the sheet.
  - It removes the block from the message the player sees.
  - It posts each change as a `[!system]` note with an Undo button.

## Settings (most important part)

Settings are stored **outside the vault**, in the app's `userData` folder (`%APPDATA%\DND Tavern\settings.json`). This keeps API keys out of Obsidian Sync, Git and cloud-synced vaults.

**API keys** are encrypted with Electron **`safeStorage`** (Windows DPAPI) and are never stored in plaintext.

The settings UI is a full-screen overlay with these sections.

### 1. Text backends
A list of backends: add, duplicate, delete, reorder, and set one as the default. Each backend has these settings:
- **Name and type:**
  - **OpenAI-compatible:** OpenAI, OpenRouter, Groq, Together, DeepSeek, vLLM, LM Studio, llama.cpp server, KoboldCpp `/v1`, TabbyAPI.
  - **Anthropic.**
  - **Ollama.**
  - **KoboldCpp (native API).**
  - **text-generation-webui.**
  - **Custom.**
- **Connection:**
  - Base URL: http or https, any host or port, so it can be remote.
  - API key.
  - Model, with a **Fetch models** button that calls `/models` or `/api/tags` where the backend supports it.
- **Network:**
  - Custom headers as key/value rows, for reverse proxies, Cloudflare Access service tokens or basic auth.
  - An optional HTTP/SOCKS proxy.
  - Option to accept a self-signed TLS certificate, off by default and with a warning.
  - Timeout and retry count.
- **Generation:**
  - Streaming on or off.
  - Temperature, top_p, top_k, min_p, repetition penalty, max tokens, context size and stop sequences.
  - **Extra body JSON** that is merged into every request.
- **Custom type:**
  - Request URL, HTTP method and a body template with placeholders: `{{system}}`, `{{messages_json}}`, `{{prompt}}`, `{{model}}`, `{{max_tokens}}`, `{{temperature}}`.
  - A JSONPath that points to the reply text, and an optional streaming parser (SSE, NDJSON or none).
  - This lets the user connect any API without writing new code.
- **Test connection:** a button that sends a tiny request and shows the response time, the first tokens, or the full error.
- **Fallback chain:** if the default backend fails, the app tries the next one in order.
- **Role assignment:** optionally use a different backend for chat, summaries/recaps, and image-prompt writing. For example, a cheap model for summaries and a strong one for chat.

### 2. Image backends
A list of backends with the same management features. Supported types:

**ComfyUI** (fully supported):
- **Connection:** base URL (remote allowed), auth headers, and an option to accept a self-signed certificate.
- **Workflow:** the user uploads or picks a workflow in **API format** (JSON). The workflow is stored in `%APPDATA%\DND Tavern\workflows\` or in the vault.
- **Node mapping:** a UI that lists the nodes in the workflow. For each of these values, the user picks the node ID and input name that receives it:
  - positive prompt
  - negative prompt
  - seed (random or fixed)
  - width and height
  - steps and CFG
  - checkpoint/model
  - an optional LoRA
- **Generation steps:**
  1. Send `POST /prompt` with `{prompt, client_id}`.
  2. Track progress over `ws(s)://host/ws?clientId=…` and show a progress bar. If the websocket isn't available, poll `GET /history/{prompt_id}` instead.
  3. Download the result with `GET /view?filename=&subfolder=&type=output`.
  4. Save the image to the campaign's `Images/` folder and embed it in the session note.
- **img2img:** upload a character avatar with `POST /upload/image` and use it as the source image.
- **Several workflows per ComfyUI backend:** for example "Portrait", "Scene" and "Map".

**Other types:**
- **Automatic1111 / Forge:** `/sdapi/v1/txt2img` and `/img2img`.
- **OpenAI-compatible images:** `/images/generations`.
- **Custom:** URL, body template, and a JSONPath that points to the image URL or base64 data.

**Settings shared by all image backends:** default size, steps, sampler, negative prompt, and a style prefix and suffix. Each image backend also has a **Test** button that generates a small image.

### 3. Image triggers
- **Commands:**
  - `/image <prompt>`
  - `/image scene`: the LLM writes an image prompt from the last N messages.
  - `/image portrait <character>`
- **Buttons:** a camera button on each message.
- **Automatic images:** optionally generate an image every N DM turns, or whenever the location changes.

### 4. Security
- **No listening port:** the app opens no network port by default. All communication between the UI and the main process goes over IPC.
- **Unsafe connections:** show a warning when a backend URL uses plain `http://` and is not localhost or a private or Tailscale address range.
- **API keys:**
  - Keys stay in the main process only and are never sent to the UI.
  - Never send them to the client, never log them, and hide them in the prompt inspector and in error messages.
  - Optionally read a key from an environment variable, e.g. `env:OPENROUTER_KEY`.
- **Import and export:** settings can be exported and imported. API keys are left out of the export unless the user explicitly ticks the option to include them.
- **Links in messages:** open external links in the default browser with `shell.openExternal`, and only `https:` and `obsidian:` links are allowed.

### 5. General
- Vault path, a "Browse/validate" button, and the root folder.
- Default character, campaign and preset.
- Player name.
- Prompt block order and on/off toggles.
- Context budget.
- How many recent messages to scan for lorebook keywords.
- How often to update the session summary.
- Date format for session file names.
- Appearance: theme, accent colour, UI scale, chat font size, reduce motion, 3D dice on or off.
- Behaviour: launch on startup, minimise to tray, and auto-update check (off by default).

## Extensions (plugin system)

- **Location:** extensions live in `%APPDATA%\DND Tavern\extensions\`, not in the vault. An "Open extensions folder" button opens it. Each extension is a folder with:
  - `extension.json`: id, name, version, description, permissions
  - `main.js` (optional): runs in the main process inside a restricted context (Node `vm`), with only the `ctx` API exposed
  - `ui.js` (optional): runs in the renderer to provide UI panels
- **Enabling:** extensions are **disabled by default**. When the user enables one, the app lists the permissions it requests (vault read/write, network, generate text, generate images) and asks for confirmation.
- **Each extension can provide:** commands, hooks, UI panels and its own settings.
- **Hooks:**
  - `onPromptBuild(blocks, ctx)` → blocks
  - `onBeforeSend(payload, ctx)`
  - `onResponse(text, ctx)` → text
  - `onMessageRender(el, msg, ctx)` (client only)
  - `onDiceRoll(result, ctx)`
  - `onSessionStart(ctx)`
- **`ctx` gives access to:**
  - the current session, character, campaign, sheet and settings
  - `post(role, text)`
  - `generateText(prompt, opts)` and `generateImage(prompt, opts)`
  - `roll(expr)`
  - `readNote(path)` and `writeNote(path, content)`, restricted to the root folder
  - `notify(msg)`
- **Example extensions to include** (they also serve as documentation):
  - **Weather & Time:** an in-world clock added to the prompt.
  - **Loot Generator:** `/loot cr 3`.
  - **NPC Generator:** creates an NPC note from a template.
  - **Session Recap:** `/recap` summarises the session into `Campaign.md`.
  - **Map Pins:** links locations to a map note.
- **Error handling:** errors are caught for each extension separately and shown with the extension's name. They never break the chat.

## Quality bar

- **Code:** TypeScript strict mode, organised as `src/main/`, `src/preload/`, `src/renderer/`, `src/shared/` (shared types, zod schemas and IPC contracts) and `extensions/` (bundled examples, copied to `userData` on first run).
- **Window and taskbar:** a single-instance lock, the window state is remembered, the app icon shows in the taskbar, and long generations show progress on the taskbar.
- **Tests (vitest):**
  - dice parsing
  - reading and writing the callout format, with no loss in either direction
  - frontmatter writes back to the vault
  - prompt assembly and lorebook triggering
  - ComfyUI node mapping
  - custom template rendering
  - the conflict check when a file changed on disk
- **README:**
  - setup steps for development, plus how to build the `.exe` with `npm run dist`
  - a note that unsigned builds trigger Windows SmartScreen, and how to sign the `.exe` with a code-signing certificate
  - how to point the app at a vault
  - backend examples: OpenRouter, a remote Ollama over Tailscale, and a remote ComfyUI behind a reverse proxy with Cloudflare Access headers
  - a guide to writing extensions
- **Build order** (get each step working before starting the next):
  1. Electron scaffold: frameless window, custom title bar, themes, typed IPC, and `npm run dist` producing a working `.exe` (prove packaging works on day one)
  2. Vault configuration, the vault reader/writer and watcher, and the first-run wizard
  3. Settings overlay with the text backend list, Test connection and `safeStorage` keys
  4. Chat with streaming and session notes
  5. Characters and SillyTavern import
  6. Lorebooks and prompt inspector
  7. D&D sheet, dice tray, checks and combat
  8. Image backends, including ComfyUI
  9. Extensions
  10. UI polish pass: animations, empty states, command palette and the sample campaign

Start by printing the file tree, the IPC contract, and the TypeScript interfaces for `TextBackend`, `ImageBackend`, `Message`, `Session`, `CharacterCard`, `DndSheet`, `VaultIndex` and `Extension`. Then implement step 1.
