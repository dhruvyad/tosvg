# tosvg

Convert raster images (JPG, PNG, WebP, GIF, BMP) to SVG entirely in your browser. No backend, no uploads — your image never leaves your machine.

## Features

- Color, grayscale, and black-and-white tracing modes
- Tunable parameters: palette size, color quantization cycles, threshold, line/curve tolerance, min path size, stroke width, scale, pre-blur
- Live preview with side-by-side input/output
- Download SVG or copy to clipboard
- Runs in a Web Worker so the UI stays responsive
- Static export — host anywhere (GitHub Pages, Vercel, S3, IPFS)

## Stack

- Next.js 14 (App Router, static export)
- React 18 + TypeScript
- [imagetracerjs](https://github.com/jankovicsandras/imagetracerjs) for the trace
- Pure black/white pure dark UI

## Develop

```bash
npm install
npm run dev
```

## Build

```bash
npm run build      # outputs static site to ./out
```

## License

MIT
