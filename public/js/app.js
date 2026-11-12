// Entry point: tabs, report export, module start-up.

import { initController, controllerReport, download } from './controller.js';
import { initKeyboard, setKeyboardActive, keyboardReport } from './keyboard.js';
import { initDiagnostics, runChecks, errorList } from './diagnostics.js';

export const VERSION = 'v4';

function showTab(name) {
  for (const t of document.querySelectorAll('.tab')) t.setAttribute('aria-selected', String(t.dataset.tab === name));
  for (const p of document.querySelectorAll('.panel-set')) p.hidden = p.dataset.panel !== name;
  setKeyboardActive(name === 'keyboard');
  if (name === 'diagnostics') runChecks();
  try { localStorage.setItem('controllerbench.tab', name); } catch { /* storage blocked */ }
}

function start() {
  document.getElementById('app-version').textContent = VERSION;
  initController();
  initKeyboard();
  initDiagnostics();

  for (const t of document.querySelectorAll('.tab')) t.addEventListener('click', () => showTab(t.dataset.tab));
  let tab = 'controller';
  try { tab = localStorage.getItem('controllerbench.tab') || tab; } catch { /* storage blocked */ }
  if (!document.querySelector(`.tab[data-tab="${tab}"]`)) tab = 'controller';
  showTab(tab);

  document.getElementById('export-report').addEventListener('click', () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    download(`controllerbench-report-${stamp}.json`, {
      app: 'ControllerBench',
      version: VERSION,
      created: new Date().toISOString(),
      userAgent: navigator.userAgent,
      controller: controllerReport(),
      keyboard: keyboardReport(),
      checks: runChecks(),
      errors: errorList(),
    });
  });
}

start();
