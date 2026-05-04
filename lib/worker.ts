/// <reference lib="webworker" />
import type { ConvertParams, ConvertRequest, ConvertResponse } from './types';

declare const self: DedicatedWorkerGlobalScope;

self.addEventListener('message', async (e: MessageEvent<ConvertRequest>) => {
  const { id, imageData, params } = e.data;
  const start = performance.now();
  try {
    const svg = await trace(imageData, params);
    const res: ConvertResponse = { id, ok: true, svg, durationMs: performance.now() - start };
    self.postMessage(res);
  } catch (err) {
    const res: ConvertResponse = {
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: performance.now() - start,
    };
    self.postMessage(res);
  }
});

async function trace(imageData: ImageData, p: ConvertParams): Promise<string> {
  const mod = (await import('imagetracerjs')) as unknown as {
    default?: { imagedataToSVG: (id: ImageData, opts: Record<string, unknown>) => string };
    imagedataToSVG?: (id: ImageData, opts: Record<string, unknown>) => string;
  };
  const api = (mod.imagedataToSVG ? mod : mod.default) as {
    imagedataToSVG: (id: ImageData, opts: Record<string, unknown>) => string;
  };

  const data = p.mode === 'bw' ? thresholdToBW(imageData, p.threshold) : imageData;

  const numberofcolors =
    p.mode === 'bw' ? 2 : p.mode === 'grayscale' ? Math.min(p.numberofcolors, 16) : p.numberofcolors;

  const opts: Record<string, unknown> = {
    numberofcolors,
    pathomit: p.pathomit,
    ltres: p.ltres,
    qtres: p.qtres,
    strokewidth: p.strokewidth,
    colorquantcycles: p.colorquantcycles,
    mincolorratio: 0,
    colorsampling: p.mode === 'bw' ? 0 : 2,
    linefilter: p.mode === 'bw',
    rightangleenhance: true,
    viewbox: true,
    blurradius: 0,
  };

  let svg = api.imagedataToSVG(data, opts);
  if (p.mode === 'grayscale') svg = desaturateSVG(svg);
  return svg;
}

function thresholdToBW(src: ImageData, threshold: number): ImageData {
  const out = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const v = lum >= threshold ? 255 : 0;
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
    d[i + 3] = 255;
  }
  return out;
}

function desaturateSVG(svg: string): string {
  return svg.replace(/fill="rgb\((\d+),(\d+),(\d+)\)"/g, (_, r, g, b) => {
    const v = Math.round(0.299 * Number(r) + 0.587 * Number(g) + 0.114 * Number(b));
    return `fill="rgb(${v},${v},${v})"`;
  });
}
