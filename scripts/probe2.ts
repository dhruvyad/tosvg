// Probe palette + indexed-map for the test image. Find the cells in a
// horizontal slice through a letter and see which palette index each
// cell got assigned to. This reveals whether visible "gaps" come from a
// transition-color bucket between the main yellows.
import fs from 'node:fs';
import { PNG } from 'pngjs';

const file = process.argv[2] || '/tmp/hermes.png';
const png = PNG.sync.read(fs.readFileSync(file));
const sd = png.data;
const w = png.width;
const h = png.height;
const block = 4;
const colors = 6;

// Same palette logic as in pixel.ts
const buckets = new Map<number, { r: number; g: number; b: number; count: number }>();
const total = w * h;
const stride = Math.max(1, Math.floor(Math.sqrt(total / 8000)));
for (let y = 0; y < h; y += stride) {
  let i = y * w * 4;
  for (let x = 0; x < w; x += stride, i += stride * 4) {
    const r = sd[i], g = sd[i + 1], b = sd[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = buckets.get(key);
    if (e) {
      e.r += r; e.g += g; e.b += b; e.count++;
    } else {
      buckets.set(key, { r, g, b, count: 1 });
    }
  }
}
const top = [...buckets.values()].sort((a, b) => b.count - a.count).slice(0, colors);
const palette = top.map((e) => {
  const r = Math.round(e.r / e.count);
  const g = Math.round(e.g / e.count);
  const b = Math.round(e.b / e.count);
  return (r << 16) | (g << 8) | b;
});

console.log('Palette (in popularity order):');
palette.forEach((p, i) => {
  const hex = p.toString(16).padStart(6, '0');
  console.log(`  [${i}] #${hex}  (${(p >> 16) & 255}, ${(p >> 8) & 255}, ${p & 255})  count=${top[i].count}`);
});

// Sample a horizontal slice through the R (around y=200, x=540-720)
function nearest(c: number): number {
  let best = 0, bd = Infinity;
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const dr = ((p >> 16) & 255) - r;
    const dg = ((p >> 8) & 255) - g;
    const db = (p & 255) - b;
    const d = dr * dr + dg * dg + db * db;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

console.log('\nVertical slice through R at x=600 (every block, full image height):');
const bx = Math.floor(600 / block);
for (let by = 0; by < Math.floor(h / block); by++) {
  const y0 = by * block, y1 = y0 + block;
  const x0 = bx * block, x1 = x0 + block;
  const votes = new Array(palette.length).fill(0);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      const c = (sd[i] << 16) | (sd[i + 1] << 8) | sd[i + 2];
      votes[nearest(c)]++;
    }
  }
  let best = 0, bestV = votes[0];
  for (let k = 1; k < votes.length; k++) if (votes[k] > bestV) { bestV = votes[k]; best = k; }
  if (by % 4 === 0 || (by > 30 && by < 80)) {
    console.log(`  by=${by} y=${y0}: idx=${best} #${palette[best].toString(16).padStart(6, '0')}  votes=${votes.join(',')}`);
  }
}
