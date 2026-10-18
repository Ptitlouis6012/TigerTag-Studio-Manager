#!/usr/bin/env node
/**
 * scripts/demo-render-prints.mjs — draws the placeholder prints of the demo
 * mode (docs/DEMO-MODE.md §3.2) until filmed loops replace them.
 *
 *   node scripts/demo-render-prints.mjs
 *
 * For each print below it writes services/demo/prints/<id>/:
 *   print.json     what the engine reads (name, durations, temperatures, slots)
 *   thumbnail.png  the object alone, transparent background (the job card)
 *   video.mp4      a timelapse of the object growing on the bed, 120 frames;
 *                  print.json says videoMode "progress" → the engine shows the
 *                  frame that matches the print's progress, not a time loop.
 *
 * No dependency: a tiny software renderer writes raw RGB(A) frames into the
 * bundled ffmpeg. Each object is a solid of revolution seen from the front —
 * a radius profile r(h) — shaded as a cylinder, with layer lines and colour
 * bands for multi-colour prints. Deterministic: same input, same files.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FFMPEG = createRequire(import.meta.url)("ffmpeg-static");
const OUT = path.join(ROOT, "services/demo/prints");

// h in 0..1 (bottom → top). r in 0..1 of the object's half-width. square: flat
// shading (a box seen face-on) instead of the cylinder's.
const PRINTS = [
  {
    id: "calibration-cube", name: "calibration_cube.gcode", durationReal: 25 * 60, layersTotal: 100,
    nozzleTemp: 215, bedTemp: 60, width: 0.36, height: 0.36, square: true,
    slots: [{ material: "PLA", color: "#E8452C" }],
    profile: () => 1,
  },
  {
    id: "spiral-vase", name: "spiral_vase.gcode", durationReal: 2 * 3600 + 10 * 60, layersTotal: 750,
    nozzleTemp: 240, bedTemp: 80, width: 0.42, height: 0.78,
    slots: [{ material: "PETG", color: "#16A39A" }],
    profile: h => 0.55 + 0.32 * Math.sin(h * Math.PI * 1.1 + 0.3) + 0.06 * Math.sin(h * Math.PI * 9),
  },
  {
    id: "rainbow-tower", name: "rainbow_tower.gcode", durationReal: 3 * 3600 + 40 * 60, layersTotal: 600,
    nozzleTemp: 220, bedTemp: 60, width: 0.34, height: 0.82,
    slots: [
      { material: "PLA", color: "#E53935" }, { material: "PLA", color: "#FDD835" },
      { material: "PLA", color: "#43A047" }, { material: "PLA", color: "#1E88E5" },
    ],
    profile: h => 1 - 0.55 * Math.floor(h * 4) / 4,
  },
  {
    id: "planter", name: "planter.gcode", durationReal: 1 * 3600 + 35 * 60, layersTotal: 380,
    nozzleTemp: 220, bedTemp: 65, width: 0.5, height: 0.5,
    slots: [{ material: "PLA", color: "#F2F0EA" }, { material: "PLA", color: "#2E7D32" }],
    bands: [0, 0.82],   // second colour from 82 % up: the rim
    profile: h => 0.72 + 0.28 * h,
  },
];

const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
const clamp = v => Math.max(0, Math.min(255, Math.round(v)));

/** Colour of the slot printing at height h (equal bands unless `bands` is given). */
function bandColor(pr, h) {
  const n = pr.slots.length;
  if (n === 1) return hex(pr.slots[0].color);
  const starts = pr.bands || pr.slots.map((_, i) => i / n);
  let i = 0;
  for (let k = 0; k < starts.length; k++) if (h >= starts[k]) i = k;
  return hex(pr.slots[i].color);
}

/**
 * Draw the object up to `upTo` (0..1 of its height) into an RGB(A) buffer.
 * Scene units: the bed spans the frame width; the object stands on it.
 */
