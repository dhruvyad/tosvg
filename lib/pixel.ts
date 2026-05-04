// Pixel-art aware vectorizer: detects the underlying block size, quantizes
// to a small palette, and emits one merged-rectangle <path> per color.
// Output is tiny because identical-color rows of rects collapse into
// vertical bands and runs of same-color cells collapse into wide rects.

export interface PixelOptions {
  colors: number;
  blockSize: number; // 0 = auto-detect
}

export function tracePixel(src: ImageData, opts: PixelOptions): string {
  const block = opts.blockSize > 0 ? opts.blockSize : detectBlockSize(src);
  const cols = Math.max(1, Math.floor(src.width / block));
  const rows = Math.max(1, Math.floor(src.height / block));

  // Sample one pixel per block (the center).
  const samples = new Uint32Array(cols * rows);
  const sd = src.data;
  for (let by = 0; by < rows; by++) {
    const sy = Math.min(src.height - 1, Math.floor((by + 0.5) * block));
    for (let bx = 0; bx < cols; bx++) {
      const sx = Math.min(src.width - 1, Math.floor((bx + 0.5) * block));
      const i = (sy * src.width + sx) * 4;
      samples[by * cols + bx] = (sd[i] << 16) | (sd[i + 1] << 8) | sd[i + 2];
    }
  }

  // Quantize to opts.colors using popularity + nearest-color mapping.
  const palette = buildPalette(samples, opts.colors);
  const indexed = new Uint8Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    indexed[i] = nearestIndex(samples[i], palette);
  }

  // Per color, run greedy rectangle decomposition.
  const w = src.width;
  const h = src.height;
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">`,
  );
  for (let c = 0; c < palette.length; c++) {
    const rects = greedyRects(indexed, cols, rows, c);
    if (!rects.length) continue;
    const d = rectsToPathData(rects, block);
    const fill = `#${palette[c].toString(16).padStart(6, '0')}`;
    parts.push(`<path fill="${fill}" d="${d}"/>`);
  }
  parts.push('</svg>');
  return parts.join('');
}

function detectBlockSize(src: ImageData): number {
  // Sample several horizontal + vertical scan lines and collect run lengths
  // (pixels of the same color). The most common short run length is the
  // pixel-art block size. GCD-based detection breaks on screenshots because
  // anti-aliased single-pixel runs at color boundaries collapse it to 1.
  const w = src.width;
  const h = src.height;
  const d = src.data;
  const runs: number[] = [];
  const lines = [0.2, 0.35, 0.5, 0.65, 0.8];
  for (const f of lines) collectRuns(d, w, h, Math.floor(h * f), true, runs);
  for (const f of lines) collectRuns(d, w, h, Math.floor(w * f), false, runs);

  // Cap at half the shorter side so a flat background run doesn't dominate.
  const cap = Math.max(8, Math.floor(Math.min(w, h) / 2));
  // Skip very short runs: those are almost always anti-alias artifacts on
  // logos/screenshots, not the underlying pixel-art unit.
  const minRun = 8;
  const hist = new Map<number, number>();
  for (const r of runs) {
    if (r >= minRun && r <= cap) hist.set(r, (hist.get(r) ?? 0) + 1);
  }
  if (hist.size === 0) {
    // No clean blocks at all — image is truly continuous-tone. Use a
    // conservative chunky block so output stays small.
    return Math.max(2, Math.floor(Math.min(w, h) / 64));
  }

  // Find peaks (local maxima). The smallest peak is the unit block.
  const lens = [...hist.keys()].sort((a, b) => a - b);
  let maxCount = 0;
  for (const c of hist.values()) if (c > maxCount) maxCount = c;
  const threshold = Math.max(3, Math.floor(maxCount / 4));
  for (let i = 0; i < lens.length; i++) {
    const len = lens[i];
    const count = hist.get(len)!;
    if (count < threshold) continue;
    const leftCount = i > 0 ? (hist.get(lens[i - 1]) ?? 0) : 0;
    const rightCount = i < lens.length - 1 ? (hist.get(lens[i + 1]) ?? 0) : 0;
    if (count >= leftCount && count >= rightCount) return len;
  }
  // Fallback: smallest len above threshold.
  for (const len of lens) {
    if ((hist.get(len) ?? 0) >= threshold) return len;
  }
  return lens[0];
}

