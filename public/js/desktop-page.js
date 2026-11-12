// Desktop mode settings page. Talks to the local server API only.

const $ = (id) => document.getElementById(id);
const API = '/api/desktop/';

const INPUTS = [
  ['a', 'A'], ['b', 'B'], ['x', 'X'], ['y', 'Y'],
  ['lb', 'LB'], ['rb', 'RB'], ['lt', 'LT'], ['rt', 'RT'],
  ['view', 'View (tap)'], ['menu', 'Menu (tap)'], ['ls', 'Left stick click'], ['rs', 'Right stick click'],
  ['up', 'D-pad up'], ['down', 'D-pad down'], ['left', 'D-pad left'], ['right', 'D-pad right'],
];

const ACTIONS = [
  ['none', 'Nothing'],
  ['mouse:left', 'Left click (hold to drag)'], ['mouse:right', 'Right click'], ['mouse:middle', 'Middle click'],
  ['mouse:back', 'Mouse back'], ['mouse:forward', 'Mouse forward'],
  ['precision', 'Precision: slow pointer while held'],
  ['key:Enter', 'Enter'], ['key:Escape', 'Escape'], ['key:Tab', 'Tab'], ['key:Space', 'Space'],
  ['key:Backspace', 'Backspace'], ['key:Delete', 'Delete'],
  ['key:Up', 'Arrow up'], ['key:Down', 'Arrow down'], ['key:Left', 'Arrow left'], ['key:Right', 'Arrow right'],
  ['key:PageUp', 'Page up'], ['key:PageDown', 'Page down'], ['key:Home', 'Home'], ['key:End', 'End'],
  ['key:Win', 'Windows key (Start)'], ['key:Win+Tab', 'Task view'], ['key:Alt+Tab', 'Switch window'],
  ['key:Win+D', 'Show desktop'], ['key:Win+Ctrl+O', 'On-screen keyboard on/off'],
  ['key:Ctrl+C', 'Copy'], ['key:Ctrl+V', 'Paste'], ['key:Ctrl+Z', 'Undo'],
  ['key:BrowserBack', 'Browser back'], ['key:BrowserForward', 'Browser forward'], ['key:BrowserRefresh', 'Browser refresh'],
  ['key:VolumeUp', 'Volume up'], ['key:VolumeDown', 'Volume down'], ['key:VolumeMute', 'Mute'],
  ['key:MediaPlayPause', 'Play / pause'], ['key:MediaNext', 'Next track'], ['key:MediaPrev', 'Previous track'],
];

let config = null;

async function api(path, method = 'GET', body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'X-ControllerBench': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
  return data;
}

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  o[keys[keys.length - 1]] = value;
}

function buildButtons() {
  const tbody = $('dm-buttons').querySelector('tbody');
  tbody.textContent = '';
  for (const [id, label] of INPUTS) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = label;
    const td = document.createElement('td');
    const sel = document.createElement('select');
    sel.dataset.btn = id;
    for (const [v, l] of [...ACTIONS, ['custom', 'Custom...']]) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = l;
      sel.appendChild(o);
    }
    const custom = document.createElement('input');
    custom.type = 'text';
    custom.dataset.custom = id;
    custom.placeholder = 'key:Ctrl+Shift+T';
    custom.className = 'mono';
    custom.hidden = true;
    sel.addEventListener('change', () => { custom.hidden = sel.value !== 'custom'; });
    td.append(sel, ' ', custom);
    tr.append(th, td);
    tbody.appendChild(tr);
  }
}

function fill(cfg) {
  config = cfg;
  for (const el of document.querySelectorAll('[data-k]')) {
    const v = getPath(cfg, el.dataset.k);
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = String(v);
  }
  for (const sel of document.querySelectorAll('select[data-btn]')) {
    const v = cfg.buttons[sel.dataset.btn];
    const custom = document.querySelector(`input[data-custom="${sel.dataset.btn}"]`);
    if (ACTIONS.some(([a]) => a === v)) {
      sel.value = v;
      custom.hidden = true;
    } else {
      sel.value = 'custom';
      custom.value = v;
      custom.hidden = false;
    }
  }
}

