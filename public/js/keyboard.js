// Keyboard tab: key map, rollover, chatter and event log.
// Reads KeyboardEvent only. Nothing is sent to the keyboard.

import { MAIN, NAV, NUMPAD, allCodes } from './lib/layout.js';
import { KeyTracker } from './lib/keytracker.js';

const $ = (id) => document.getElementById(id);
const LOG_MAX = 150;

const tracker = new KeyTracker({ chatterMs: 30 });
const keyEls = new Map();
const known = allCodes();
const other = new Set();
const log = [];
let lastEventT = null;
let active = false;

function buildBlock(container, rows) {
  container.textContent = '';
  for (const row of rows) {
    const r = document.createElement('div');
    r.className = 'r';
    for (const key of row) {
      const el = document.createElement('div');
      el.className = 'key';
      el.textContent = key.label;
      el.title = key.code;
      el.style.width = `calc(var(--u) * ${key.w} + ${(key.w - 1) * 4}px)`;
      if (key.gap) el.style.marginLeft = `calc(var(--u) * ${key.gap})`;
      keyEls.set(key.code, el);
      r.appendChild(el);
    }
    container.appendChild(r);
  }
}

function codeOf(e) {
  return e.code || (e.key ? 'key:' + e.key : 'unknown');
}

function mods(e) {
  return [e.ctrlKey && 'Ctrl', e.shiftKey && 'Shift', e.altKey && 'Alt', e.metaKey && 'Win'].filter(Boolean).join('+');
}

function isFormField(t) {
  return t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
}

function addLog(line) {
  log.push(line);
  if (log.length > LOG_MAX) log.shift();
  const el = $('kb-log');
  el.textContent = log.slice().reverse().join('\n');
}

function onDown(e) {
  if (!active || isFormField(e.target)) return;
  // Stop the browser acting on the key (scroll, find, reload) while testing.
  // The OS still takes some combos (Win, Alt+Tab, Ctrl+Alt+Del).
  e.preventDefault();
  const code = codeOf(e);
  const t = e.timeStamp;
  const res = tracker.down(code, t, e.repeat);
  if (res.type === 'repeat') return; // do not flood the log with auto-repeat
  if (!known.has(code)) other.add(code);
  const el = keyEls.get(code);
  if (el) {
    el.classList.add('down', 'tested');
    if (res.type === 'chatter') el.classList.add('chatter');
  }
  const dt = lastEventT === null ? 0 : t - lastEventT;
  lastEventT = t;
  const m = mods(e);
  let line = `+${dt.toFixed(1).padStart(7)} ms  down  ${code.padEnd(14)} key=${JSON.stringify(e.key)} loc=${e.location}${m ? '  mods=' + m : ''}`;
  if (res.type === 'chatter') line += `  CHATTER (${res.gapMs.toFixed(1)} ms after release)`;
  if (res.type === 'altcode-digit') line += `  Alt code digits so far: ${res.digits}`;
  if (code === 'F23' && e.shiftKey && e.metaKey) line += '  (Shift+Win+F23 is what a Windows Copilot key sends)';
  if (res.type === 'double-down') line += '  DOWN AGAIN WITHOUT RELEASE';
  addLog(line);
  renderStats();
}

function onUp(e) {
  if (!active || isFormField(e.target)) return;
  e.preventDefault();
  const code = codeOf(e);
  const t = e.timeStamp;
  const res = tracker.up(code, t);
  keyEls.get(code)?.classList.remove('down');
  const dt = lastEventT === null ? 0 : t - lastEventT;
  lastEventT = t;
  addLog(`+${dt.toFixed(1).padStart(7)} ms  up    ${code.padEnd(14)} held=${res.heldMs === null ? '?' : res.heldMs.toFixed(1) + ' ms'}`);
  if (res.altCode) {
    const ch = res.altCode.char === null ? 'not decoded' : JSON.stringify(res.altCode.char);
    addLog(`-- Alt code ${res.altCode.digits} typed: ${ch} --`);
  }
  renderStats();
}

function onBlur() {
  if (!tracker.held.size) return;
  tracker.releaseAll(performance.now());
  for (const el of keyEls.values()) el.classList.remove('down');
  addLog('-- window lost focus: held keys released --');
  renderStats();
}

function renderStats() {
  const s = tracker.summary();
  $('kb-tested').textContent = s.keysTested;
  $('kb-held').textContent = tracker.held.size;
  $('kb-rollover').textContent = s.maxRollover;
  $('kb-chatter').textContent = s.chatterEvents;
  $('kb-altcodes').textContent = s.altCodes.length
    ? s.altCodes.slice(-20).map((a) => `${a.digits}${a.char === null ? '' : ' ' + JSON.stringify(a.char)}`).join(', ')
    : 'none';
  $('kb-rollover-keys').textContent = s.maxRolloverKeys.join(' + ') || 'none';
  $('kb-held-list').textContent = [...tracker.held.keys()].join(' + ') || 'none';
  $('kb-other').textContent = [...other].join(', ') || 'none';
  $('kb-chatter-list').textContent = tracker.chatter.length
    ? tracker.chatter.slice(-30).map((c) => `${c.code}: ${c.gapMs.toFixed(1)} ms`).join('\n')
    : 'none';
}

function reset() {
  tracker.reset();
  other.clear();
  log.length = 0;
  lastEventT = null;
  for (const el of keyEls.values()) el.classList.remove('down', 'tested', 'chatter');
  $('kb-log').textContent = '';
  renderStats();
}

async function lockKeys() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    if (navigator.keyboard?.lock) {
      await navigator.keyboard.lock();
      addLog('-- full screen on, system keys captured --');
    } else {
      addLog('-- full screen on. This browser has no Keyboard Lock API, so system keys still go to the OS --');
    }
  } catch (err) {
    addLog('-- full screen / key lock failed: ' + err.message + ' --');
  }
  $('kb-focus').focus();
}

export function setKeyboardActive(on) {
  active = on;
  if (on) $('kb-focus').focus();
  else onBlur();
}

export function initKeyboard() {
  buildBlock($('kb-main'), MAIN);
  buildBlock($('kb-nav'), NAV);
  buildBlock($('kb-num'), NUMPAD);
  window.addEventListener('keydown', onDown, true);
  window.addEventListener('keyup', onUp, true);
  window.addEventListener('blur', onBlur);
  $('kb-reset').addEventListener('click', reset);
  $('kb-lock').addEventListener('click', lockKeys);
  $('kb-chatter-ms').addEventListener('change', (e) => {
    const v = Math.min(200, Math.max(5, Number(e.target.value) || 30));
    e.target.value = v;
    tracker.chatterMs = v;
  });
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) navigator.keyboard?.unlock?.();
  });
  renderStats();
}

export function keyboardReport() {
  return { ...tracker.summary(), otherKeys: [...other] };
}
