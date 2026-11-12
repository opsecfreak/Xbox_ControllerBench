// Desktop mode manager: starts the Windows helper, feeds controller state to
// the engine, sends the engine's commands back, and keeps the settings file.

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAD_BUTTONS, defaultConfig, sanitizeConfig } from './config.js';
import { Engine, commandToLine, parseStateLine } from './engine.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const HELPER_PATH = join(HERE, 'helper.ps1');

export function defaultHelperCommand() {
  return {
    cmd: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', HELPER_PATH],
  };
}

export class DesktopManager {
  /**
   * opts.configPath  settings file (JSON)
   * opts.helper      {cmd, args} to start the helper (tests pass a fake)
   * opts.platform    defaults to process.platform
   * opts.now         clock function (ms)
   */
  constructor(opts = {}) {
    this.configPath = opts.configPath;
    this.helper = opts.helper || defaultHelperCommand();
    this.platform = opts.platform || process.platform;
    this.now = opts.now || (() => performance.now());
    this.config = defaultConfig();
    this.engine = new Engine(this.config);
    this.proc = null;
    this.buf = '';
    this.state = null;
    this.lastError = null;
    this.ready = false;
    this.rumbleTimer = null;
    this.startedAt = null;
    this.lines = 0;
  }

  async loadConfig() {
    try {
      this.config = sanitizeConfig(JSON.parse(await readFile(this.configPath, 'utf8')));
    } catch {
      this.config = defaultConfig();
    }
    this.engine = new Engine(this.config);
    return this.config;
  }

  async saveConfig(obj) {
    const clean = sanitizeConfig(obj);
    await mkdir(dirname(this.configPath), { recursive: true });
    const tmp = this.configPath + '.tmp';
    await writeFile(tmp, JSON.stringify(clean, null, 2));
    await rename(tmp, this.configPath);
    this.config = clean;
    this.send(this.engine.setConfig(clean));
    this.write(`P ${clean.player}`);
    this.write(`I ${clean.pollMs}`);
    return clean;
  }

  get running() {
    return !!this.proc;
  }

  start() {
    if (this.proc) return { ok: true, message: 'Already running.' };
    if (this.platform !== 'win32' && !this.helper.allowAnyPlatform) {
      return { ok: false, message: 'Desktop mode needs Windows. The controller tester still works on this system.' };
    }
    this.lastError = null;
    this.ready = false;
    this.buf = '';
    this.state = null;
    this.engine = new Engine(this.config);
    let proc;
    try {
      proc = spawn(this.helper.cmd, this.helper.args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (err) {
      this.lastError = 'Could not start the helper: ' + err.message;
      return { ok: false, message: this.lastError };
    }
    this.proc = proc;
    this.startedAt = Date.now();
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => this.onData(chunk));
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (chunk) => { this.lastError = String(chunk).trim().slice(0, 500); });
    proc.stdin.on('error', () => {}); // helper gone; exit handler cleans up
    proc.on('error', (err) => { this.lastError = 'Helper error: ' + err.message; });
    proc.on('exit', (code) => {
      if (this.proc === proc) {
        this.proc = null;
        this.ready = false;
        if (code && !this.lastError) this.lastError = `Helper stopped with code ${code}.`;
      }
      clearTimeout(this.rumbleTimer);
    });
    this.write(`P ${this.config.player}`);
    this.write(`I ${this.config.pollMs}`);
    return { ok: true, message: 'Started.' };
  }

  /** Release everything, ask the helper to quit, kill it if it does not. */
  stop() {
    const proc = this.proc;
    if (!proc) return Promise.resolve({ ok: true, message: 'Not running.' });
    this.send(this.engine.releaseAll());
    this.write('R');
    this.write('Q');
    try { proc.stdin.end(); } catch { /* already closed */ }
    return new Promise((resolve) => {
      const t = setTimeout(() => { try { proc.kill(); } catch { /* gone */ } }, 1500);
      proc.once('exit', () => { clearTimeout(t); resolve({ ok: true, message: 'Stopped.' }); });
    });
  }

  write(line) {
    if (!this.proc || !this.proc.stdin.writable) return;
    try { this.proc.stdin.write(line + '\n'); } catch { /* helper gone */ }
  }

  send(commands) {
    for (const c of commands) {
      const line = commandToLine(c);
      if (line) this.write(line);
      if (c.t === 'rumble') {
        clearTimeout(this.rumbleTimer);
        this.rumbleTimer = setTimeout(() => this.write('V 0 0'), Math.min(1000, c.ms || 150));
      }
    }
  }

  onData(chunk) {
    this.buf += chunk;
    if (this.buf.length > 1e6) this.buf = this.buf.slice(-1e5);
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, '');
      this.buf = this.buf.slice(i + 1);
      this.onLine(line);
    }
  }

  onLine(line) {
    this.lines++;
    if (line === 'READY') { this.ready = true; return; }
    if (line.startsWith('ERR')) { this.lastError = line.slice(4); return; }
    if (line === 'N') {
      this.state = { connected: false };
      this.send(this.engine.update(this.state, this.now()));
      return;
    }
    const s = parseStateLine(line, PAD_BUTTONS);
    if (!s) return;
    this.state = s;
    this.send(this.engine.update(s, this.now()));
  }

  /** Turn desktop mode on or off from the settings page. */
  setEnabled(on) {
    if (this.engine.enabled !== !!on) {
      this.engine.enabled = !!on;
      this.send(this.engine.releaseAll());
    }
    return this.engine.enabled;
  }

  status() {
    const s = this.state;
    return {
      platform: this.platform,
      supported: this.platform === 'win32',
      running: this.running,
      ready: this.ready,
      enabled: this.engine.enabled,
      connected: !!s?.connected,
      player: s?.connected ? s.index : null,
      sticks: s?.connected ? { lx: s.lx, ly: s.ly, rx: s.rx, ry: s.ry, lt: s.lt, rt: s.rt } : null,
      buttons: s?.connected ? Object.keys(s.buttons).filter((k) => s.buttons[k]) : [],
      held: [...this.engine.held.keys()],
      lastError: this.lastError,
      startedAt: this.startedAt,
    };
  }
}
