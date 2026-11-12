// Controller tab: live readout, drift/range/trigger tests, software
// calibration and rumble. Uses only the Chrome Gamepad API (read inputs)
// and GamepadHapticActuator (rumble). Nothing is written to the controller.

import { BUTTONS, REQUIRED_BUTTONS, XINPUT_DEADZONE, checkGamepad, driftVerdict, snapshot } from './lib/mapping.js';
import { driftStats, RangeRecorder, RateMeter, round } from './lib/stats.js';
import {
  applyStick, applyTrigger, defaultCalibration, loadCalibration, saveCalibration,
  sanitizeCalibration, suggestStick, suggestTrigger,
} from './lib/calibration.js';

const $ = (id) => document.getElementById(id);
const DRIFT_MS = 3000;
const RUMBLE_MAX_MS = 1000;

const state = {
  selected: null, // gamepad index
  padId: null,
  cal: defaultCalibration(),
  calDirty: false,
  last: null, // last snapshot
  rate: new RateMeter(),
  tested: new Set(),
  counts: new Map(),
  prevPressed: [],
  drift: null, // {until, left: [], right: [], ltMax, rtMax}
  driftResult: null, // {left, right, ltRest, rtRest}
  range: null, // {left: RangeRecorder, right: RangeRecorder}
  rangeResult: null,
  rangeOutline: null, // last recorders, for drawing
  trig: null, // {ltMin, ltMax, rtMin, rtMax}
  trigResult: null,
  apiError: null,
  colors: {},
  dpr: 1,
};

function readColors() {
  const cs = getComputedStyle(document.documentElement);
  for (const name of ['accent', 'raw', 'line', 'warn', 'edge', 'muted', 'text']) {
    state.colors[name] = cs.getPropertyValue('--' + name).trim();
  }
}

function getPads() {
  if (!navigator.getGamepads) return [];
  try {
    return Array.from(navigator.getGamepads()).filter((p) => p && p.connected);
  } catch (err) {
    if (!state.apiError) {
      state.apiError = err;
      window.__cbAddError?.('getGamepads failed: ' + err.message);
    }
    return [];
  }
}

export function currentPad() {
  const pads = getPads();
  return pads.find((p) => p.index === state.selected) || pads[0] || null;
}

// ---------- setup ----------

function setupCanvases() {
  state.dpr = window.devicePixelRatio || 1;
  for (const id of ['stick-left', 'stick-right']) {
    const c = $(id);
    c.width = 240 * state.dpr;
    c.height = 240 * state.dpr;
  }
}

// Standard buttons, plus any extra buttons the controller reports
// (for example Share, a touchpad click or a vendor button at index 17+).
let buttonList = [];

function addButtonTile(b) {
  const el = document.createElement('div');
  el.className = 'bt' + (b.optional ? ' optional' : '');
  el.id = 'bt-' + b.i;
  el.innerHTML = `<span class="n"></span><span class="v">0 presses</span>`;
  el.querySelector('.n').textContent = b.name;
  $('btn-grid').appendChild(el);
}

function buildButtonGrid() {
  $('btn-grid').textContent = '';
  buttonList = BUTTONS.slice();
  for (const b of buttonList) addButtonTile(b);
}

function ensureExtraButtons(count) {
  for (let i = buttonList.length; i < count; i++) {
    const b = { i, name: `Button ${i}`, optional: true, extra: true };
    buttonList.push(b);
    addButtonTile(b);
  }
}

function fillCalInputs() {
  for (const row of document.querySelectorAll('#cal-table tr[data-stick]')) {
    const s = state.cal[row.dataset.stick];
    for (const inp of row.querySelectorAll('input')) inp.value = round(s[inp.dataset.f], 3);
  }
  for (const row of document.querySelectorAll('#cal-trig tr[data-trig]')) {
    const t = state.cal[row.dataset.trig];
    for (const inp of row.querySelectorAll('input')) inp.value = round(t[inp.dataset.f], 3);
  }
}

function readCalInputs() {
  const next = structuredClone(state.cal);
  for (const row of document.querySelectorAll('#cal-table tr[data-stick]')) {
    for (const inp of row.querySelectorAll('input')) next[row.dataset.stick][inp.dataset.f] = Number(inp.value);
  }
  for (const row of document.querySelectorAll('#cal-trig tr[data-trig]')) {
    for (const inp of row.querySelectorAll('input')) next[row.dataset.trig][inp.dataset.f] = Number(inp.value);
  }
  return sanitizeCalibration(next);
}

