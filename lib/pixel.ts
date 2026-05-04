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

  // Build a coarse palette from a stride sample of the full image, then
  // assign every block's *majority-quantized color* to one palette index.
  // Majority is more stable than center-pixel sampling at block boundaries.
  const palette = buildPaletteFromImage(src, opts.colors);
  const indexed = new Uint8Array(cols * rows);
  const sd = src.data;
  const w = src.width;
  const h = src.height;
  // votes[c] reused per block — small fixed array, fast.
  const votes = new Uint32Array(palette.length);
  for (let by = 0; by < rows; by++) {
    const y0 = by * block;
    const y1 = Math.min(h, y0 + block);
    for (let bx = 0; bx < cols; bx++) {
      const x0 = bx * block;
      const x1 = Math.min(w, x0 + block);
      votes.fill(0);
      for (let y = y0; y < y1; y++) {
        let i = (y * w + x0) * 4;
        for (let x = x0; x < x1; x++, i += 4) {
          const c = (sd[i] << 16) | (sd[i + 1] << 8) | sd[i + 2];
          votes[nearestIndex(c, palette)]++;
        }
      }
      let best = 0;
      let bestVotes = votes[0];
      for (let k = 1; k < votes.length; k++) {
        if (votes[k] > bestVotes) {
          bestVotes = votes[k];
          best = k;
        }
      }
      indexed[by * cols + bx] = best;
    }
  }

  // Mode filter (cell + 4 cardinal neighbors). Kills isolated artifacts
  // and straightens color boundaries that wobble by 1 block due to
  // sub-block anti-aliasing in the source. Only flips a cell when
  // 3+ of its 5-cell cross share a different color — preserves thin
  // 1-block lines (a horizontal line cell has 2 same-color horizontal
  // neighbors so it sticks).
  modeFilter(indexed, cols, rows, palette.length);

  // Per color, run largest-rectangle-first decomposition, then split rects
  // into "thick" (filled) and "thin" (stroked) groups. A 1-block-thick
  // rectangle rendered as a stroke of width=block centered on its midline
  // covers identical pixels but compresses the path data ~50% — a huge
  // win on outline-heavy images.
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">`,
  );
  for (let c = 0; c < palette.length; c++) {
    const rects = maxRectDecompose(indexed, cols, rows, c);
    if (!rects.length) continue;
    const fill = `#${palette[c].toString(16).padStart(6, '0')}`;
    const thick: Rect[] = [];
    const thin: Rect[] = [];
    for (const r of rects) {
      if (r.w >= 2 && r.h >= 2) thick.push(r);
      else thin.push(r);
    }
    if (thick.length) {
      parts.push(`<path fill="${fill}" d="${rectsToPathData(thick, block, w, h)}"/>`);
    }
    if (thin.length) {
      parts.push(
        `<path stroke="${fill}" stroke-width="${block}" fill="none" d="${thinRectsToStrokeData(
          thin,
          block,
        )}"/>`,
      );
    }
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

function modeFilter(
  indexed: Uint8Array,
  cols: number,
  rows: number,
  paletteSize: number,
): void {
  // Conservative isolated-cell filter: only flip a cell when all 4
  // cardinal neighbors agree on the same color different from self.
  // Kills 1-cell anti-alias artifacts at color boundaries while
  // preserving every linear feature (any cell with a same-color
  // horizontal OR vertical neighbor stays put).
  const tmp = new Uint8Array(indexed);
  for (let y = 1; y < rows - 1; y++) {
    const off = y * cols;
    for (let x = 1; x < cols - 1; x++) {
      const me = indexed[off + x];
      const up = indexed[off - cols + x];
      const down = indexed[off + cols + x];
      const left = indexed[off + x - 1];
      const right = indexed[off + x + 1];
      if (up === down && up === left && up === right && up !== me) {
        tmp[off + x] = up;
      }
    }
  }
  for (let i = 0; i < indexed.length; i++) indexed[i] = tmp[i];
}

function buildPaletteFromImage(src: ImageData, target: number): number[] {
  // K-means in RGB. Bucket popularity alone produces "transition" shades —
  // dark grays sitting between a yellow and the black background — that
  // get assigned to anti-aliased boundary cells and render as visible
  // gaps. K-means pulls those samples into the closest dominant cluster
  // instead, so the palette has well-separated colors and boundary cells
  // collapse onto the right one.
  const sd = src.data;
  const w = src.width;
  const h = src.height;
  const total = w * h;
  const stride = Math.max(1, Math.floor(Math.sqrt(total / 8000)));
  const samples: number[] = []; // flat [r,g,b,...]
  for (let y = 0; y < h; y += stride) {
    let i = y * w * 4;
    for (let x = 0; x < w; x += stride, i += stride * 4) {
      samples.push(sd[i], sd[i + 1], sd[i + 2]);
    }
  }
  const n = samples.length / 3;

  // Seed centers from the top color buckets — gives us a sensible
  // starting point so k-means converges in a couple of iterations.
  const buckets = new Map<number, [number, number, number, number]>();
  for (let s = 0; s < samples.length; s += 3) {
    const r = samples[s], g = samples[s + 1], b = samples[s + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = buckets.get(key);
    if (e) {
      e[0] += r; e[1] += g; e[2] += b; e[3]++;
    } else {
      buckets.set(key, [r, g, b, 1]);
    }
  }
  const seeds = [...buckets.values()].sort((a, b) => b[3] - a[3]).slice(0, target);
  const cR = new Float64Array(target);
  const cG = new Float64Array(target);
  const cB = new Float64Array(target);
  for (let i = 0; i < seeds.length; i++) {
    cR[i] = seeds[i][0] / seeds[i][3];
    cG[i] = seeds[i][1] / seeds[i][3];
    cB[i] = seeds[i][2] / seeds[i][3];
  }
  // If we got fewer seeds than target, pad with pure black to avoid NaNs.
  for (let i = seeds.length; i < target; i++) {
    cR[i] = 0; cG[i] = 0; cB[i] = 0;
  }

  const sumR = new Float64Array(target);
  const sumG = new Float64Array(target);
  const sumB = new Float64Array(target);
  const cnt = new Uint32Array(target);
  for (let iter = 0; iter < 10; iter++) {
    sumR.fill(0); sumG.fill(0); sumB.fill(0); cnt.fill(0);
    for (let s = 0; s < samples.length; s += 3) {
      const r = samples[s], g = samples[s + 1], b = samples[s + 2];
      let best = 0, bd = Infinity;
      for (let i = 0; i < target; i++) {
        const dr = cR[i] - r, dg = cG[i] - g, db = cB[i] - b;
        const d = dr * dr + dg * dg + db * db;
        if (d < bd) { bd = d; best = i; }
      }
      sumR[best] += r; sumG[best] += g; sumB[best] += b; cnt[best]++;
    }
    let moved = 0;
    for (let i = 0; i < target; i++) {
      if (cnt[i] === 0) continue;
      const nr = sumR[i] / cnt[i];
      const ng = sumG[i] / cnt[i];
      const nb = sumB[i] / cnt[i];
      moved += Math.abs(nr - cR[i]) + Math.abs(ng - cG[i]) + Math.abs(nb - cB[i]);
      cR[i] = nr; cG[i] = ng; cB[i] = nb;
    }
    if (moved < 1) break;
  }

  // Collect non-empty clusters with their counts.
  const clusters: { color: number; count: number; r: number; g: number; b: number }[] = [];
  for (let i = 0; i < target; i++) {
    if (cnt[i] === 0) continue;
    const r = Math.round(cR[i]);
    const g = Math.round(cG[i]);
    const bb = Math.round(cB[i]);
    clusters.push({ color: (r << 16) | (g << 8) | bb, count: cnt[i], r, g, b: bb });
  }

  // Merge near-duplicate clusters (e.g. two brown variants only ~5 RGB
  // units apart, both produced by k-means converging on similar centers).
  // Without this, the smaller variant gets assigned to anti-aliased
  // boundary cells and renders as a faint ghost line. Threshold tuned by
  // eye on representative images.
  const mergeThreshold = 15;
  const merged: typeof clusters = [];
  clusters.sort((a, b) => b.count - a.count);
  for (const c of clusters) {
    let absorbed = false;
    for (const m of merged) {
      const dr = m.r - c.r, dg = m.g - c.g, db = m.b - c.b;
      const d = Math.sqrt(dr * dr + dg * dg + db * db);
      if (d < mergeThreshold) {
        // Weighted-average merge into the larger cluster.
        const total = m.count + c.count;
        m.r = Math.round((m.r * m.count + c.r * c.count) / total);
        m.g = Math.round((m.g * m.count + c.g * c.count) / total);
        m.b = Math.round((m.b * m.count + c.b * c.count) / total);
        m.color = (m.r << 16) | (m.g << 8) | m.b;
        m.count = total;
        absorbed = true;
        break;
      }
    }
    if (!absorbed) merged.push(c);
  }

  return merged.map((m) => m.color);
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

function maxRectDecompose(
  indexed: Uint8Array,
  cols: number,
  rows: number,
  color: number,
): Rect[] {
  // Build a per-color mask, then repeatedly extract the largest all-1
  // rectangle until empty. Using the standard histogram + monotonic-stack
  // largest-rect-in-histogram algorithm. Produces dramatically fewer (and
  // visually larger) rectangles than row-greedy decomposition for shapes
  // dominated by big same-color regions.
  const mask = new Uint8Array(cols * rows);
  for (let i = 0; i < mask.length; i++) if (indexed[i] === color) mask[i] = 1;

  const out: Rect[] = [];
  const heights = new Uint32Array(cols);
  // Tunable: stop emitting rects once the largest remaining is tiny — the
  // residue is single cells that won't visibly change the result. For
  // pixel-art fidelity we want them, but the user can scale block down.
  while (true) {
    heights.fill(0);
    let bestArea = 0;
    let best: Rect | null = null;

    // Sweep: for each row, update column heights and find the largest
    // rectangle in the histogram. Track the best across all rows.
    const stack = new Int32Array(cols + 1);
    const stackH = new Int32Array(cols + 1);
    for (let y = 0; y < rows; y++) {
      const rowOff = y * cols;
      for (let x = 0; x < cols; x++) {
        heights[x] = mask[rowOff + x] ? heights[x] + 1 : 0;
      }
      let sp = 0;
      for (let x = 0; x <= cols; x++) {
        const cur = x === cols ? 0 : heights[x];
        let left = x;
        while (sp > 0 && stackH[sp - 1] > cur) {
          sp--;
          const h = stackH[sp];
          const l = stack[sp];
          const area = h * (x - l);
          if (area > bestArea) {
            bestArea = area;
            best = { x: l, y: y - h + 1, w: x - l, h };
          }
          left = l;
        }
        if (sp === 0 || stackH[sp - 1] < cur) {
          stack[sp] = left;
          stackH[sp] = cur;
          sp++;
        }
      }
    }

    if (!best || bestArea === 0) break;
    // Punch out the rectangle and continue.
    for (let yy = best.y; yy < best.y + best.h; yy++) {
      const off = yy * cols;
      for (let xx = best.x; xx < best.x + best.w; xx++) mask[off + xx] = 0;
    }
    out.push(best);
  }
  return out;
}

function thinRectsToStrokeData(rects: Rect[], block: number): string {
  // Each thin rect (w==1 or h==1) becomes one stroke segment along its
  // centerline. Sort by (axis, primary, secondary) so that consecutive
  // segments often share an endpoint, which would let us drop the M.
  // For now, emit each as its own M+h or M+v subpath; the path optimizer
  // will collapse coordinate spacing.
  const half = block / 2;
  // Split into horizontal-axis (h==1) and vertical-axis (w==1) groups
  // so the d attribute groups like-direction commands together — the
  // resulting string compresses better and reads cleaner.
  const horiz: Rect[] = [];
  const vert: Rect[] = [];
  const dot: Rect[] = [];
  for (const r of rects) {
    if (r.w === 1 && r.h === 1) dot.push(r);
    else if (r.h === 1) horiz.push(r);
    else vert.push(r);
  }
  // Sort for cache-friendly walks (top-to-bottom, left-to-right).
  horiz.sort((a, b) => a.y - b.y || a.x - b.x);
  vert.sort((a, b) => a.x - b.x || a.y - b.y);

  const parts: string[] = [];
  for (const r of horiz) {
    const x = r.x * block;
    const y = r.y * block + half;
    const w = r.w * block;
    parts.push(`M${x} ${y}h${w}`);
  }
  for (const r of vert) {
    const x = r.x * block + half;
    const y = r.y * block;
    const h = r.h * block;
    parts.push(`M${x} ${y}v${h}`);
  }
  for (const r of dot) {
    // 1×1 dots become a zero-length stroke (rendered as a square cap of
    // width=block). With default linecap="butt" they'd be invisible, so
    // emit as a tiny h0 with linecap="square" implied via a fallback rect.
    // Simplest: emit as a 1-unit horizontal stroke; the rendered footprint
    // is still block×block (rounding effects) — close enough.
    const x = r.x * block;
    const y = r.y * block + half;
    parts.push(`M${x} ${y}h${block}`);
  }
  return parts.join('');
}

function rectsToPathData(rects: Rect[], block: number, srcW: number, srcH: number): string {
  // Each rect: "M{x} {y}h{w}v{h}h-{w}". 'z' is optional (SVG fills open
  // subpaths), so we drop it. Also clamp the right/bottom of edge rects
  // to the source dimensions so the SVG covers the full viewBox even
  // when block doesn't divide width/height evenly.
  const parts: string[] = [];
  for (const r of rects) {
    const x = r.x * block;
    const y = r.y * block;
    const wEnd = Math.min((r.x + r.w) * block, srcW);
    const hEnd = Math.min((r.y + r.h) * block, srcH);
    const w = wEnd - x;
    const h = hEnd - y;
    if (w <= 0 || h <= 0) continue;
    parts.push(`M${x} ${y}h${w}v${h}h-${w}`);
  }
  return parts.join('');
}
