"use client";

import { useEffect, useRef } from "react";

/*
 * Hero artwork rendered as an ASCII / dot-matrix field.
 *
 * Left: a fanned stack of document pages whose front sheet sheds "chunks".
 * Right: a rotating globe standing in for the vector space.
 * Chunks shrink into single points that travel along a curve into the globe,
 * which is the ingestion pipeline, drawn in characters.
 *
 * Every grid cell gets an intensity in [0, 1] that picks a glyph:
 * faint dots, then punctuation, then dense characters, then solid discs.
 */

const LIGHT = ".:'";
const MID = "?!*+:;";
const DENSE = "%S$#&";
const FALLBACK_INK = "40, 40, 40";

/** The theme's ink colour as "r, g, b", so the artwork follows light/dark mode. */
function readInk(): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--color-ink").trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(value)?.[1];
  if (!hex) return FALLBACK_INK;
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ");
}
const ALPHA_BUCKETS = 6;
const FRAME_MS = 1000 / 30;
const POINTER_RADIUS = 90;

type Page = { cx: number; cy: number; w: number; h: number; rot: number; seed: number };
type Chunk = { x: number; y: number; w: number; h: number; alpha: number; seed: number };
type Dot = { x: number; y: number; intensity: number };

function hash(x: number, y: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Text-line pattern shared by pages and chunks: returns ink (1) or paper (0). */
function textLine(u: number, v: number, width: number, lineH: number, seed: number): number {
  const row = Math.floor(v / lineH);
  if ((v % lineH) / lineH > 0.5) return 0;
  if (row % 6 === 5) return 0; // paragraph break
  const length = row === 0 ? 0.55 : 0.45 + 0.55 * hash(row, seed);
  return u / width < length ? 1 : 0;
}

function pageIntensity(page: Page, x: number, y: number, cell: number): number | null {
  const cos = Math.cos(-page.rot);
  const sin = Math.sin(-page.rot);
  const dx = x - page.cx;
  const dy = y - page.cy;
  const u = dx * cos - dy * sin;
  const v = dx * sin + dy * cos;
  const hw = page.w / 2;
  const hh = page.h / 2;
  if (Math.abs(u) > hw || Math.abs(v) > hh) return null;

  const edge = Math.min(hw - Math.abs(u), hh - Math.abs(v));
  if (edge < cell * 0.95) return 0.6;

  const margin = cell * 2.2;
  const iu = u + hw - margin;
  const iv = v + hh - margin * 1.3;
  const innerW = page.w - margin * 2;
  const innerH = page.h - margin * 2.6;
  if (iu < 0 || iu > innerW || iv < 0 || iv > innerH) return 0.12;

  const ink = textLine(iu, iv, innerW, cell * 2.3, page.seed);
  const isTitle = Math.floor(iv / (cell * 2.3)) === 0;
  return ink ? (isTitle ? 1 : 0.95) : 0.12;
}

function chunkIntensity(chunk: Chunk, x: number, y: number, cell: number): number | null {
  const u = x - chunk.x;
  const v = y - chunk.y;
  if (u < 0 || v < 0 || u > chunk.w || v > chunk.h) return null;
  const edge = Math.min(u, v, chunk.w - u, chunk.h - v);
  if (edge < cell * 0.9) return 0.55 * chunk.alpha;
  return (textLine(u, v - cell, chunk.w, cell * 2.1, chunk.seed) ? 0.82 : 0.1) * chunk.alpha;
}

export function AsciiField({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let ink = readInk();
    const fontFamily =
      getComputedStyle(canvas).getPropertyValue("--font-jetbrains-mono").trim() || "monospace";

    let width = 0;
    let height = 0;
    let cellW = 9;
    let cellH = 10;
    let raf = 0;
    let last = 0;
    let visible = true;
    const start = performance.now();
    const pointer = { x: -9999, y: -9999 };

    // Per-frame draw lists, bucketed by alpha to limit fillStyle changes.
    const textX: number[][] = Array.from({ length: ALPHA_BUCKETS }, () => []);
    const textY: number[][] = Array.from({ length: ALPHA_BUCKETS }, () => []);
    const textC: string[][] = Array.from({ length: ALPHA_BUCKETS }, () => []);
    const discs: number[][] = Array.from({ length: ALPHA_BUCKETS }, () => []);

    function resize() {
      if (!canvas || !ctx) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cellW = width < 768 ? 7 : 9;
      cellH = cellW + 1;
      ctx.font = `500 ${cellH * 1.05}px ${fontFamily}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
    }

    function layout(t: number) {
      const narrow = width < 768;
      const pw = narrow ? Math.min(width * 0.34, 150) : Math.min(Math.max(width * 0.17, 150), 270);
      const ph = pw * 1.3;
      const ax = narrow ? width * 0.1 : width * 0.12;
      const ay = narrow ? height * 0.8 : height * 0.55;
      const bob = Math.sin(t * 0.6) * 4;
      const pages: Page[] = [
        { cx: ax - pw * 0.4, cy: ay - ph * 0.06 + bob * 0.4, w: pw, h: ph, rot: -0.34, seed: 11 },
        { cx: ax - pw * 0.06, cy: ay + bob * 0.7, w: pw, h: ph, rot: -0.15, seed: 23 },
        { cx: ax + pw * 0.3, cy: ay + ph * 0.05 + bob, w: pw, h: ph, rot: 0.05, seed: 37 },
      ];
      const sphere = narrow
        ? { x: width * 0.94, y: height * 0.8, r: Math.min(width * 0.36, 170) }
        : {
            x: width * 0.965,
            y: height * 0.55,
            r: Math.min(Math.max(height * 0.36, 140), 290),
          };
      const front = pages[pages.length - 1];
      const frontRight = front.cx + front.w / 2;
      const stream = {
        x0: narrow ? frontRight + width * 0.08 : width * 0.385,
        y0: narrow ? height * 0.78 : height * 0.64,
        cx: narrow ? width * 0.5 : width * 0.56,
        cy: narrow ? height * 0.98 : height * 0.92,
        x1: sphere.x - sphere.r * 0.92,
        y1: sphere.y + sphere.r * 0.2,
      };
      return { pages, sphere, front, frontRight, stream, pw };
    }

    function frame(now: number) {
      if (!ctx) return;
      const t = reduceMotion ? 6 : (now - start) / 1000;
      const { pages, sphere, front, frontRight, stream, pw } = layout(t);

      // Chunks leave the front page periodically and shrink toward the stream.
      const period = 1.5;
      const life = 3.6;
      const travel = 3.2;
      const chunks: Chunk[] = [];
      const dots: Dot[] = [];
      const newest = Math.floor(t / period);
      for (let i = newest; i > newest - Math.ceil((life + travel) / period) - 1; i -= 1) {
        const age = t - i * period;
        if (age < 0) continue;
        const startY = front.cy - front.h * 0.3 + hash(i, 7) * front.h * 0.55;
        if (age < life) {
          const q = age / life;
          const eased = q * q * (3 - 2 * q);
          const w = pw * (0.46 - 0.3 * q);
          const h = cellH * (5 - 2.4 * q);
          chunks.push({
            x: frontRight - w * 0.55 + eased * (stream.x0 - frontRight),
            y: startY + eased * (stream.y0 - startY) - h / 2,
            w,
            h,
            alpha: smoothstep(0, 0.12, q) * (1 - smoothstep(0.72, 1, q)),
            seed: i * 13,
          });
        } else if (age < life + travel) {
          // The chunk is now a single embedding point riding a bezier curve.
          const q = (age - life) / travel;
          const e = q * q * (3 - 2 * q);
          for (let k = 0; k < 3; k += 1) {
            const s = Math.max(0, e - k * 0.025);
            const a = 1 - s;
            const endY = stream.y1 + (hash(i, 3) - 0.5) * sphere.r * 0.5;
            dots.push({
              x: a * a * stream.x0 + 2 * a * s * stream.cx + s * s * stream.x1,
              y: a * a * stream.y0 + 2 * a * s * stream.cy + s * s * endY,
              intensity: (0.85 - k * 0.25) * smoothstep(0, 0.1, q) * (1 - smoothstep(0.9, 1, q)),
            });
          }
        }
      }

      // Embedding points orbiting the globe on a tilted ring.
      const orbit: Dot[] = [];
      const tilt = 0.42;
      for (let k = 0; k < 64; k += 1) {
        if (hash(k, 91) < 0.45) continue;
        const theta = (k / 64) * Math.PI * 2 + t * 0.18;
        const radius = sphere.r * (1.22 + hash(k, 5) * 0.25);
        const ox = Math.cos(theta) * radius;
        const oz = Math.sin(theta) * radius;
        const oy = -oz * Math.sin(tilt) + (hash(k, 17) - 0.5) * sphere.r * 0.12;
        const depth = oz * Math.cos(tilt);
        const px = sphere.x + ox;
        const py = sphere.y + oy;
        const insideDisc = (px - sphere.x) ** 2 + (py - sphere.y) ** 2 < sphere.r ** 2;
        if (depth < 0 && insideDisc) continue;
        orbit.push({ x: px, y: py, intensity: 0.45 + 0.4 * (depth > 0 ? 1 : 0.5) });
      }

      for (let b = 0; b < ALPHA_BUCKETS; b += 1) {
        textX[b].length = 0;
        textY[b].length = 0;
        textC[b].length = 0;
        discs[b].length = 0;
      }

      const pagesRight = frontRight + cellW;
      const pagesTop = Math.min(...pages.map((p) => p.cy - p.h * 0.75));
      const pagesBottom = Math.max(...pages.map((p) => p.cy + p.h * 0.75));
      const light = { x: -0.62, y: -0.48, z: 0.62 };
      const spin = t * 0.22;
      const shimmer = Math.floor(t * 0.9);

      const push = (x: number, y: number, intensity: number, gx: number, gy: number) => {
        let ox = 0;
        let oy = 0;
        let value = intensity;
        const dx = x - pointer.x;
        const dy = y - pointer.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < POINTER_RADIUS * POINTER_RADIUS) {
          const d = Math.sqrt(d2) || 1;
          const f = 1 - d / POINTER_RADIUS;
          ox = (dx / d) * f * 16;
          oy = (dy / d) * f * 16;
          value *= 1 - f * 0.45;
        }
        if (value < 0.06) return;
        const bucket = Math.min(ALPHA_BUCKETS - 1, Math.floor(value * ALPHA_BUCKETS));
        const px = x + ox;
        const py = y + oy;
        if (value > 0.86) {
          discs[bucket].push(px, py, cellW * (0.18 + 0.2 * ((value - 0.86) / 0.14)));
          return;
        }
        const set = value < 0.3 ? LIGHT : value < 0.55 ? MID : DENSE;
        const pick = Math.floor(hash(gx, gy) * 97 + shimmer * (hash(gy, gx) > 0.85 ? 1 : 0));
        textX[bucket].push(px);
        textY[bucket].push(py);
        textC[bucket].push(set[pick % set.length]);
      };

      const cols = Math.ceil(width / cellW);
      const rows = Math.ceil(height / cellH);
      for (let gy = 0; gy < rows; gy += 1) {
        const y = gy * cellH + cellH / 2;
        for (let gx = 0; gx < cols; gx += 1) {
          const x = gx * cellW + cellW / 2;
          let intensity = 0;

          // Pages (front-most wins).
          if (x < pagesRight && y > pagesTop && y < pagesBottom) {
            for (let p = pages.length - 1; p >= 0; p -= 1) {
              const value = pageIntensity(pages[p], x, y, cellW);
              if (value !== null) {
                intensity = value * (0.6 + 0.16 * p);
                break;
              }
            }
          }

          // Flying chunks.
          for (const chunk of chunks) {
            const value = chunkIntensity(chunk, x, y, cellW);
            if (value !== null && value > intensity) intensity = value;
          }

          // Globe: lambert shading with rotating meridians and parallels.
          const sx = (x - sphere.x) / sphere.r;
          const sy = (y - sphere.y) / sphere.r;
          const r2 = sx * sx + sy * sy;
          if (r2 < 1) {
            const sz = Math.sqrt(1 - r2);
            const lambert = Math.max(0, sx * light.x + sy * light.y + sz * light.z);
            const lon = Math.atan2(sx, sz) + spin;
            const lat = Math.asin(sy);
            const meridian = Math.abs(Math.sin(lon * 6)) < 0.13;
            const parallel = Math.abs(Math.sin(lat * 7)) < 0.11;
            const grid = meridian || parallel ? 0.22 : 0;
            const rim = smoothstep(0.86, 1, Math.sqrt(r2)) * 0.25;
            const value = 0.08 + 0.5 * lambert + grid * (0.35 + 0.65 * lambert) + rim;
            intensity = Math.max(intensity, Math.min(1, value));
          }

          if (intensity > 0) push(x, y, intensity, gx, gy);
        }
      }

      // Points are snapped to the grid so they read as part of the field.
      for (const dot of [...dots, ...orbit]) {
        const gx = Math.round((dot.x - cellW / 2) / cellW);
        const gy = Math.round((dot.y - cellH / 2) / cellH);
        push(gx * cellW + cellW / 2, gy * cellH + cellH / 2, Math.min(1, dot.intensity), gx, gy);
      }

      ctx.clearRect(0, 0, width, height);
      for (let b = 0; b < ALPHA_BUCKETS; b += 1) {
        const alpha = 0.16 + (b / (ALPHA_BUCKETS - 1)) * 0.48;
        ctx.fillStyle = `rgba(${ink}, ${alpha.toFixed(3)})`;
        const xs = textX[b];
        const ys = textY[b];
        const cs = textC[b];
        for (let i = 0; i < xs.length; i += 1) ctx.fillText(cs[i], xs[i], ys[i]);
        const d = discs[b];
        if (d.length) {
          ctx.beginPath();
          for (let i = 0; i < d.length; i += 3) {
            ctx.moveTo(d[i] + d[i + 2], d[i + 1]);
            ctx.arc(d[i], d[i + 1], d[i + 2], 0, Math.PI * 2);
          }
          ctx.fill();
        }
      }
    }

    function loop(now: number) {
      raf = requestAnimationFrame(loop);
      if (!visible || now - last < FRAME_MS) return;
      last = now;
      frame(now);
    }

    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = event.clientX - rect.left;
      pointer.y = event.clientY - rect.top;
      if (reduceMotion) frame(performance.now());
    };
    const onPointerLeave = () => {
      pointer.x = -9999;
      pointer.y = -9999;
      if (reduceMotion) frame(performance.now());
    };

    const resizeObserver = new ResizeObserver(() => {
      resize();
      frame(performance.now());
    });
    resizeObserver.observe(canvas);

    const themeObserver = new MutationObserver(() => {
      ink = readInk();
      frame(performance.now());
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    const visibilityObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    visibilityObserver.observe(canvas);

    resize();
    frame(performance.now());
    if (!reduceMotion) raf = requestAnimationFrame(loop);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onPointerLeave);

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      visibilityObserver.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      document.documentElement.removeEventListener("pointerleave", onPointerLeave);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className={className} />;
}