function setCal(cal, dirty, msg) {
  state.cal = sanitizeCalibration(cal);
  state.calDirty = dirty;
  fillCalInputs();
  $('cal-status').textContent = msg || (dirty ? 'Unsaved changes.' : '');
}

function onPadChanged(id) {
  state.padId = id;
  setCal(loadCalibration(localStorage, id), false, id ? 'Loaded saved values for this controller (or defaults).' : '');
}

// ---------- tests ----------

function startDrift() {
  if (!state.last) return status('drift-status', 'Connect a controller first.');
  state.drift = { until: performance.now() + DRIFT_MS, left: [], right: [], ltMax: 0, rtMax: 0 };
  $('drift-start').disabled = true;
  status('drift-status', 'Do not touch the controller...');
}

function sampleDrift(s, now) {
  const d = state.drift;
  d.left.push({ x: s.axes[0] ?? 0, y: s.axes[1] ?? 0 });
  d.right.push({ x: s.axes[2] ?? 0, y: s.axes[3] ?? 0 });
  d.ltMax = Math.max(d.ltMax, s.buttons[6]?.value ?? 0);
  d.rtMax = Math.max(d.rtMax, s.buttons[7]?.value ?? 0);
  const left = Math.max(0, d.until - now);
  status('drift-status', `Sampling... ${(left / 1000).toFixed(1)} s`);
  if (now >= d.until) finishDrift();
}

function finishDrift() {
  const d = state.drift;
  state.drift = null;
  $('drift-start').disabled = false;
  if (d.left.length < 10) {
    status('drift-status', 'Too few samples. Keep this tab in front and run again.');
    return;
  }
  state.driftResult = { left: driftStats(d.left), right: driftStats(d.right), ltRest: d.ltMax, rtRest: d.rtMax };
  renderDrift();
  updateSuggestButton();
}

function renderDrift() {
  const r = state.driftResult;
  if (!r) return;
  const limit = Number($('drift-threshold').value) || 0.05;
  const verdict = (st, dz) => {
    if (st.maxMag > 0.5) return ['warn', 'Moved during test. Run again.'];
    const v = driftVerdict(st.offset, limit, dz);
    return [v.level, v.text];
  };
  const [lc, lt] = verdict(r.left, XINPUT_DEADZONE.left);
  const [rc, rt] = verdict(r.right, XINPUT_DEADZONE.right);
  const rows = [
    ['Samples', r.left.count, r.right.count],
    ['Rest offset', round(r.left.offset), round(r.right.offset)],
    ['Center X', round(r.left.meanX), round(r.right.meanX)],
    ['Center Y', round(r.left.meanY), round(r.right.meanY)],
    ['Max wobble', round(r.left.maxResidual), round(r.right.maxResidual)],
    ['Noise X / Y', `${round(r.left.noiseX, 4)} / ${round(r.left.noiseY, 4)}`, `${round(r.right.noiseX, 4)} / ${round(r.right.noiseY, 4)}`],
  ];
  const tbody = $('drift-results').querySelector('tbody');
  tbody.textContent = '';
  for (const [k, a, b] of rows) tbody.appendChild(tr(k, a, b));
  tbody.appendChild(tr('Windows default deadzone (xinput.h)', round(XINPUT_DEADZONE.left), round(XINPUT_DEADZONE.right)));
  tbody.appendChild(tr('Result', lt, rt, lc, rc));
  const trigLevel = (v) => (v > XINPUT_DEADZONE.trigger ? 'warn' : '');
  tbody.appendChild(tr('Trigger at rest (LT / RT)', round(r.ltRest), round(r.rtRest), trigLevel(r.ltRest), trigLevel(r.rtRest)));
  $('drift-results').hidden = false;
  const still = r.left.maxResidual < 1e-6 && r.right.maxResidual < 1e-6;
  status('drift-status', `Done. Warning limit ${limit}.` + (still ? ' Values did not change during the test. Windows sends a new value only when the input changes, so wobble and noise read 0.' : ''));
}

function startRange() {
  if (!state.last) return status('range-status', 'Connect a controller first.');
  const centerFor = (side) => {
    const d = state.driftResult?.[side];
    return d ? { x: d.meanX, y: d.meanY } : { x: state.cal[side].cx, y: state.cal[side].cy };
  };
  state.range = { left: new RangeRecorder(72, centerFor('left')), right: new RangeRecorder(72, centerFor('right')) };
  state.rangeOutline = state.range;
  $('range-start').disabled = true;
  $('range-stop').disabled = false;
}

