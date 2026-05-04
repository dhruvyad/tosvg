// Local benchmark harness: feeds a PNG through the in-app pixel tracer +
// optimizer with a sweep of params and reports SVG sizes.
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { tracePixel } from '../lib/pixel';
import { optimizeSvg } from '../lib/optimize';

const file = process.argv[2] || '/tmp/hermes.png';
const png = PNG.sync.read(fs.readFileSync(file));
const imageData = {
  data: png.data,
  width: png.width,
  height: png.height,
} as unknown as ImageData;

const dir = '/tmp/tosvg-out';
fs.mkdirSync(dir, { recursive: true });

function record(name: string, svg: string) {
  const opt = optimizeSvg(svg);
  fs.writeFileSync(path.join(dir, `${name}.svg`), opt);
  return { raw: svg.length, opt: opt.length };
}

console.log(
  `Source: ${file}  ${png.width}x${png.height}  source PNG ${(fs.statSync(file).size / 1024).toFixed(1)} KB`,
);
console.log('=== Pixel mode ===');
console.log('colors\tblock\topt KB\tfile');
const blocks = [4, 8, 12, 14, 16, 20, 24, 32];
const colorChoices = [3, 4, 6, 8];
for (const colors of colorChoices) {
  for (const blockSize of blocks) {
    const svg = tracePixel(imageData, { colors, blockSize });
    const name = `pixel_c${colors}_b${blockSize}`;
    const r = record(name, svg);
    console.log(`${colors}\t${blockSize}\t${(r.opt / 1024).toFixed(2)}\t${name}.svg`);
  }
}

console.log('\n=== Auto block detect ===');
for (const colors of colorChoices) {
  const svg = tracePixel(imageData, { colors, blockSize: 0 });
  const name = `pixel_c${colors}_auto`;
  const r = record(name, svg);
  console.log(`${colors}\t(auto)\t${(r.opt / 1024).toFixed(2)}\t${name}.svg`);
}
