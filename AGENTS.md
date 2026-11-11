# AGENTS.md: guide for developers and AI coding agents

## What this is

ControllerBench is a browser page that tests an Xbox One controller and a USB
keyboard. A small Node.js static server (no framework, no dependencies) serves
`public/`. All device access happens in Chrome through the Gamepad API and
KeyboardEvent.

## Commands

```bash
npm start   # server on http://127.0.0.1:3100 (HOST, PORT env)
npm test    # node --test (must pass on Node 18 and 22)
```

## Hard rules

1. **No firmware writes.** Do not add WebUSB, WebHID or WebSerial writes to
   the controller or keyboard. Calibration is software only (browser storage).
2. **Rumble is capped.** Max 1000 ms per effect. Keep the Stop button.
3. **Server stays read-only.** It serves files from `public/` only, GET and
   HEAD only, with path traversal checks. Default bind is `127.0.0.1`.
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
| `public/js/keyboard.js` | Keyboard tab: key map, log, key lock. |
| `public/js/diagnostics.js` | Browser checks and error list. |
| `public/js/lib/stats.js` | Pure math: drift stats, range recorder, rate meter. |
| `public/js/lib/calibration.js` | Pure: apply, sanitize, suggest, load/save calibration. |
| `public/js/lib/keytracker.js` | Pure: rollover, chatter, double-down detection. |
| `public/js/lib/mapping.js` | Standard mapping names, gamepad checks, snapshot. |
| `public/js/lib/layout.js` | ANSI keyboard layout by `KeyboardEvent.code`. |
| `test/*.test.js` | Node tests for `lib/` and the server. |

Code in `public/js/lib/` must not touch the DOM. Tests import it directly.

## Versions

Bump `VERSION` in `public/js/app.js`, `version` in `package.json` and add a
`CHANGELOG.md` entry for each release (v1, v2, v3...).