function sampleRange(s) {
  state.range.left.add(s.axes[0] ?? 0, s.axes[1] ?? 0);
  state.range.right.add(s.axes[2] ?? 0, s.axes[3] ?? 0);
  const l = state.range.left.result().coverage;
  const r = state.range.right.result().coverage;
  status('range-status', `Coverage: left ${Math.round(l * 100)}%, right ${Math.round(r * 100)}%`);
}

function stopRange() {
  if (!state.range) return;
  state.rangeResult = { left: state.range.left.result(), right: state.range.right.result() };
  state.range = null;
  $('range-start').disabled = false;
  $('range-stop').disabled = true;
  const r = state.rangeResult;
  const cov = (x) => `${Math.round(x.coverage * 100)}%`;
  const rows = [
    ['Coverage', cov(r.left), cov(r.right)],
    ['Min edge radius', round(r.left.minR), round(r.right.minR)],
    ['Max edge radius', round(r.left.maxR), round(r.right.maxR)],
    ['Average edge radius', round(r.left.avgR), round(r.right.avgR)],
    ['Circularity error', `${round(r.left.circularityError * 100, 1)}%`, `${round(r.right.circularityError * 100, 1)}%`],
  ];
  const tbody = $('range-results').querySelector('tbody');
  tbody.textContent = '';
  for (const [k, a, b] of rows) tbody.appendChild(tr(k, a, b));
  const verdict = (x) => (x.coverage < 0.9 ? ['warn', 'Turn more circles'] : x.minR < 0.9 ? ['warn', 'Edge short in some directions'] : ['ok', 'OK']);
  const [lc, lt] = verdict(r.left);
  const [rc, rt] = verdict(r.right);
  tbody.appendChild(tr('Result', lt, rt, lc, rc));
  $('range-results').hidden = false;
  status('range-status', 'Done. The blue outline shows the edge each stick reached.');
  updateSuggestButton();
}

function startTrig() {
  if (!state.last) return status('trig-status', 'Connect a controller first.');
  state.trig = { ltMin: 1, ltMax: 0, rtMin: 1, rtMax: 0 };
  $('trig-start').disabled = true;
  $('trig-stop').disabled = false;
}

function sampleTrig(s) {
  const t = state.trig;
  const lt = s.buttons[6]?.value ?? 0;
  const rt = s.buttons[7]?.value ?? 0;
  t.ltMin = Math.min(t.ltMin, lt); t.ltMax = Math.max(t.ltMax, lt);
  t.rtMin = Math.min(t.rtMin, rt); t.rtMax = Math.max(t.rtMax, rt);
  status('trig-status', `LT ${round(t.ltMin)}..${round(t.ltMax)}  RT ${round(t.rtMin)}..${round(t.rtMax)}`);
}

function stopTrig() {
  if (!state.trig) return;
  state.trigResult = state.trig;
  state.trig = null;
  $('trig-start').disabled = false;
  $('trig-stop').disabled = true;
  const t = state.trigResult;
  const warn = [];
  if (t.ltMax < 0.95) warn.push('LT did not reach full');
  if (t.rtMax < 0.95) warn.push('RT did not reach full');
  status('trig-status', `Done. LT ${round(t.ltMin)}..${round(t.ltMax)}, RT ${round(t.rtMin)}..${round(t.rtMax)}. ${warn.join('. ') || 'Both triggers reached full.'}`);
  updateSuggestButton();
}

function updateSuggestButton() {
  $('cal-suggest').disabled = !(state.driftResult || state.rangeResult || state.trigResult);
}

function applySuggestions() {
  const c = structuredClone(state.cal);
  const d = state.driftResult;
  const r = state.rangeResult;
  c.left = suggestStick(d?.left, r?.left, c.left);
  c.right = suggestStick(d?.right, r?.right, c.right);
  const t = state.trigResult;
  if (t || d) {
    const ltRest = Math.max(d?.ltRest ?? 0, t?.ltMin ?? 0);
    const rtRest = Math.max(d?.rtRest ?? 0, t?.rtMin ?? 0);
    c.lt = t ? suggestTrigger(ltRest, t.ltMax) : { ...c.lt, ...{ min: suggestTrigger(ltRest, 1).min } };
    c.rt = t ? suggestTrigger(rtRest, t.rtMax) : { ...c.rt, ...{ min: suggestTrigger(rtRest, 1).min } };
  }
  setCal(c, true, 'Test results applied. Check the values, then press Save.');
}

