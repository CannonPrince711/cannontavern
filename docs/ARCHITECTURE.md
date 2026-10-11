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

Status: ✅ built in step 1 · ⏳ planned (step number in brackets).

```
cannontavern/
├─ electron.vite.config.ts          ✅ builds main, preload, renderer
├─ electron-builder.yml             ✅ NSIS installer + portable exe
├─ vitest.config.ts                 ✅
├─ components.json                  ✅ shadcn/ui config (npx shadcn add … works)
├─ build/                           ✅ icon.svg → icon.ico / icon.png (npm run icon)
├─ resources/icon.png               ✅ dev window icon
├─ scripts/make-icon.mjs            ✅
├─ extensions/                      ⏳ [9] bundled example extensions
├─ docs/ARCHITECTURE.md             ✅ this file
├─ tests/                           ✅ settings, atomic writes, redaction, IPC lists
└─ src/
   ├─ shared/
   │  ├─ types.ts                   ✅ Message, Session, CharacterCard, DndSheet, VaultIndex, Extension…
   │  ├─ settings.ts                ✅ zod: Settings, TextBackend, ImageBackend, secrets, patches
   │  ├─ ipc.ts                     ✅ InvokeMap / EventMap contract + preload allow-lists
   │  ├─ themes.ts                  ✅ native chrome colours per theme
   │  ├─ dice.ts                    ⏳ [7] dice expression parser/roller
   │  ├─ callouts.ts                ⏳ [4] session note ⇄ messages (lossless)
   │  ├─ prompt.ts                  ⏳ [6] prompt assembly, lorebook triggering
   │  └─ template.ts                ⏳ [3] {{placeholder}} rendering + JSONPath
   ├─ main/
   │  ├─ index.ts                   ✅ lifecycle, single-instance lock, wiring
   │  ├─ window.ts                  ✅ frameless window, overlay, Mica, saved bounds
   │  ├─ security.ts                ✅ navigation guards, link allow-list, permissions
   │  ├─ ipc.ts                     ✅ typed handle()/send(), sender check, zod args
   │  ├─ settings-store.ts          ✅ settings.json in userData, patches, public view
   │  ├─ secrets.ts                 ✅ safeStorage (DPAPI) encrypt/reveal, env: keys
   │  ├─ redact.ts                  ✅ masks secrets in errors/logs/inspector
   │  ├─ atomic.ts                  ✅ temp-file + rename writes
   │  ├─ errors.ts                  ✅ AppError → ErrorInfo
   │  ├─ paths.ts                   ✅
   │  ├─ handlers/app.ts            ✅ app:*, window:*
   │  ├─ handlers/settings.ts       ✅ settings:get/update
   │  ├─ vault/                     ⏳ [2] reader/writer, conflict check, chokidar watcher, index
   │  ├─ backends/text/             ⏳ [3] openai, anthropic, ollama, kobold, textgen, custom
   │  ├─ backends/image/            ⏳ [8] comfyui, a1111, openai, custom
   │  ├─ http.ts                    ⏳ [3] undici client: proxy, headers, self-signed, retries
   │  ├─ chat.ts                    ⏳ [4] generation orchestration + streaming
   │  ├─ import/sillytavern.ts      ⏳ [5] V1/V2 JSON + PNG cards
   │  └─ extensions/                ⏳ [9] loader, vm sandbox, ctx API
   ├─ preload/
   │  ├─ index.ts                   ✅ window.api bridge
   │  └─ index.d.ts                 ✅
   └─ renderer/
      ├─ index.html                 ✅ strict CSP
      └─ src/
         ├─ main.tsx, App.tsx       ✅
         ├─ styles/globals.css      ✅ themes as CSS variables, fonts, utilities
         ├─ lib/ipc.ts              ✅ typed invoke()/on(), IpcError
         ├─ stores/app.ts           ✅ app info, settings, window state
         ├─ stores/layout.ts        ✅ pane collapse, right tab
         ├─ hooks/useAppearance.ts  ✅ theme/scale/motion → <html>
         ├─ components/ui/          ✅ button, tooltip, dropdown-menu, tabs (shadcn style)
         ├─ components/TitleBar.tsx ✅
         ├─ components/layout/      ✅ AppShell (resizable panes), LeftSidebar, ChatPane, RightPanel
         ├─ components/wizard/      ⏳ [2] first-run wizard
         ├─ components/settings/    ⏳ [3] full-screen settings overlay
         ├─ components/chat/        ⏳ [4] messages, composer, slash commands
         ├─ components/sheet/       ⏳ [7] sheet, combat, dice tray
         └─ components/palette/     ⏳ [10] Ctrl+K command palette
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
| `app:` `window:` | getInfo, openExternal (https/obsidian only), openFolder, minimize, toggleMaximize, close, getState |
| `settings:` | get, update (patch), export, import |
| `textBackends:` `imageBackends:` | save, delete, duplicate, reorder, test, fetchModels (text) |
| `comfy:` | importWorkflow, inspectWorkflow |
| `vault:` | detect, pick, validate, configure, getIndex, readNote, searchNotes, openInObsidian, createSampleCampaign, readImage |
| `characters:` | get, save, create, delete, import, export |
| `campaigns:` `lorebooks:` | get, create, saveParty / get, save |
| `sessions:` | get, create, fork, post, updateMessage, deleteMessage, saveCombat, undoState |
| `chat:` | send, regenerate, continue, stop, inspectPrompt |
| `images:` | generate, cancel |
| `extensions:` | list, setEnabled, runCommand, saveSettings |
| **events** | settings:changed, window:state, toast, vault:index, vault:changed, session:updated, chat:started/token/done/error, images:progress/done/error, extensions:notify |

## Secrets

A secret has three shapes (see `src/shared/settings.ts`):

| Shape | Where | Variants |
|---|---|---|
| `SecretStored` | settings.json | `none`, `plain` (non-secret headers), `encrypted` (safeStorage, base64), `env` |
| `SecretView` | renderer | `none`, `plain`, `stored` (no value!), `env` |
| `SecretInput` | renderer → main | `none`, `plain`, `set` (encrypt this), `keep`, `env` |

Backend schemas are built by a factory per shape, so the renderer's types make it
impossible to read a stored key.
