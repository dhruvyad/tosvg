// Lightweight, lossless-ish SVG post-processing pass. Targets imagetracerjs
// output specifically (lots of "rgb(r,g,b)" fills, redundant whitespace,
// path coords with too many decimals).

export function optimizeSvg(svg: string): string {
  let s = svg;

  // rgb(r,g,b) -> #rrggbb
  s = s.replace(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/g, (_, r, g, b) => {
    const h = (n: string) => Number(n).toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
  });

  // Round path coordinate runs to 1 decimal place inside d="..." attrs.
  s = s.replace(/\bd="([^"]+)"/g, (_, d: string) => `d="${roundPathData(d)}"`);

  // Strip stroke-width="1"/"0" when there is no stroke set; imagetracerjs
  // emits these on every path even when stroke is "none".
  s = s.replace(/\s+stroke-width="(0|1)"/g, '');
  // Strip explicit stroke="..." when fill matches and stroke ends up redundant.
  // (Conservative: only remove `stroke="none"`.)
  s = s.replace(/\s+stroke="none"/g, '');

  // Collapse runs of whitespace between tags.
  s = s.replace(/>\s+</g, '><');
  // Collapse internal whitespace inside attributes is risky; skip.

  // Drop trailing newlines.
  return s.trim();
}

function roundPathData(d: string): string {
  // Keep commands intact, round numeric tokens to 1 decimal, drop trailing zeros.
  return d.replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi, (n) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return n;
    const rounded = Math.round(v * 10) / 10;
    // Print without trailing ".0"
    if (Number.isInteger(rounded)) return String(rounded);
    return String(rounded);
  });
}