function drawObject(buf, W, H, pr, upTo, { alpha = false, baseY, scale, cx }) {
  const ch = alpha ? 4 : 3;
  const objH = pr.height * scale, halfW = pr.width * scale / 2;
  const topPx = baseY - objH * upTo;
  for (let y = Math.max(0, Math.floor(topPx - halfW * 0.25)); y < Math.min(H, baseY); y++) {
    const h = (baseY - y) / objH;                    // 0..1 from the bed
    const inBody = h <= upTo;
    const rH = Math.max(0.02, pr.profile(Math.min(upTo, Math.max(0, h)))) * halfW;
    for (let x = Math.max(0, Math.floor(cx - halfW - 2)); x < Math.min(W, cx + halfW + 2); x++) {
      const dx = (x - cx) / rH;
      let rgb = null;
      if (inBody && Math.abs(dx) <= 1) {
        const base = bandColor(pr, h);
        const light = pr.square ? (dx < -0.1 ? 0.78 : 0.95) : 0.45 + 0.6 * Math.sqrt(1 - dx * dx) * (0.85 + 0.15 * -dx);
        const layer = 0.94 + 0.06 * Math.sin(h * pr.layersTotal * Math.PI);
        rgb = base.map(c => c * light * layer);
      } else {
        // The top face being printed: an ellipse at the current height, lighter.
        const rTop = Math.max(0.02, pr.profile(upTo)) * halfW, ey = (y - topPx) / (rTop * 0.22);
        const ex = (x - cx) / rTop;
        if (upTo > 0 && !pr.square && ex * ex + ey * ey <= 1) rgb = bandColor(pr, upTo).map(c => c * 1.08 + 12);
        if (upTo > 0 && pr.square && y >= topPx - rTop * 0.2 && y < topPx && Math.abs(ex) <= 1) rgb = bandColor(pr, upTo).map(c => c * 1.12 + 14);
      }
      if (!rgb) continue;
      const o = (y * W + x) * ch;
      buf[o] = clamp(rgb[0]); buf[o + 1] = clamp(rgb[1]); buf[o + 2] = clamp(rgb[2]);
      if (alpha) buf[o + 3] = 255;
    }
  }
  return topPx;
}

/** One camera frame: chamber, bed, the object so far, the hotend above it. */
function frame(pr, upTo, f) {
  const W = 640, H = 480, buf = Buffer.alloc(W * H * 3);
  const baseY = 380, scale = 420, cx = 320;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 3, v = y < baseY ? 22 + 18 * (y / baseY) + 6 * Math.sin(x / 90) : 0;
    let r = v, g = v + 2, b = v + 6;
    if (y >= baseY) {                                // textured PEI bed
      const d = (y - baseY) / (H - baseY);
      r = 58 - 20 * d + ((x * 7 + y * 13) % 5); g = 52 - 18 * d + ((x * 3 + y * 11) % 5); b = 40 - 14 * d;
    }
    buf[o] = clamp(r); buf[o + 1] = clamp(g); buf[o + 2] = clamp(b);
  }
  const topPx = drawObject(buf, W, H, pr, upTo, { baseY, scale, cx });
  if (upTo < 1) {                                     // hotend, sweeping across the part
    const sweep = pr.width * scale * 0.55, nx = Math.round(cx + Math.sin(f * 1.7) * sweep), ny = Math.round(topPx);
    const rect = (x0, y0, w, h, c) => {
      for (let y = Math.max(0, y0); y < Math.min(H, y0 + h); y++) for (let x = Math.max(0, x0); x < Math.min(W, x0 + w); x++) {
        const o = (y * W + x) * 3; buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2];
      }
    };
    rect(nx - 46, ny - 92, 92, 62, [70, 74, 82]);    // carriage
    rect(nx - 30, ny - 30, 60, 18, [190, 140, 60]);  // heater block
    for (let i = 0; i < 12; i++) rect(nx - 6 + i / 2, ny - 12 + i, 12 - i, 1, [205, 160, 70]);   // nozzle
  }
  return buf;
}

function ffmpeg(args, input) {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args], { input, maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(String(r.stderr));
}

for (const pr of PRINTS) {
  const dir = path.join(OUT, pr.id);
  fs.mkdirSync(dir, { recursive: true });
  const FRAMES = 120;
  const raw = Buffer.concat(Array.from({ length: FRAMES }, (_, i) => frame(pr, i / (FRAMES - 1), i)));
  ffmpeg(["-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "640x480", "-r", "10", "-i", "-",
          "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "28", "-movflags", "+faststart", path.join(dir, "video.mp4")], raw);
  // Thumbnail: the finished object alone, centred, transparent background.
  const T = 300, tb = Buffer.alloc(T * T * 4);
  drawObject(tb, T, T, pr, 1, { alpha: true, baseY: Math.round(T / 2 + pr.height * 260 / 2), scale: 260, cx: T / 2 });
  ffmpeg(["-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${T}x${T}`, "-i", "-", "-frames:v", "1", path.join(dir, "thumbnail.png")], tb);
  const { profile, bands, square, width, height, id, ...meta } = pr;
  // slotStarts: where each slot takes over, 0..1 of the height (the engine
  // switches the active slot there, like a colour change on a real printer).
  const slotStarts = bands || pr.slots.map((_, i) => +(i / pr.slots.length).toFixed(3));
  fs.writeFileSync(path.join(dir, "print.json"), JSON.stringify({ ...meta, slotStarts, videoMode: "progress" }, null, 2) + "\n");
  console.log(`${pr.id}: ${(fs.statSync(path.join(dir, "video.mp4")).size / 1024).toFixed(0)} kB video`);
}
