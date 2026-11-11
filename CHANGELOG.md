# Changelog

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
