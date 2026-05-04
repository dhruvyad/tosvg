export type Mode = 'color' | 'grayscale' | 'bw';

export interface ConvertParams {
  mode: Mode;
  // Shared
  scale: number;
  blur: number;
  // Color / grayscale (imagetracerjs)
  numberofcolors: number;
  pathomit: number;
  ltres: number;
  qtres: number;
  strokewidth: number;
  colorquantcycles: number;
  // Black & white (potrace)
  threshold: number;
  turdsize: number;
  alphamax: number;
  optcurve: boolean;
  opttolerance: number;
}

export const DEFAULT_PARAMS: ConvertParams = {
  mode: 'color',
  scale: 1,
  blur: 0,
  numberofcolors: 16,
  pathomit: 8,
  ltres: 1,
  qtres: 1,
  strokewidth: 1,
  colorquantcycles: 3,
  threshold: 128,
  turdsize: 2,
  alphamax: 1,
  optcurve: true,
  opttolerance: 0.2,
};

export interface ConvertRequest {
  id: number;
  imageData: ImageData;
  params: ConvertParams;
}

export interface ConvertResponse {
  id: number;
  ok: boolean;
  svg?: string;
  error?: string;
  durationMs?: number;
}
