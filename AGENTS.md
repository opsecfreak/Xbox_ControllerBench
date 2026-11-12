# AGENTS.md: guide for developers and AI coding agents

## What this is

ControllerBench is a browser page that tests an Xbox One controller and a USB
keyboard. A small Node.js static server (no framework, no dependencies) serves
`public/`. All device access happens in Chrome through the Gamepad API and
KeyboardEvent.

## Commands

Branch `desktop-mode` adds desktop mode (controller as mouse and keyboard on
Windows). See [docs/DESKTOP.md](docs/DESKTOP.md). `main` stays the tester only.

```bash
npm start   # server on http://127.0.0.1:3100 (HOST, PORT env)
npm run desktop   # same, and start desktop mode (Windows; CONTROLLERBENCH_DATA env for settings folder)
npm test    # node --test (must pass on Node 18 and 22)
```

## Hard rules

1. **No firmware writes.** Do not add WebUSB, WebHID or WebSerial writes to
   the controller or keyboard. Calibration is software only (browser storage).
2. **Rumble is capped.** Max 1000 ms per effect. Keep the Stop button.
3. **Server stays local.** Static files from `public/` only, GET and HEAD,
   with path traversal checks. Default bind is `127.0.0.1`. The only other
   routes are `/api/desktop/*`, and every API request must pass
   `isLocalRequest` (local Host, local Origin, `X-ControllerBench: 1`).
7. **Desktop mode must always release.** Every path that stops sending
   input (pause, disconnect, stop, crash, settings change) releases all held
   keys and mouse buttons. The helper has no logic; logic goes in
   `desktop/engine.js` with tests. Helper C# must compile as C# 5 (Windows
   PowerShell 5.1): no `$""`, `?.`, `=>` members or `out var`.
4. **No invented specs.** Thresholds (drift limit, chatter limit) are user
   settings. Label them as such. Do not call them factory specs.
5. **No secrets** in code or docs.
6. **No Docker.** Plain Node.

## Code map

| File | Job |
|---|---|
| `server.js` | Static file server. Exports `createServer`, `resolvePath`. |
| `public/index.html` | Page layout. Three tabs. |
| `public/css/app.css` | Styles, light and dark. |
| `public/js/errors.js` | Classic script. Collects page errors for Diagnostics. |
| `public/js/app.js` | Entry: tabs, report export, `VERSION`. |
| `public/js/controller.js` | Controller tab: render loop, tests, calibration UI, rumble. |
| `public/js/keyboard.js` | Keyboard tab: key map, log, key lock, layout switch. |
| `public/js/chatpad-ui.js` | Chatpad layout: test and learn chatpad keys. |
| `public/js/diagnostics.js` | Browser checks and error list. |
| `public/js/lib/stats.js` | Pure math: drift stats, range recorder, rate meter. |
| `public/js/lib/calibration.js` | Pure: apply, sanitize, suggest, load/save calibration. |
| `public/js/lib/keytracker.js` | Pure: rollover, chatter, double-down detection. |
| `public/js/lib/mapping.js` | Standard mapping names, gamepad checks, snapshot. |
| `public/js/lib/layout.js` | ANSI keyboard layout by `KeyboardEvent.code`. |
| `public/js/lib/chatpad.js` | Pure: chatpad layout, key matching, learning. |
| `docs/images/` | README images (controller diagram SVG, chatpad photo). |
| `desktop/config.js` | Pure: desktop settings, defaults, action parser, VK codes. |
| `desktop/engine.js` | Pure: controller state to mouse/key commands; helper line protocol. |
| `desktop/manager.js` | Starts the helper, runs the engine, saves settings. |
| `desktop/helper.ps1` | Windows helper: XInput in, SendInput out. |
| `desktop/testing/fake-helper.mjs` | Fake helper for tests. |
| `public/desktop.html`, `public/js/desktop-page.js` | Desktop mode settings page. |
| `test/*.test.js` | Node tests for `lib/` and the server. |

Code in `public/js/lib/` must not touch the DOM. Tests import it directly.

## Versions

Bump `VERSION` in `public/js/app.js`, `version` in `package.json` and add a
`CHANGELOG.md` entry (`## vN (date)`) for each release (v1, v2, v3...).
After the PR is merged, push a `vN` tag on `main`, or run the `release`
workflow from the Actions tab with tag `vN`.
`.github/workflows/release.yml` runs the tests and publishes the GitHub
release with that CHANGELOG section as notes. For the `desktop-mode` branch
use tag `desktop-vN`, a `## desktop-vN (date)` CHANGELOG heading on that
branch, and run the workflow on ref `desktop-mode`. It is published as a
pre-release.

License: MIT ([LICENSE](LICENSE)). Keep the Microsoft trademark note in the
README.