// ---------- rumble ----------

async function rumble(kind) {
  const gp = currentPad();
  const act = gp?.vibrationActuator;
  if (!act || typeof act.playEffect !== 'function') {
    return status('rum-status', 'Rumble is not available for this controller in this browser.');
  }
  const strong = Number($('rum-strong').value);
  const weak = Number($('rum-weak').value);
  const duration = Math.min(RUMBLE_MAX_MS, Math.max(50, Number($('rum-dur').value)));
  let effect = 'dual-rumble';
  let params = { startDelay: 0, duration, strongMagnitude: strong, weakMagnitude: weak };
  if (kind === 'left') params.weakMagnitude = 0;
  if (kind === 'right') params.strongMagnitude = 0;
  if (kind === 'trigger') {
    if (Array.isArray(act.effects) && !act.effects.includes('trigger-rumble')) {
      return status('rum-status', 'Trigger rumble is not supported here. Chrome supports it only on some platforms.');
    }
    effect = 'trigger-rumble';
    params = { startDelay: 0, duration, strongMagnitude: 0, weakMagnitude: 0, leftTrigger: strong, rightTrigger: weak };
  }
  try {
    status('rum-status', 'Playing...');
    const res = await act.playEffect(effect, params);
    status('rum-status', `Result: ${res}`);
  } catch (err) {
    status('rum-status', `Rumble failed: ${err.message}`);
    window.__cbAddError?.('Rumble failed (' + effect + '): ' + err.message);
  }
}

async function rumbleStop() {
  const act = currentPad()?.vibrationActuator;
  try {
    if (act?.reset) await act.reset();
    status('rum-status', 'Stopped.');
  } catch (err) {
    status('rum-status', `Stop failed: ${err.message}`);
  }
}

function rumbleSupport(gp) {
  const act = gp.vibrationActuator;
  if (!act) return 'not available';
  if (Array.isArray(act.effects)) return act.effects.join(', ') || 'none';
  return act.type || 'dual-rumble';
}

// ---------- drawing ----------

