export interface LoadedImage {
  imageData: ImageData;
  width: number;
  height: number;
  dataUrl: string;
}

export async function loadImageFromFile(
  file: File,
  options: { scale?: number; blur?: number; maxDim?: number } = {},
): Promise<LoadedImage> {
  const { scale = 1, blur = 0, maxDim = 2048 } = options;

  const dataUrl = await fileToDataURL(file);
  const img = await loadHTMLImage(dataUrl);

  let w = img.naturalWidth * scale;
  let h = img.naturalHeight * scale;
  const longest = Math.max(w, h);
  if (longest > maxDim) {
    const k = maxDim / longest;
    w = Math.round(w * k);
    h = Math.round(h * k);
  } else {
    w = Math.round(w);
    h = Math.round(h);
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not get 2D context');
  if (blur > 0) ctx.filter = `blur(${blur}px)`;
  ctx.drawImage(img, 0, 0, w, h);
  ctx.filter = 'none';

  const imageData = ctx.getImageData(0, 0, w, h);
  return { imageData, width: w, height: h, dataUrl };
}

function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => resolve(r.result as string);
    r.readAsDataURL(file);
  });
}

function loadHTMLImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onerror = () => reject(new Error('Failed to load image'));
    img.onload = () => resolve(img);
    img.src = src;
  });
}