function collectRuns(
  d: Uint8ClampedArray,
  w: number,
  h: number,
  fixed: number,
  horizontal: boolean,
  out: number[],
): void {
  const len = horizontal ? w : h;
  let prev = -1;
  let run = 0;
  for (let i = 0; i < len; i++) {
    const x = horizontal ? i : fixed;
    const y = horizontal ? fixed : i;
    if (x < 0 || x >= w || y < 0 || y >= h) continue;
    const idx = (y * w + x) * 4;
    // Quantize to 5 bits per channel so anti-aliasing noise doesn't
    // chop a single visual block into many micro-runs.
    const c =
      ((d[idx] >> 3) << 10) |
      ((d[idx + 1] >> 3) << 5) |
      (d[idx + 2] >> 3);
    if (c === prev) {
      run++;
    } else {
      if (run > 0) out.push(run);
      prev = c;
      run = 1;
    }
  }
  if (run > 0) out.push(run);
}

function buildPalette(samples: Uint32Array, target: number): number[] {
  // Bucket by 4-bit-per-channel key for speed, then keep the top-N
  // populous buckets by their average color.
  const buckets = new Map<number, { sum: [number, number, number]; count: number; key: number }>();
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    const r = (v >> 16) & 0xff;
    const g = (v >> 8) & 0xff;
    const b = v & 0xff;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = buckets.get(key);
    if (e) {
      e.sum[0] += r;
      e.sum[1] += g;
      e.sum[2] += b;
      e.count++;
    } else {
      buckets.set(key, { sum: [r, g, b], count: 1, key });
    }
  }
  const top = [...buckets.values()].sort((a, b) => b.count - a.count).slice(0, target);
  return top.map((e) => {
    const r = Math.round(e.sum[0] / e.count);
    const g = Math.round(e.sum[1] / e.count);
    const b = Math.round(e.sum[2] / e.count);
    return (r << 16) | (g << 8) | b;
  });
}

function nearestIndex(color: number, palette: number[]): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const dr = ((p >> 16) & 0xff) - r;
    const dg = ((p >> 8) & 0xff) - g;
    const db = (p & 0xff) - b;
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function greedyRects(
  indexed: Uint8Array,
  cols: number,
  rows: number,
  color: number,
): Rect[] {
  // Per-row horizontal runs of `color`, then merge vertically when
  // the run on the next row has the same x and width.
  const used = new Uint8Array(indexed.length);
  const out: Rect[] = [];
  for (let y = 0; y < rows; y++) {
    let x = 0;
    while (x < cols) {
      if (used[y * cols + x] || indexed[y * cols + x] !== color) {
        x++;
        continue;
      }
      let runLen = 0;
      while (
        x + runLen < cols &&
        !used[y * cols + x + runLen] &&
        indexed[y * cols + x + runLen] === color
      ) {
        runLen++;
      }
      // Try to grow downward: rows below must have an identical run [x, x+runLen).
      let height = 1;
      grow: while (y + height < rows) {
        for (let k = 0; k < runLen; k++) {
          const idx = (y + height) * cols + (x + k);
          if (used[idx] || indexed[idx] !== color) break grow;
        }
        // Also reject if we could grow further left/right at this row — those
        // pixels will be picked up by their own run later.
        height++;
      }
      for (let yy = 0; yy < height; yy++) {
        for (let xx = 0; xx < runLen; xx++) {
          used[(y + yy) * cols + (x + xx)] = 1;
        }
      }
      out.push({ x, y, w: runLen, h: height });
      x += runLen;
    }
  }
  return out;
}

function rectsToPathData(rects: Rect[], block: number): string {
  // Concise path: each rect becomes "M{x} {y}h{w}v{h}h-{w}z".
  const parts: string[] = [];
  for (const r of rects) {
    const x = r.x * block;
    const y = r.y * block;
    const w = r.w * block;
    const h = r.h * block;
    parts.push(`M${x} ${y}h${w}v${h}h-${w}z`);
  }
  return parts.join('');
}
