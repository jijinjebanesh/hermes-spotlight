# Hermes Spotlight

Hermes Spotlight is a compact Windows assistant overlay inspired by macOS Spotlight. Press **Ctrl+Space** to open it, ask Hermes a question, attach context, and return to work.

## Requirements

- Windows 10 or 11
- Node.js 20.19 or newer for development
- Hermes Agent installed and available as `hermes` on `PATH`

The app reads Hermes configuration and session data from `%LOCALAPPDATA%\hermes` (or `HERMES_HOME` when set). Spotlight preferences are stored separately in `%APPDATA%\Hermes Spotlight`.

## Run from source

```powershell
npm ci
npm run dev
```

## Build and checks

```powershell
npm test
npm run build:all
npm start
```

The build creates the Electron main process in `dist-electron` and the renderer in `dist`. The Hermes connection uses the installed CLI's `chat --format stream-json` protocol for streamed text, tool calls, clarification cards, session IDs, token counts, and completion status.

## Start with Windows

`scripts/start-hermes.ps1` starts the Hermes gateway if it is not already running, then launches Hermes Spotlight hidden. `scripts/start-hermes.vbs` runs the script without a console window.

Register it in the current user's Startup folder:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-startup.ps1 -RemoveLegacy
```

`-RemoveLegacy` removes the superseded `hermes-overlay` startup entries and the old `electron.app.Electron` Run value. Use `-Uninstall` to remove the startup entry. Logs are written to `%LOCALAPPDATA%\Hermes Spotlight\logs\startup.log`.

## Shortcuts

- **Ctrl+Space**: Open or hide the overlay. If another app owns it, the app tries **Ctrl+Alt+Space**.
- **Ctrl+Shift+R**: Reset the overlay position.
- **Escape**: Close the current panel or mode.

Use the settings panel to change the global shortcut, theme, accent color, provider, and model.
