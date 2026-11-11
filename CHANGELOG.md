# Changelog

## v2 (2026-11-11)

- Changed: fixes from the first real test (Windows, Chrome, Xbox controller
  on USB-C, plug-in keyboard). Bluetooth moves to v3.
- Fixed: Alt + numpad digits (Alt codes) were counted as key chatter. They
  are now listed as Alt codes and decoded where possible. The event log shows
  modifier keys.
- Fixed: "Reports/s" read 0 at rest on Windows. Renamed to "Input updates/s"
  with a note: Windows sends a new value only when an input changes.
- Changed: drift result now compares the rest offset with the Windows XInput
  default deadzone (xinput.h): left 0.240, right 0.265.
- Untested: Alt code decoding on the real keyboard.

## v1 (2026-11-11)

- Changed: first release. Node static server, Chrome page with Controller,
  Keyboard and Diagnostics tabs, JSON report export.
- Controller: live sticks, triggers, buttons, raw inputs, report rate, drift
  test, range test, trigger range test, software calibration (save, export,
  import), rumble (dual and trigger, capped at 1000 ms).
- Keyboard: full-size ANSI map, rollover, chatter, double-down detection,
  event log, full screen key capture.
- Untested: real Xbox One controller over USB-C, real keyboard. Tested with
  unit tests and a simulated controller in headless Chromium only.
  Bluetooth not started (v2).
