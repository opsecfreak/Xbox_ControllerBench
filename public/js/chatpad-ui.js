// Chatpad view in the Keyboard tab: test every chatpad key and learn the
// special keys. Reads KeyboardEvent only.

import {
  CHATPAD_ROWS, CHATPAD_KEYS, defaultChatpadMap, sanitizeChatpadMap, matchChatpadKey,
  learnChatpadKey, markNoEvent, chatpadProgress, modString,
} from './lib/chatpad.js';

const $ = (id) => document.getElementById(id);
const STORE = 'controllerbench.chatpad';
const MODIFIERS = new Set(['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight']);

let map = defaultChatpadMap();
const tested = new Set();
const els = new Map();
let learning = null; // {id, pendingMod}
let pendingModTest = null; // modifier pressed alone so far
let log = () => {};

function eventMods(e) {
  return { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE);
    map = raw ? sanitizeChatpadMap(JSON.parse(raw)) : defaultChatpadMap();
  } catch {
    map = defaultChatpadMap();
  }
}

function save() {
  try { localStorage.setItem(STORE, JSON.stringify(map)); } catch { /* storage blocked */ }
}

function keyName(id) {
  return CHATPAD_KEYS.find((x) => x.id === id)?.label || id;
}

function build() {
  const pad = $('cp-pad');
  pad.textContent = '';
  els.clear();
  for (const row of CHATPAD_ROWS) {
    const r = document.createElement('div');
    r.className = 'r';
    for (const key of row) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'cpkey' + (key.special ? ' special' : '') + (key.side ? ' side' : '') + (key.tone ? ' tone-' + key.tone : '');
      el.style.width = `calc(var(--u) * ${key.w} + ${(key.w - 1) * 4}px)`;
      el.innerHTML = '<span class="l"></span><span class="s"></span>';
      el.querySelector('.l').textContent = key.label;
      el.addEventListener('click', () => startLearn(key.id));
      els.set(key.id, el);
      r.appendChild(el);
    }
    pad.appendChild(r);
  }
  render();
}

function render() {
  for (const key of CHATPAD_KEYS) {
    const el = els.get(key.id);
    const v = map.keys[key.id];
    el.classList.toggle('unmapped', !v);
    el.classList.toggle('none', !!v?.none);
    el.classList.toggle('tested', tested.has(key.id));
    el.classList.toggle('learning', learning?.id === key.id);
    const sub = !v ? 'learn' : v.none ? 'no event' : (v.mods ? v.mods + '+' : '') + v.code;
    el.querySelector('.s').textContent = sub;
    el.title = `${key.hint || key.label}: ${sub}`;
  }
  const p = chatpadProgress(map, tested);
  $('cp-progress').textContent = `${p.done} / ${p.total} checked (${p.pressed} pressed, ${p.none} no event, ${p.unmapped} not learned)`;
  $('cp-progress').classList.toggle('ok', p.done === p.total);
  $('cp-learn').hidden = !learning;
  if (learning) $('cp-learn-text').textContent = `Press the "${keyName(learning.id)}" key on the chatpad now.`;
}

function startLearn(id) {
  learning = { id, pendingMod: null };
  render();
}

function finishLearn(code, mods) {
  const id = learning.id;
  const cleared = learnChatpadKey(map, id, code, mods);
  learning = null;
  tested.add(id);
  if (cleared) tested.delete(cleared);
  save();
  log(`-- chatpad "${keyName(id)}" learned as ${(mods ? mods + '+' : '') + code}${cleared ? `; removed from "${keyName(cleared)}"` : ''} --`);
  render();
}

function flash(id) {
  const el = els.get(id);
  if (!el) return;
  el.classList.add('down');
  setTimeout(() => el.classList.remove('down'), 150);
}

/** Called by keyboard.js for every non-repeat keydown. */
export function chatpadDown(e, code) {
  const mods = modString(code, eventMods(e));
  if (learning) {
    if (MODIFIERS.has(code)) {
      if (!learning.pendingMod) learning.pendingMod = code;
      return;
    }
    finishLearn(code, mods);
    return;
  }
  if (MODIFIERS.has(code)) {
    if (!pendingModTest) pendingModTest = code;
    return;
  }
  pendingModTest = null;
  const id = matchChatpadKey(map, code, mods);
  if (id) {
    tested.add(id);
    els.get(id)?.classList.add('down');
    render();
  }
}

/** Called by keyboard.js for every keyup. */
export function chatpadUp(e, code) {
  if (learning) {
    if (learning.pendingMod === code) finishLearn(code, '');
    return;
  }
  if (MODIFIERS.has(code)) {
    if (pendingModTest === code) {
      const id = matchChatpadKey(map, code, '');
      if (id) {
        tested.add(id);
        flash(id);
        render();
      }
    }
    if (pendingModTest === code) pendingModTest = null;
    return;
  }
  for (const [id, v] of Object.entries(map.keys)) {
    if (v.code === code) els.get(id)?.classList.remove('down');
  }
}

export function resetChatpadTest() {
  tested.clear();
  learning = null;
  pendingModTest = null;
  for (const el of els.values()) el.classList.remove('down');
  render();
}

export function initChatpad(addLog) {
  log = addLog;
  load();
  build();
  $('cp-none').addEventListener('click', () => {
    if (!learning) return;
    markNoEvent(map, learning.id);
    log(`-- chatpad "${keyName(learning.id)}" marked: no event --`);
    learning = null;
    save();
    render();
  });
  $('cp-cancel').addEventListener('click', () => { learning = null; render(); });
  $('cp-reset-map').addEventListener('click', () => {
    map = defaultChatpadMap();
    save();
    resetChatpadTest();
    log('-- chatpad learned keys reset --');
  });
}

export function chatpadReport() {
  const p = chatpadProgress(map, tested);
  return {
    progress: p,
    keys: CHATPAD_KEYS.map((key) => {
      const v = map.keys[key.id];
      return {
        key: key.label,
        sends: !v ? null : v.none ? 'no event' : (v.mods ? v.mods + '+' : '') + v.code,
        pressed: tested.has(key.id),
      };
    }),
  };
}
