# Architecture

DND Tavern is an Electron app with three processes' worth of code and one
source of truth: the Obsidian vault.

- **Main** (`src/main/`): everything with system access: vault I/O and the
  watcher, every HTTP call to text/image backends, settings and `safeStorage`
  keys, extensions.
- **Preload** (`src/preload/`): a ~30-line bridge. It exposes `window.api` with
  `invoke()` and `on()` and forwards only the channels listed in
  `src/shared/ipc.ts`.
- **Renderer** (`src/renderer/`): React UI only. It never sees an API key.
- **Shared** (`src/shared/`): domain types, zod settings schemas, the IPC
  contract and theme metadata.

## File tree

```
cannontavern/
├─ electron.vite.config.ts          builds main, preload, renderer (main bundles its deps)
├─ electron-builder.yml             NSIS installer + portable exe; ships extensions/ and the tray icon
├─ vitest.config.ts
├─ components.json                  shadcn/ui config
├─ build/, resources/, scripts/     icon sources and generator (npm run icon)
├─ extensions/                      bundled examples: weather-time, loot-generator, npc-generator, session-recap, map-pins
├─ TestVault/                       small Obsidian vault for development
├─ docs/ARCHITECTURE.md             this file
├─ tests/                           vitest: settings, vault, callouts, prompt, recaps, dice, backends, ComfyUI, sandbox…
└─ src/
   ├─ shared/                       pure logic and types used by both processes
   │  ├─ types.ts                   Message, Session, CharacterCard, DndSheet, VaultIndex, Extension…
   │  ├─ settings.ts                zod: Settings, TextBackend, ImageBackend, secrets, patches, extension manifest
   │  ├─ world.ts                   per-world overrides (Campaign.md `world:`), applyWorld, validating model suggestions
   │  ├─ ipc.ts                     InvokeMap / EventMap contract + preload allow-lists
   │  ├─ callouts.ts                session note ⇄ messages (lossless, surgical edits)
   │  ├─ prompt.ts                  prompt assembly, block order, lorebook triggering
   │  ├─ recap.ts                   session compression helpers (previous sessions, chunking, rendering)
   │  ├─ play.ts                    play modes (AI DM / you as DM / AI only), who speaks next
   │  ├─ editions.ts                5e and 3.5e: 3.5 skills, saves, XP, conditions, sourcebooks, rules line
   │  ├─ builder.ts                 campaign builder: concept, draft schema, prompt, notes from a draft
   │  ├─ map.ts                     campaign maps: pins, party marker, scale, layout
   │  ├─ graph.ts                   note graph: wikilink resolution, mentions, neighbourhoods
   │  ├─ table.ts                   multiplayer protocol and what players may see
   │  ├─ tips.ts                    static tips and AI idea parsing
   │  ├─ dice.ts, checks.ts         dice expressions, checks and saves
   │  ├─ combat.ts, sheet.ts        initiative tracker, sheet changes, rests, level-up
   │  ├─ notes.ts, layout.ts        note normalisers, vault folder layout
   │  ├─ template.ts, streams.ts    {{placeholder}} + JSONPath, SSE/NDJSON parsers
   │  └─ names.ts, net.ts, presets.ts, themes.ts, version.ts
   ├─ main/
   │  ├─ index.ts                   lifecycle, single-instance lock, wiring
   │  ├─ window.ts, tray.ts         frameless window (overlay, Mica, saved bounds), optional tray icon
   │  ├─ security.ts                navigation guards, link allow-list, permissions
   │  ├─ ipc.ts, errors.ts          typed handle()/send(), sender check, zod args, AppError
   │  ├─ settings-store.ts          settings.json in userData, patches, public view
   │  ├─ secrets.ts, redact.ts      safeStorage (DPAPI / Linux keyring) and env: keys; masking in errors/logs
   │  ├─ atomic.ts, paths.ts, http.ts  atomic writes; undici client with proxy, headers, retries
   │  ├─ vault/                     reader/writer with conflict checks, watcher, index, vault:// protocol
   │  ├─ library.ts, sessions.ts    characters, campaigns, lorebooks, presets; session notes
   │  ├─ chat.ts                    generation, streaming, fallback chain, rolling summary, auto-state
   │  ├─ recap.ts                   session compression when a session ends
   │  ├─ builder.ts, maps.ts        campaign builder; map notes, map images, AI map painting
   │  ├─ graph.ts, tips.ts          note graph for the graph view; AI ideas for the tips bubble
   │  ├─ table/host.ts              multiplayer host: HTTP + WebSocket server for the player page
   │  ├─ updater.ts                 in-app updates (electron-updater, GitHub Releases)
   │  ├─ autostart.ts               start with the computer (login items; ~/.config/autostart on Linux)
   │  ├─ backends/context.ts        asks self-hosted servers for their real context window
   │  ├─ context-menu.ts            native right-click menus
   │  ├─ images.ts                  image jobs, auto-illustration
   │  ├─ world.ts, world-suggest.ts settings as a campaign sees them; "pick best for this world"
   │  ├─ world-resources.ts         "generate resources for this world" lorebooks
   │  ├─ resources.ts               shared Resources folder (starter lore, shared images)
   │  ├─ backends/text/             openai, anthropic, ollama, kobold, textgen, custom
   │  ├─ backends/image/            comfyui (workflows, websocket progress, uploads), a1111, openai, custom
   │  ├─ import/                    SillyTavern V1/V2 JSON + PNG cards
   │  ├─ extensions/                loader, vm sandbox, ext:// panels
   │  ├─ sample.ts                  sample campaign
   │  └─ handlers/                  one file per IPC namespace
   ├─ preload/                      window.api bridge
   └─ renderer/src/
      ├─ App.tsx, styles/           themes as CSS variables, fonts, prose styles
      ├─ stores/                    zustand: app, vault, chat, ui, layout, dice, images, extensions, toasts
      ├─ lib/                       typed IPC, slash commands, dice/combat helpers
      ├─ player/                    the player page served to browsers by the multiplayer host
      └─ components/
         ├─ layout/                 AppShell (resizable panes), LeftSidebar, ChatPane, RightPanel
         ├─ chat/                   messages, composer, prompt inspector, "Previously" recap card
         ├─ wizard/                 first-run setup
         ├─ settings/               full-screen settings overlay
         ├─ characters/, lore/      editors
         ├─ sheet/, dice/           character sheet, combat, 3D dice
         ├─ images/, extensions/    gallery, lightbox, extension panels
         ├─ builder/                campaign builder and campaign settings
         ├─ map/, graph/            campaign map and mini-map; graph view
         ├─ table/                  multiplayer Table tab and DM screen
         ├─ ModelSwitcher.tsx       text and image model pickers
         ├─ CommandPalette.tsx      Ctrl+K
         └─ ui/                     shadcn-style primitives
```

