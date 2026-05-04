export type Mode = 'color' | 'grayscale' | 'bw' | 'pixel';

export interface ConvertParams {
  mode: Mode;
  // Shared
  scale: number;
  blur: number;
  optimize: boolean;
  // Color / grayscale (imagetracerjs)
  numberofcolors: number;
  pathomit: number;
  ltres: number;
  qtres: number;
  strokewidth: number;
  colorquantcycles: number;
  // Black & white
  threshold: number;
  // Pixel mode
  pixelColors: number;
  pixelBlockSize: number; // 0 = auto-detect
}

export const DEFAULT_PARAMS: ConvertParams = {
  mode: 'color',
  scale: 1,
  blur: 0,
  optimize: true,
  numberofcolors: 16,
  pathomit: 8,
  ltres: 1,
  qtres: 1,
  strokewidth: 1,
  colorquantcycles: 3,
  threshold: 128,
  pixelColors: 4,
  pixelBlockSize: 4,
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
