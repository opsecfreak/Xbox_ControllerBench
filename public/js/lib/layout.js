// Full-size ANSI keyboard layout, keyed by KeyboardEvent.code.
// w = width in key units. gap = empty space before the key, in key units.
// Keys that are not in this layout still show in the "Other keys" list.

const k = (code, label, w = 1, gap = 0) => ({ code, label, w, gap });

export const MAIN = [
  [
    k('Escape', 'Esc'),
    k('F1', 'F1', 1, 1), k('F2', 'F2'), k('F3', 'F3'), k('F4', 'F4'),
    k('F5', 'F5', 1, 0.5), k('F6', 'F6'), k('F7', 'F7'), k('F8', 'F8'),
    k('F9', 'F9', 1, 0.5), k('F10', 'F10'), k('F11', 'F11'), k('F12', 'F12'),
  ],
  [
    k('Backquote', '`'), k('Digit1', '1'), k('Digit2', '2'), k('Digit3', '3'), k('Digit4', '4'),
    k('Digit5', '5'), k('Digit6', '6'), k('Digit7', '7'), k('Digit8', '8'), k('Digit9', '9'),
    k('Digit0', '0'), k('Minus', '-'), k('Equal', '='), k('Backspace', 'Backspace', 2),
  ],
  [
    k('Tab', 'Tab', 1.5), k('KeyQ', 'Q'), k('KeyW', 'W'), k('KeyE', 'E'), k('KeyR', 'R'),
    k('KeyT', 'T'), k('KeyY', 'Y'), k('KeyU', 'U'), k('KeyI', 'I'), k('KeyO', 'O'),
    k('KeyP', 'P'), k('BracketLeft', '['), k('BracketRight', ']'), k('Backslash', '\\', 1.5),
  ],
  [
    k('CapsLock', 'Caps', 1.75), k('KeyA', 'A'), k('KeyS', 'S'), k('KeyD', 'D'), k('KeyF', 'F'),
    k('KeyG', 'G'), k('KeyH', 'H'), k('KeyJ', 'J'), k('KeyK', 'K'), k('KeyL', 'L'),
    k('Semicolon', ';'), k('Quote', "'"), k('Enter', 'Enter', 2.25),
  ],
  [
    k('ShiftLeft', 'Shift', 2.25), k('KeyZ', 'Z'), k('KeyX', 'X'), k('KeyC', 'C'), k('KeyV', 'V'),
    k('KeyB', 'B'), k('KeyN', 'N'), k('KeyM', 'M'), k('Comma', ','), k('Period', '.'),
    k('Slash', '/'), k('ShiftRight', 'Shift', 2.75),
  ],
  [
    k('ControlLeft', 'Ctrl', 1.25), k('MetaLeft', 'Win', 1.25), k('AltLeft', 'Alt', 1.25),
    k('Space', 'Space', 6.25), k('AltRight', 'Alt', 1.25), k('MetaRight', 'Win', 1.25),
    k('ContextMenu', 'Menu', 1.25), k('ControlRight', 'Ctrl', 1.25),
  ],
];

export const NAV = [
  [k('PrintScreen', 'PrtSc'), k('ScrollLock', 'ScrLk'), k('Pause', 'Pause')],
  [k('Insert', 'Ins'), k('Home', 'Home'), k('PageUp', 'PgUp')],
  [k('Delete', 'Del'), k('End', 'End'), k('PageDown', 'PgDn')],
  [],
  [k('ArrowUp', '↑', 1, 1)],
  [k('ArrowLeft', '←'), k('ArrowDown', '↓'), k('ArrowRight', '→')],
];

export const NUMPAD = [
  [],
  [k('NumLock', 'Num'), k('NumpadDivide', '/'), k('NumpadMultiply', '*'), k('NumpadSubtract', '-')],
  [k('Numpad7', '7'), k('Numpad8', '8'), k('Numpad9', '9'), k('NumpadAdd', '+')],
  [k('Numpad4', '4'), k('Numpad5', '5'), k('Numpad6', '6'), k('NumpadEnter', 'Ent')],
  [k('Numpad1', '1'), k('Numpad2', '2'), k('Numpad3', '3')],
  [k('Numpad0', '0', 2), k('NumpadDecimal', '.')],
];

export function allCodes() {
  const out = new Set();
  for (const block of [MAIN, NAV, NUMPAD]) for (const row of block) for (const key of row) out.add(key.code);
  return out;
}
