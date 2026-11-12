// Fake desktop helper for tests: acts like helper.ps1 without Windows.
// argv[2] = file to record every command received.
import { appendFileSync, writeFileSync } from 'node:fs';
const out = process.argv[2];
writeFileSync(out, '');
process.stdout.write('READY\n');
let t = 0;
const timer = setInterval(() => {
  t += 10;
  // Left stick full right; A pressed from 40 ms to 120 ms.
  const buttons = t >= 40 && t < 120 ? 0x1000 : 0;
  process.stdout.write(`S 0 ${t} ${buttons} 0 0 32767 0 0 0\n`);
}, 10);
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    appendFileSync(out, line + '\n');
    if (line === 'Q') { clearInterval(timer); process.exit(0); }
  }
});
process.stdin.on('end', () => { clearInterval(timer); process.exit(0); });