## IPC contract

Defined once in [`src/shared/ipc.ts`](../src/shared/ipc.ts):

- `InvokeMap`: request/response channels, each `{ args: [...]; result: T }`.
  Calls return an `IpcResult<T>` envelope (`{ok:true,data}` or
  `{ok:false,error:{code,message,detail}}`) because `contextBridge` drops
  custom fields from thrown errors. The renderer's `invoke()` unwraps it and
  throws `IpcError`.
- `EventMap`: push events from main (streamed tokens, vault changes, toasts…).
- `INVOKE_CHANNELS` / `EVENT_CHANNELS`: runtime allow-lists, checked against
  the maps at compile time with `satisfies`, so a channel can't be added to
  one place and forgotten in the other.

Main-side handlers are registered with `handle(channel, fn, zodTupleSchema?)`,
which rejects senders other than our own renderer page, validates arguments,
and redacts secrets from error messages.

| Namespace | Channels |
|---|---|
| `app:` `window:` | getInfo, openExternal (https/obsidian only), openFolder, contextMenu, minimize, toggleMaximize, close, getState |
| `settings:` | get, update (patch), export, import |
| `textBackends:` `imageBackends:` | save, delete, duplicate, reorder, test, models, use, fetchModels (text) |
| `comfy:` | importWorkflow, inspectWorkflow |
| `vault:` | detect, pick, validate, configure, getIndex, graph, readNote, searchNotes, openInObsidian, createSampleCampaign, readImage |
| `characters:` | get, save, create, delete, import, export, setAvatar, updateSheet |
| `campaigns:` `lorebooks:` `presets:` | get, create, update, draft, build, saveParty, setLorebooks / get, create, save / get, create, save |
| `maps:` | get, save, importImage, images, generate |
| `table:` | start, stop, status, kick, setAutoRespond, setSession, openScreen |
| `updates:` | status, check, download, install |
| `sessions:` | get, create, fork, post, updateMessage, deleteMessage, updateMeta, saveCombat, undoState, compress, recaps |
| `chat:` | send, regenerate, continue, stop, inspectPrompt, ideas |
| `images:` | generate, cancel |
| `extensions:` | list, setEnabled, runCommand, saveSettings, reload, uiState |
| **events** | settings:changed, window:state, toast, vault:index, vault:changed, session:updated, chat:started/token/done/error, images:progress/done/error, extensions:notify, updates:changed, table:changed |

## Secrets

A secret has three shapes (see `src/shared/settings.ts`):

| Shape | Where | Variants |
|---|---|---|
| `SecretStored` | settings.json | `none`, `plain` (non-secret headers), `encrypted` (safeStorage, base64), `env` |
| `SecretView` | renderer | `none`, `plain`, `stored` (no value!), `env` |
| `SecretInput` | renderer → main | `none`, `plain`, `set` (encrypt this), `keep`, `env` |

Backend schemas are built by a factory per shape, so the renderer's types make it
impossible to read a stored key.