function drawStick(canvas, raw, cal, calc, recorder) {
  const ctx = canvas.getContext('2d');
  const dpr = state.dpr;
  const S = 240;
  const C = S / 2;
  const R = 105;
  const col = state.colors;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, S, S);

  // unit circle and cross
  ctx.strokeStyle = col.line;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(C, C, R, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(C - R, C); ctx.lineTo(C + R, C); ctx.moveTo(C, C - R); ctx.lineTo(C, C + R); ctx.stroke();

  // range outline
  if (recorder) {
    ctx.strokeStyle = col.edge;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < recorder.bins; i++) {
      const r = recorder.radii[i];
      if (!r) { started = false; continue; }
      const a = recorder.binAngle(i);
      const px = C + (recorder.center.x + Math.cos(a) * r) * R;
      const py = C + (recorder.center.y + Math.sin(a) * r) * R;
      if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  // deadzone and outer edge, around the calibrated center
  const ox = C + cal.cx * R;
  const oy = C + cal.cy * R;
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = col.warn;
  if (cal.inner > 0) { ctx.beginPath(); ctx.arc(ox, oy, cal.inner * R, 0, Math.PI * 2); ctx.stroke(); }
  if (cal.outer < 1) { ctx.beginPath(); ctx.arc(ox, oy, cal.outer * R, 0, Math.PI * 2); ctx.stroke(); }
  ctx.setLineDash([]);

  // raw dot
  ctx.fillStyle = col.raw;
  ctx.beginPath(); ctx.arc(C + raw.x * R, C + raw.y * R, 6, 0, Math.PI * 2); ctx.fill();
  // calibrated dot
  ctx.fillStyle = col.accent;
  ctx.beginPath(); ctx.arc(C + calc.x * R, C + calc.y * R, 5, 0, Math.PI * 2); ctx.fill();
}

// ---------- render loop ----------

let lastPadKey = '';
function renderDeviceList(pads) {
  const key = pads.map((p) => p.index + ':' + p.id).join('|');
  if (key === lastPadKey) return;
  lastPadKey = key;
  const sel = $('pad-select');
  sel.textContent = '';
  for (const p of pads) {
    const o = document.createElement('option');
    o.value = p.index;
    o.textContent = `#${p.index} ${p.id}`;
    sel.appendChild(o);
  }
  $('pad-select-wrap').hidden = pads.length < 2;
  if (!pads.some((p) => p.index === state.selected)) state.selected = pads[0]?.index ?? null;
  sel.value = state.selected ?? '';
}

let rawFrame = 0;
function render(gp, now) {
  const pads = getPads();
  renderDeviceList(pads);
  $('pad-empty').hidden = !!gp;
  $('pad-info').hidden = !gp;
  if (!gp) {
    state.last = null;
    return;
  }
  const s = snapshot(gp);
  state.last = s;
  if (s.id !== state.padId) {
    onPadChanged(s.id);
    $('pad-id').textContent = s.id;
    $('pad-mapping').textContent = s.mapping || '(none)';
    $('pad-axes').textContent = s.axes.length;
    $('pad-buttons').textContent = s.buttons.length;
    $('pad-rumble').textContent = rumbleSupport(gp);
    const ul = $('pad-warnings');
    ul.textContent = '';
    for (const w of checkGamepad(s)) {
      const li = document.createElement('li');
      li.textContent = w;
      ul.appendChild(li);
    }
  }
  $('pad-rate').textContent = Math.round(state.rate.update(s.timestamp, now));

  // sticks
  const cal = state.cal;
  const L = { x: s.axes[0] ?? 0, y: s.axes[1] ?? 0 };
  const Rr = { x: s.axes[2] ?? 0, y: s.axes[3] ?? 0 };
  const Lc = applyStick(L.x, L.y, cal.left);
  const Rc = applyStick(Rr.x, Rr.y, cal.right);
  const outline = state.range || state.rangeOutline;
  drawStick($('stick-left'), L, cal.left, Lc, outline?.left);
  drawStick($('stick-right'), Rr, cal.right, Rc, outline?.right);
  $('read-left').textContent = `raw ${fmt(L.x)}, ${fmt(L.y)}  cal ${fmt(Lc.x)}, ${fmt(Lc.y)}`;
  $('read-right').textContent = `raw ${fmt(Rr.x)}, ${fmt(Rr.y)}  cal ${fmt(Rc.x)}, ${fmt(Rc.y)}`;

  // triggers
  for (const [i, name] of [[6, 'lt'], [7, 'rt']]) {
    const raw = s.buttons[i]?.value ?? 0;
    const v = applyTrigger(raw, cal[name]);
    $('bar-' + name).style.width = (v * 100).toFixed(1) + '%';
    $('read-' + name).textContent = raw.toFixed(3);
  }

  // buttons
  ensureExtraButtons(s.buttons.length);
  for (const b of buttonList) {
    const st = s.buttons[b.i];
    const el = $('bt-' + b.i);
    if (!st) { el.classList.remove('down'); continue; }
    const was = state.prevPressed[b.i];
    if (st.pressed && !was) {
      state.tested.add(b.i);
      state.counts.set(b.i, (state.counts.get(b.i) || 0) + 1);
    }
    el.classList.toggle('down', st.pressed);
    el.classList.toggle('tested', state.tested.has(b.i));
    const n = state.counts.get(b.i) || 0;
    el.querySelector('.v').textContent = b.analog ? `${st.value.toFixed(2)} · ${n}x` : `${n} press${n === 1 ? '' : 'es'}`;
  }
  state.prevPressed = s.buttons.map((b) => b.pressed);
  const done = REQUIRED_BUTTONS.filter((i) => state.tested.has(i)).length;
  const pill = $('btn-progress');
  pill.textContent = `${done} / ${REQUIRED_BUTTONS.length}`;
  pill.classList.toggle('ok', done === REQUIRED_BUTTONS.length);

  // tests
  if (state.drift) sampleDrift(s, now);
  if (state.range) sampleRange(s);
  if (state.trig) sampleTrig(s);

  // raw view (only when open, every 3rd frame)
  if ($('raw-axes').closest('details').open && rawFrame++ % 3 === 0) {
    $('raw-axes').innerHTML = s.axes.map((v, i) => `axis ${i}: ${fmt(v)}`).join('<br>');
    $('raw-buttons').innerHTML = s.buttons
      .map((b, i) => `<span class="${b.pressed ? 'on' : ''}">b${i}: ${b.value.toFixed(2)}</span>`)
      .join('');
  }
}

function fmt(v) {
  return (v >= 0 ? ' ' : '') + v.toFixed(3);
}

function tr(label, a, b, ca = '', cb = '') {
  const row = document.createElement('tr');
  const th = document.createElement('th');
  th.textContent = label;
  const ta = document.createElement('td');
  ta.textContent = a;
  if (ca) ta.className = ca;
  const tb = document.createElement('td');
  tb.textContent = b;
  if (cb) tb.className = cb;
  row.append(th, ta, tb);
  return row;
}

function status(id, msg) {
  $(id).textContent = msg;
}

function download(name, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export { download };

// ---------- public ----------

export function initController() {
  readColors();
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', readColors);
  setupCanvases();
  buildButtonGrid();
  fillCalInputs();

  window.addEventListener('gamepadconnected', (e) => {
    if (state.selected === null) state.selected = e.gamepad.index;
  });
  window.addEventListener('gamepaddisconnected', (e) => {
    if (state.selected === e.gamepad.index) state.selected = null;
    state.padId = null;
    window.__cbAddError?.(`Controller disconnected: ${e.gamepad.id}. If this was not on purpose, check the cable.`);
  });

  $('pad-select').addEventListener('change', (e) => { state.selected = Number(e.target.value); });
  $('btn-reset').addEventListener('click', () => { state.tested.clear(); state.counts.clear(); });
  $('drift-start').addEventListener('click', startDrift);
  $('drift-threshold').addEventListener('change', renderDrift);
  $('range-start').addEventListener('click', startRange);
  $('range-stop').addEventListener('click', stopRange);
  $('trig-start').addEventListener('click', startTrig);
  $('trig-stop').addEventListener('click', stopTrig);
  $('cal-suggest').addEventListener('click', applySuggestions);

  for (const inp of document.querySelectorAll('#cal-table input, #cal-trig input')) {
    inp.addEventListener('change', () => setCal(readCalInputs(), true));
  }
  $('cal-save').addEventListener('click', () => {
    const ok = saveCalibration(localStorage, state.padId, state.cal);
    setCal(state.cal, !ok, ok ? 'Saved in this browser.' : 'Save failed. Browser storage is blocked.');
  });
  $('cal-reset').addEventListener('click', () => setCal(defaultCalibration(), true, 'Defaults loaded. Press Save to keep them.'));
  $('cal-export').addEventListener('click', () => download('controllerbench-calibration.json', { id: state.padId, calibration: state.cal }));
  $('cal-import').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const obj = JSON.parse(await file.text());
      setCal(obj.calibration || obj, true, 'Imported. Check the values, then press Save.');
    } catch (err) {
      status('cal-status', 'Import failed: ' + err.message);
    }
  });

  for (const id of ['rum-strong', 'rum-weak', 'rum-dur']) {
    const inp = $(id);
    const out = $(id + '-v');
    const upd = () => { out.textContent = id === 'rum-dur' ? inp.value : Number(inp.value).toFixed(2); };
    inp.addEventListener('input', upd);
    upd();
  }
  $('rum-both').addEventListener('click', () => rumble('both'));
  $('rum-left').addEventListener('click', () => rumble('left'));
  $('rum-right').addEventListener('click', () => rumble('right'));
  $('rum-trig').addEventListener('click', () => rumble('trigger'));
  $('rum-stop').addEventListener('click', rumbleStop);

  const loop = (now) => {
    try {
      render(currentPad(), now);
    } catch (err) {
      window.__cbAddError?.('Render error: ' + err.message);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

export function controllerReport() {
  const s = state.last;
  return {
    connection: $('conn-type').value,
    controller: s ? { id: s.id, mapping: s.mapping, axes: s.axes.length, buttons: s.buttons.length } : null,
    reportsPerSecond: Math.round(state.rate.rate()),
    buttonsTested: buttonList.filter((b) => state.tested.has(b.i)).map((b) => b.name),
    buttonsMissing: BUTTONS.filter((b) => !b.optional && !state.tested.has(b.i)).map((b) => b.name),
    drift: state.driftResult,
    driftWarnLimit: Number($('drift-threshold').value),
    range: state.rangeResult,
    triggers: state.trigResult,
    calibration: state.cal,
    calibrationSaved: !state.calDirty,
  };
}

export function controllerCount() {
  return getPads().length;
}
