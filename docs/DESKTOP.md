# Desktop mode v1 (branch `desktop-mode`)

Use the Xbox controller as a mouse and the chatpad as a keyboard on Windows,
with settings in a web page. Pause it with one button combo when you start a
game.

Status: **untested on real Windows hardware.** The logic has unit tests and
the helper compiles under the C# 5 compiler that Windows PowerShell 5.1 uses.
Struct sizes match 64-bit Windows. Test it and send the result.

## How it works

```
controller --XInput--> helper.ps1 --stdout--> Node engine --stdin--> helper.ps1 --SendInput--> Windows
```

- `desktop/helper.ps1`: PowerShell 5.1 + inline C#. Reads the controller
  with XInput, sends mouse and key input with SendInput. No logic.
- `desktop/engine.js`: all mapping logic (deadzone, curve, buttons, repeat,
  pause combo). Unit tested.
- `desktop/manager.js`: starts and stops the helper, saves settings.
- `server.js`: local API for the settings page (`/api/desktop/*`).
- `public/desktop.html`: settings page.

The chatpad already types as a keyboard in Windows. Desktop mode does not
change it.

## Start

1. Open a terminal in the repo folder on the Windows PC.
2. Switch to this branch.

   ```bash
   git checkout desktop-mode
   ```

3. Start the server with desktop mode on.

   ```bash
   npm run desktop
   ```

4. Open `http://127.0.0.1:3100/desktop.html` in Chrome to change settings.
5. Move the left stick. The pointer moves.

Notes:
- `npm start` starts the server without desktop mode. Start it from the page.
- Ctrl+C in the terminal stops everything and releases all keys and buttons.
- Windows may show a security prompt the first time PowerShell runs the
  helper. The helper runs with `-ExecutionPolicy Bypass` for that one file
  only. It does not change your system policy.

## Default controls

| Input | Action |
|---|---|
| Left stick | Pointer |
| Right stick | Scroll (vertical and horizontal) |
| A | Left click (hold to drag) |
| B | Right click |
| X | Enter |
| Y | Escape |
| LB / RB | Browser back / forward |
| LT (hold) | Precision: slow pointer |
| RT | Nothing |
| View (tap) | Task view (Win+Tab) |
| Menu (tap) | Start (Win) |
| Left stick click | Middle click |
| D-pad | Arrow keys (repeat while held) |
| **Hold View + Menu 1 s** | **Pause / resume desktop mode** |

Every input can be changed on the settings page. Other actions in the list:
on-screen keyboard (Win+Ctrl+O), show desktop, Alt+Tab, copy, paste, undo,
volume, media keys, or any custom combo such as `key:Ctrl+Shift+T`.

## Safety

- Hold View + Menu to pause before you play a game. Paused = no input is sent.
- Every held key and mouse button is released when: you pause, the controller
  disconnects, you press Stop, you stop the server, or Node crashes (the helper
  sees its input close and releases everything).
- The settings API answers only requests from this PC's own page: host must
  be 127.0.0.1 or localhost, and a custom header is required, so other web
  sites cannot call it.
- Rumble on pause and resume is capped at 250 ms.

## Known limits

- Windows only. The tester (main page) still works on every system.
- Windows does not let a normal program send input to a window that runs as
  administrator. To control admin windows, run the terminal as administrator.
- The Xbox button is not readable through XInput, so it cannot be mapped.
- "Enhance pointer precision" in Windows mouse settings also changes pointer
  speed. Turn it off for a straight speed response (optional).
- Antivirus software may warn about a script that sends input (unverified).
