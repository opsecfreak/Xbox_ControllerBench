// Diagnostics tab: browser feature checks and the page error list.

import { controllerCount } from './controller.js';

const $ = (id) => document.getElementById(id);

function browserName() {
  const brands = navigator.userAgentData?.brands?.map((b) => b.brand) || [];
  if (brands.includes('Google Chrome')) return ['ok', 'Google Chrome'];
  if (brands.includes('Microsoft Edge')) return ['ok', 'Microsoft Edge (Chromium)'];
  if (brands.includes('Chromium')) return ['ok', 'Chromium'];
  if (/Firefox\//.test(navigator.userAgent)) return ['warn', 'Firefox. Built and tested for Chrome. Rumble and key lock may not work.'];
  if (/Safari\//.test(navigator.userAgent) && !/Chrome\//.test(navigator.userAgent)) return ['warn', 'Safari. Built and tested for Chrome.'];
  return ['warn', 'Unknown browser. Use Chrome.'];
}

function platformNote() {
  const p = (navigator.userAgentData?.platform || navigator.platform || '').toLowerCase();
  if (p.includes('win')) return ['ok', 'Windows. The Xbox controller driver is built in. No install needed.'];
  if (p.includes('linux')) return ['ok', 'Linux. USB uses the xpad kernel driver. Check with: lsusb | grep -i 045e'];
  if (p.includes('mac')) return ['warn', 'macOS. Wired USB support for Xbox One controllers depends on the macOS version (unverified). If USB is not seen, Bluetooth comes in v2.'];
  if (p.includes('android') || p.includes('cros')) return ['ok', p];
  return ['warn', p || 'unknown'];
}

function storageOk() {
  try {
    localStorage.setItem('controllerbench.test', '1');
    localStorage.removeItem('controllerbench.test');
    return true;
  } catch {
    return false;
  }
}

export function runChecks() {
  const n = controllerCount();
  const checks = [
    ['Browser', ...browserName()],
    ['Platform', ...platformNote()],
    ['Secure context', window.isSecureContext ? 'ok' : 'bad', window.isSecureContext
      ? 'Yes'
      : 'No. Chrome blocks the Gamepad API here. Open the page at http://127.0.0.1 or http://localhost, not a LAN IP.'],
    ['Gamepad API', 'getGamepads' in navigator ? 'ok' : 'bad', 'getGamepads' in navigator ? 'Available' : 'Not available'],
    ['Controllers seen', n ? 'ok' : 'warn', n ? String(n) : '0. Connect the controller and press a button.'],
    ['Rumble API', 'GamepadHapticActuator' in window ? 'ok' : 'warn', 'GamepadHapticActuator' in window ? 'Available' : 'Not available in this browser'],
    ['Keyboard Lock API', navigator.keyboard?.lock ? 'ok' : 'warn', navigator.keyboard?.lock ? 'Available (works in full screen)' : 'Not available. System keys go to the OS.'],
    ['Browser storage', storageOk() ? 'ok' : 'warn', storageOk() ? 'Writable. Calibration can be saved.' : 'Blocked. Calibration cannot be saved. Use Export JSON.'],
  ];
  const tbody = $('diag-table').querySelector('tbody');
  tbody.textContent = '';
  for (const [name, level, text] of checks) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = name;
    const tdL = document.createElement('td');
    tdL.className = level;
    tdL.textContent = level === 'ok' ? 'OK' : level === 'warn' ? 'Check' : 'Problem';
    const tdT = document.createElement('td');
    tdT.textContent = text;
    tr.append(th, tdL, tdT);
    tbody.appendChild(tr);
  }
  return checks.map(([name, level, text]) => ({ name, level, text }));
}

function renderErrors() {
  const list = window.__cbErrors || [];
  $('err-list').textContent = list.length
    ? list.map((e) => `${e.t}  ${e.msg}${e.count > 1 ? `  (x${e.count})` : ''}`).join('\n')
    : 'none';
  const badge = $('err-badge');
  badge.hidden = !list.length;
  badge.textContent = list.length;
}

export function initDiagnostics() {
  $('diag-refresh').addEventListener('click', runChecks);
  $('err-copy').addEventListener('click', async () => {
    const text = $('err-list').textContent;
    try {
      await navigator.clipboard.writeText(text);
      $('err-copy').textContent = 'Copied';
    } catch {
      $('err-copy').textContent = 'Copy failed. Select the text.';
    }
    setTimeout(() => { $('err-copy').textContent = 'Copy errors'; }, 1500);
  });
  window.addEventListener('cb-error', renderErrors);
  window.addEventListener('gamepadconnected', runChecks);
  window.addEventListener('gamepaddisconnected', runChecks);
  renderErrors();
  runChecks();
}

export function errorList() {
  return (window.__cbErrors || []).slice();
}
