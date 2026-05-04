import fs from 'node:fs';
import { PNG } from 'pngjs';

const file = process.argv[2] || '/tmp/hermes.png';
const png = PNG.sync.read(fs.readFileSync(file));
const w = png.width, h = png.height, d = png.data;

const runs: number[] = [];
const lines = [0.2, 0.35, 0.5, 0.65, 0.8];

function collect(fixed: number, horizontal: boolean) {
  const len = horizontal ? w : h;
  let prev = -1, run = 0;
  for (let i = 0; i < len; i++) {
    const x = horizontal ? i : fixed;
    const y = horizontal ? fixed : i;
    const idx = (y * w + x) * 4;
    const c = ((d[idx] >> 3) << 10) | ((d[idx + 1] >> 3) << 5) | (d[idx + 2] >> 3);
    if (c === prev) run++;
    else {
      if (run > 0) runs.push(run);
      prev = c;
      run = 1;
    }
  }
  if (run > 0) runs.push(run);
}
for (const f of lines) collect(Math.floor(h * f), true);
for (const f of lines) collect(Math.floor(w * f), false);

const cap = Math.max(8, Math.floor(Math.min(w, h) / 2));
const hist = new Map<number, number>();
for (const r of runs) if (r >= 2 && r <= cap) hist.set(r, (hist.get(r) ?? 0) + 1);

const sorted = [...hist.entries()].sort((a, b) => b[1] - a[1]);
console.log(`Image ${w}x${h}, cap ${cap}`);
console.log('Top 20 run lengths by frequency:');
for (const [len, c] of sorted.slice(0, 20)) console.log(`  len=${len}\tcount=${c}`);
