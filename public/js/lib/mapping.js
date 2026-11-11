// W3C "standard" gamepad mapping, with Xbox names.
// https://w3c.github.io/gamepad/#remapping

export const BUTTONS = [
  { i: 0, name: 'A' },
  { i: 1, name: 'B' },
  { i: 2, name: 'X' },
  { i: 3, name: 'Y' },
  { i: 4, name: 'LB' },
  { i: 5, name: 'RB' },
  { i: 6, name: 'LT', analog: true },
  { i: 7, name: 'RT', analog: true },
  { i: 8, name: 'View' },
  { i: 9, name: 'Menu' },
  { i: 10, name: 'LS click' },
  { i: 11, name: 'RS click' },
  { i: 12, name: 'D-pad Up' },
  { i: 13, name: 'D-pad Down' },
  { i: 14, name: 'D-pad Left' },
  { i: 15, name: 'D-pad Right' },
  { i: 16, name: 'Xbox', optional: true },
];

export const AXES = [
  { i: 0, name: 'Left X' },
  { i: 1, name: 'Left Y' },
  { i: 2, name: 'Right X' },
  { i: 3, name: 'Right Y' },
];

/**
 * Default deadzones from Microsoft's xinput.h. Windows games that use XInput
 * commonly ignore stick movement inside these radii. Values are converted
 * from the 16-bit stick range (32767) and the 8-bit trigger range (255).
 *   XINPUT_GAMEPAD_LEFT_THUMB_DEADZONE  7849
 *   XINPUT_GAMEPAD_RIGHT_THUMB_DEADZONE 8689
 *   XINPUT_GAMEPAD_TRIGGER_THRESHOLD    30
 */
export const XINPUT_DEADZONE = {
  left: 7849 / 32767,
  right: 8689 / 32767,
  trigger: 30 / 255,
};

/** Classify a resting stick offset against the user limit and the XInput default deadzone. */
export function driftVerdict(offset, limit, xinputDeadzone) {
  if (offset <= limit) return { level: 'ok', text: 'OK' };
  if (offset < xinputDeadzone) return { level: 'warn', text: 'Drift, inside Windows default deadzone' };
  return { level: 'bad', text: 'Drift, outside Windows default deadzone' };
}

/** Buttons that must be pressed for the button test to pass. */
export const REQUIRED_BUTTONS = BUTTONS.filter((b) => !b.optional).map((b) => b.i);

/**
 * Check a gamepad snapshot and return warnings the user should see.
 * gp: {id, mapping, axes: [], buttons: []}
 */
export function checkGamepad(gp) {
  const warnings = [];
  if (gp.mapping !== 'standard') {
    warnings.push(
      'Chrome did not apply the standard mapping to this controller. Button and stick names may be wrong. Use the Raw inputs panel to see what each input does.'
    );
  }
  if (gp.axes.length < 4) {
    warnings.push(`Only ${gp.axes.length} axes reported. A standard Xbox controller reports 4.`);
  }
  if (gp.buttons.length < 16) {
    warnings.push(`Only ${gp.buttons.length} buttons reported. A standard Xbox controller reports 16 or 17.`);
  }
  if (!/xbox|xinput|045e|microsoft/i.test(gp.id)) {
    warnings.push('The device name does not look like a Microsoft or Xbox controller. Tests still run.');
  }
  return warnings;
}

/** Copy the live Gamepad object into plain data (Gamepad objects are live in some browsers). */
export function snapshot(gp) {
  return {
    id: gp.id,
    index: gp.index,
    mapping: gp.mapping,
    connected: gp.connected,
    timestamp: gp.timestamp,
    axes: Array.from(gp.axes),
    buttons: Array.from(gp.buttons, (b) => ({ pressed: b.pressed, touched: b.touched, value: b.value })),
  };
}