function collect() {
  const cfg = structuredClone(config);
  for (const el of document.querySelectorAll('[data-k]')) {
    let v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.dataset.k === 'player') v = el.value === 'auto' ? 'auto' : Number(el.value);
    else v = Number(el.value);
    setPath(cfg, el.dataset.k, v);
  }
  for (const sel of document.querySelectorAll('select[data-btn]')) {
    const custom = document.querySelector(`input[data-custom="${sel.dataset.btn}"]`);
    cfg.buttons[sel.dataset.btn] = sel.value === 'custom' ? custom.value.trim() : sel.value;
  }
  return cfg;
}

function msg(text) {
  $('dm-msg').textContent = text;
}

async function save() {
  const wanted = collect();
  try {
    const saved = await api('config', 'PUT', wanted);
    const rejected = Object.keys(wanted.buttons).filter((k) => wanted.buttons[k] !== saved.buttons[k]);
    fill(saved);
    msg(rejected.length ? `Saved. Not valid, kept the old value: ${rejected.join(', ')}.` : 'Saved.');
  } catch (err) {
    msg('Save failed: ' + err.message);
  }
}

function fmt(v) {
  return (v >= 0 ? ' ' : '') + v.toFixed(2);
}

async function poll() {
  try {
    const s = await api('status');
    $('st-running').textContent = s.running ? (s.ready ? 'running' : 'starting...') : 'stopped';
    $('st-connected').textContent = s.connected ? `connected (player ${s.player + 1})` : s.running ? 'not found' : '-';
    $('st-enabled').textContent = !s.running ? '-' : s.enabled ? 'desktop mode ON' : 'paused';
    $('dm-enable').textContent = s.enabled ? 'Pause' : 'Resume';
    $('st-buttons').textContent = s.buttons.join(' ') || 'none';
    $('st-left').textContent = s.sticks ? `${fmt(s.sticks.lx)}, ${fmt(s.sticks.ly)}` : '-';
    $('st-right').textContent = s.sticks ? `${fmt(s.sticks.rx)}, ${fmt(s.sticks.ry)}` : '-';
    $('dm-start').disabled = s.running || !s.supported;
    $('dm-stop').disabled = !s.running;
    const warn = [];
    if (!s.supported) warn.push(`Desktop mode needs Windows. This server runs on ${s.platform}.`);
    if (s.lastError) warn.push('Helper: ' + s.lastError);
    const ul = $('st-warn');
    ul.textContent = '';
    for (const w of warn) {
      const li = document.createElement('li');
      li.textContent = w;
      ul.appendChild(li);
    }
  } catch (err) {
    $('st-running').textContent = 'server not reachable';
  }
}

async function init() {
  buildButtons();
  try {
    fill(await api('config'));
  } catch (err) {
    msg('Could not load settings: ' + err.message);
  }
  $('dm-save').addEventListener('click', save);
  $('dm-defaults').addEventListener('click', async () => {
    // Send an empty object: the server fills every value with its default.
    try {
      fill(await api('config', 'PUT', {}));
      msg('Defaults loaded and saved.');
    } catch (err) {
      msg('Failed: ' + err.message);
    }
  });
  $('dm-start').addEventListener('click', async () => {
    try { msg((await api('start', 'POST')).message); } catch (err) { msg(err.message); }
    poll();
  });
  $('dm-stop').addEventListener('click', async () => {
    try { msg((await api('stop', 'POST')).message); } catch (err) { msg(err.message); }
    poll();
  });
  $('dm-enable').addEventListener('click', async () => {
    const on = $('dm-enable').textContent === 'Resume';
    try { await api('enabled', 'POST', { enabled: on }); } catch (err) { msg(err.message); }
    poll();
  });
  $('dm-bench').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const obj = JSON.parse(await file.text());
      const left = (obj.calibration || obj).left;
      if (!left) throw new Error('no left stick values in that file');
      document.querySelector('[data-k="mouse.cx"]').value = left.cx;
      document.querySelector('[data-k="mouse.cy"]').value = left.cy;
      if (Number(left.inner) > 0) document.querySelector('[data-k="mouse.deadzone"]').value = left.inner;
      msg('Loaded from the tester calibration. Press Save settings.');
    } catch (err) {
      msg('Load failed: ' + err.message);
    }
  });
  poll();
  setInterval(poll, 500);
}

init();
