'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_PARAMS, type ConvertParams, type Mode } from '@/lib/types';
import { loadImageFromFile, type LoadedImage } from '@/lib/loadImage';
import { convertInWorker } from '@/lib/converter';

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [loaded, setLoaded] = useState<LoadedImage | null>(null);
  const [params, setParams] = useState<ConvertParams>(DEFAULT_PARAMS);
  const [svg, setSvg] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{ ms: number; bytes: number } | null>(null);
  const [drag, setDrag] = useState(false);
  const reqSeq = useRef(0);
  const debounceTimer = useRef<number | null>(null);

  const onFile = useCallback(async (f: File) => {
    setError(null);
    setSvg('');
    setStats(null);
    setFile(f);
    try {
      const img = await loadImageFromFile(f, { scale: 1, blur: params.blur });
      setLoaded(img);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload pixels when scale/blur change.
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    (async () => {
      try {
        const img = await loadImageFromFile(file, { scale: params.scale, blur: params.blur });
        if (!cancelled) setLoaded(img);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, params.scale, params.blur]);

  // Run conversion (debounced) when image or params change.
  useEffect(() => {
    if (!loaded) return;
    if (debounceTimer.current) window.clearTimeout(debounceTimer.current);
    debounceTimer.current = window.setTimeout(() => {
      runConvert();
    }, 250);
    return () => {
      if (debounceTimer.current) window.clearTimeout(debounceTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, params]);

  const runConvert = useCallback(async () => {
    if (!loaded) return;
    const seq = ++reqSeq.current;
    setBusy(true);
    setError(null);
    const res = await convertInWorker(loaded.imageData, params);
    if (seq !== reqSeq.current) return; // a newer request superseded this one
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? 'Conversion failed');
      return;
    }
    const out = res.svg ?? '';
    setSvg(out);
    setStats({ ms: Math.round(res.durationMs ?? 0), bytes: new Blob([out]).size });
  }, [loaded, params]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDrag(false);
      const f = e.dataTransfer.files?.[0];
      if (f) onFile(f);
    },
    [onFile],
  );

  const downloadUrl = useMemo(() => {
    if (!svg) return null;
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    return URL.createObjectURL(blob);
  }, [svg]);
  useEffect(() => {
    return () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    };
  }, [downloadUrl]);

  const downloadName = useMemo(() => {
    if (!file) return 'image.svg';
    const base = file.name.replace(/\.[^.]+$/, '');
    return `${base}.svg`;
  }, [file]);

  return (
    <main className="app">
      <header className="hero">
        <div>
          <h1>
            tosvg<span className="accent">.</span>
          </h1>
          <p>Convert raster images to SVG, entirely in your browser. No uploads.</p>
        </div>
        <div className="links">
          <a href="https://github.com/dhruvyad/tosvg" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </div>
      </header>

      <div className="layout">
        <aside className="panel">
          <h2>Source</h2>
          <div
            className={`dropzone${drag ? ' drag' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
            onClick={() => document.getElementById('file-input')?.click()}
          >
            {file ? (
              <>
                <strong>{file.name}</strong>
                <div style={{ fontSize: 12, marginTop: 4 }}>
                  {loaded ? `${loaded.width}×${loaded.height}` : 'loading…'} ·{' '}
                  {(file.size / 1024).toFixed(1)} KB · click to change
                </div>
              </>
            ) : (
              <>
                <strong>Drop an image</strong>
                <div style={{ fontSize: 12, marginTop: 4 }}>or click — JPG, PNG, WebP, GIF, BMP</div>
              </>
            )}
          </div>
          <input
            id="file-input"
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
          />

          <h2 style={{ marginTop: 20 }}>Mode</h2>
          <div className="tabs" role="tablist">
            {(['color', 'grayscale', 'bw', 'pixel'] as Mode[]).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={params.mode === m}
                className={params.mode === m ? 'active' : ''}
                onClick={() => setParams((p) => ({ ...p, mode: m }))}
              >
                {m === 'bw' ? 'B&W' : m[0].toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8, lineHeight: 1.5 }}>
            {params.mode === 'pixel' ? (
              <>
                Pixel mode emits merged rectangles per color — best for logos, sprites, screenshots.
                <br />
                <strong style={{ color: 'var(--text)' }}>Block size</strong> controls fidelity vs file size.
                Smaller block = more accurate, larger SVG. A detailed logo typically needs block 2–6;
                clean pixel art works at 8+.
              </>
            ) : (
              'Trace mode vectorizes shapes with Bezier paths. Better for photos and gradients, larger output.'
            )}
          </div>

          <h2 style={{ marginTop: 20 }}>Parameters</h2>
          <div className="controls">
            <Slider
              label="Scale"
              min={0.25}
              max={2}
              step={0.05}
              value={params.scale}
              onChange={(v) => setParams((p) => ({ ...p, scale: v }))}
              hint="Resize input before tracing"
            />
            <Slider
              label="Pre-blur"
              min={0}
              max={5}
              step={0.1}
              value={params.blur}
              onChange={(v) => setParams((p) => ({ ...p, blur: v }))}
              hint="Smooth before tracing"
            />

            {params.mode === 'pixel' && (
              <>
                <Slider
                  label="Colors"
                  min={2}
                  max={32}
                  step={1}
                  value={params.pixelColors}
                  onChange={(v) => setParams((p) => ({ ...p, pixelColors: v }))}
                  hint="Palette size after quantization"
                />
                <Slider
                  label="Block size (0 = auto)"
                  min={0}
                  max={32}
                  step={1}
                  value={params.pixelBlockSize}
                  onChange={(v) => setParams((p) => ({ ...p, pixelBlockSize: v }))}
                  hint="Source pixel-block edge length"
                />
              </>
            )}

            {(params.mode === 'color' || params.mode === 'grayscale') && (
              <>
                <Slider
                  label="Colors"
                  min={2}
                  max={64}
                  step={1}
                  value={params.numberofcolors}
                  onChange={(v) => setParams((p) => ({ ...p, numberofcolors: v }))}
                  hint="Palette size"
                />
                <Slider
                  label="Color quant cycles"
                  min={1}
                  max={5}
                  step={1}
                  value={params.colorquantcycles}
                  onChange={(v) => setParams((p) => ({ ...p, colorquantcycles: v }))}
                />
              </>
            )}

            {params.mode === 'bw' && (
              <Slider
                label="Threshold"
                min={1}
                max={254}
                step={1}
                value={params.threshold}
                onChange={(v) => setParams((p) => ({ ...p, threshold: v }))}
                hint="Black/white cutoff"
              />
            )}

            {params.mode !== 'pixel' && (
              <>
                <Slider
                  label="Min path size"
                  min={0}
                  max={32}
                  step={1}
                  value={params.pathomit}
                  onChange={(v) => setParams((p) => ({ ...p, pathomit: v }))}
                  hint="Drop tiny shapes (speckle filter)"
                />
                <Slider
                  label="Line tolerance"
                  min={0}
                  max={5}
                  step={0.1}
                  value={params.ltres}
                  onChange={(v) => setParams((p) => ({ ...p, ltres: v }))}
                  hint="Higher = simpler straight segments"
                />
                <Slider
                  label="Curve tolerance"
                  min={0}
                  max={5}
                  step={0.1}
                  value={params.qtres}
                  onChange={(v) => setParams((p) => ({ ...p, qtres: v }))}
                  hint="Higher = smoother curves"
                />
                <Slider
                  label="Stroke width"
                  min={0}
                  max={5}
                  step={0.25}
                  value={params.strokewidth}
                  onChange={(v) => setParams((p) => ({ ...p, strokewidth: v }))}
                />
              </>
            )}

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <input
                type="checkbox"
                checked={params.optimize}
                onChange={(e) => setParams((p) => ({ ...p, optimize: e.target.checked }))}
              />
              Optimize output (round coords, hex colors, strip whitespace)
            </label>
          </div>

          <div className="actions">
            <button onClick={runConvert} disabled={!loaded || busy}>
              {busy ? 'Converting…' : 'Re-run'}
            </button>
            <button className="secondary" onClick={() => setParams(DEFAULT_PARAMS)}>
              Reset
            </button>
          </div>
          <div className={`status${error ? ' error' : ''}`}>
            {error ?? (busy ? 'Tracing in worker…' : stats ? `${stats.ms} ms` : ' ')}
          </div>
        </aside>

        <section className="panel">
          <h2>Preview</h2>
          <div className="preview">
            <div className="pane">
              <span className="label">Input</span>
              {loaded ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={loaded.dataUrl} alt="input" />
              ) : (
                <div className="empty">No image yet</div>
              )}
            </div>
            <div className="pane">
              <span className="label">SVG</span>
              {svg ? (
                <div className="svg-wrap" dangerouslySetInnerHTML={{ __html: svg }} />
              ) : (
                <div className="empty">{loaded ? 'Tracing…' : '—'}</div>
              )}
            </div>
          </div>

          {stats && (
            <div className="kv">
              <span>{stats.ms} ms</span>
              <span>{(stats.bytes / 1024).toFixed(1)} KB SVG</span>
              {loaded && <span>{loaded.width}×{loaded.height} px</span>}
              <span>mode: {params.mode}</span>
            </div>
          )}

          <div className="actions">
            <a
              href={downloadUrl ?? '#'}
              download={downloadName}
              style={{
                pointerEvents: downloadUrl ? 'auto' : 'none',
                opacity: downloadUrl ? 1 : 0.5,
              }}
            >
              <button disabled={!downloadUrl}>Download SVG</button>
            </a>
            <button
              className="secondary"
              disabled={!svg}
              onClick={() => svg && navigator.clipboard.writeText(svg)}
            >
              Copy SVG
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
  hint,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <div>
      <label>
        {label}
        {hint ? <span style={{ color: '#555', marginLeft: 6 }}>· {hint}</span> : null}
      </label>
      <div className="control-row">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <div className="value">{value}</div>
      </div>
    </div>
  );
}
