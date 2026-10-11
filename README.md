# DND Tavern

A Windows desktop chat frontend, in the style of SillyTavern, for running D&D-style text
adventures with LLMs. Everything it creates (characters, lorebooks, campaigns,
session logs, character sheets, images) is stored as Markdown and image files in
an **Obsidian vault**, so you can browse and edit the same notes in Obsidian
while you play.

> **Status:** step 1 of 10. The shell is done: frameless window, custom title bar,
> themes, typed IPC and packaging. Vault storage, backends and chat come next. See
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full plan.

## Development

Requirements: Node.js 22+ and Windows 10/11.

```bash
npm install
npm run dev        # hot-reloading dev build
npm test           # vitest
npm run typecheck
```

npm 11 blocks dependency install scripts by default. The ones this project
needs are already approved in `package.json` (`allowScripts`). Electron
downloads its binary the first time it runs.

Dev runs store their data in `%APPDATA%\DND Tavern (dev)\`, so they never
interfere with an installed copy, which uses `%APPDATA%\DND Tavern\`.

## Building the .exe

```bash
npm run dist
```

This writes two files to `dist/`:

- `DND Tavern Setup x.y.z.exe`: an installer with Start Menu and desktop shortcuts and an uninstaller
- `DND Tavern x.y.z.exe`: a portable build that runs without installing

`npm run dist:dir` builds only the unpacked app (`dist/win-unpacked/`), which
is faster when testing packaging.

### Windows SmartScreen and code signing

Unsigned builds trigger a SmartScreen warning ("Windows protected your PC").
Click **More info → Run anyway**. To get rid of the warning, sign the build with
a code-signing certificate. electron-builder signs automatically when these
environment variables are set:

```powershell
$env:CSC_LINK = "C:\path\to\certificate.pfx"   # or a base64 string
$env:CSC_KEY_PASSWORD = "certificate password"
npm run dist
```

EV certificates build SmartScreen reputation immediately. Standard (OV)
certificates build it over time as more people download the app. For
cloud-HSM certificates (e.g. Azure Trusted Signing), see electron-builder's
`win.azureSignOptions`.

### Changing the icon

Edit `build/icon.svg`, then run `npm run icon` to regenerate `build/icon.ico`,
`build/icon.png` and `resources/icon.png`.

## Where data lives

| What | Where |
|---|---|
| Characters, campaigns, sessions, lorebooks, images | your vault, under `DND Tavern/` (configurable) |
| Settings, encrypted API keys | `%APPDATA%\DND Tavern\settings.json` |
| ComfyUI workflows | `%APPDATA%\DND Tavern\workflows\` (or the vault) |
| Extensions | `%APPDATA%\DND Tavern\extensions\` |

Settings are kept out of the vault on purpose, so API keys never end up in
Obsidian Sync, Git or a cloud-synced folder. Keys are encrypted with Windows DPAPI
through Electron's `safeStorage`.

## Themes

The app has three built-in themes: **Dark** (the default), **Parchment** and
**High contrast**. A theme is a block of CSS variables in
`src/renderer/src/styles/globals.css` plus an entry in `src/shared/themes.ts`,
which sets the native title bar colours.
