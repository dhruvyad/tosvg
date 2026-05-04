import type { ConvertParams, ConvertResponse } from './types';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (r: ConvertResponse) => void>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.addEventListener('message', (e: MessageEvent<ConvertResponse>) => {
    const cb = pending.get(e.data.id);
    if (cb) {
      pending.delete(e.data.id);
      cb(e.data);
    }
  });
  worker.addEventListener('error', () => {
    // Fail any in-flight requests; the next call will spawn a fresh worker.
    for (const [id, cb] of pending) {
      cb({ id, ok: false, error: 'Worker crashed' });
    }
    pending.clear();
    worker?.terminate();
    worker = null;
  });
  return worker;
}

export function convertInWorker(
  imageData: ImageData,
  params: ConvertParams,
): Promise<ConvertResponse> {
  const id = nextId++;
  const w = getWorker();
  return new Promise((resolve) => {
    pending.set(id, resolve);
    w.postMessage({ id, imageData, params });
  });
}
