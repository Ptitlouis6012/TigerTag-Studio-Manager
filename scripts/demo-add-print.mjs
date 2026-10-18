#!/usr/bin/env node
/**
 * scripts/demo-add-print.mjs — put a FILMED print into the demo library
 * (docs/DEMO-MODE.md §3.2): services/demo/prints/<id>/.
 *
 *   npm run demo:add-print -- --video ~/Movies/benchy.mov --id benchy \
 *     --duration 1h25m --layers 240 --slots "PLA:#E8452C" \
 *     [--name benchy.gcode] [--start 12] [--length 60] [--nozzle 220] [--bed 60] \
 *     [--thumb plate_1.png] [--finished done.jpg] [--empty plate.jpg]
 *
 *   --video     the footage (any format ffmpeg reads)
 *   --start     where the loop starts in it, seconds (default 0)
 *   --length    loop length, seconds (default 60)
 *   --duration  how long the print claims to take on screen: 1h25m, 45m, 5400 (seconds)
 *   --layers    total layers shown on screen
 *   --slots     the filaments, in order: "PLA:#E8452C,PETG:#16A39A" (colour changes
 *               are spread evenly over the height)
 *   --thumb     the slicer thumbnail (PNG, best with a transparent background);
 *               without it, a frame near the end of the loop is used
 *   --finished  a photo of the finished object on the plate — shown when the print
 *               completes (a loop ends mid-print, its last frame is not the result)
 *   --empty     a photo of the empty plate — shown before the print starts
 *
 * Everything is re-encoded to what the simulator serves: 640×480 (letterboxed),
 * 10 fps, H.264 without sound; photos to 640×480 JPEG; the thumbnail to 300×300.
 * Uses the bundled ffmpeg. Overwrites the folder if it exists.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FFMPEG = createRequire(import.meta.url)('ffmpeg-static');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const die = msg => { console.error(`demo:add-print — ${msg}`); process.exit(1); };
const home = p => (p ? p.replace(/^~(?=\/)/, process.env.HOME || '~') : p);

const video = home(arg('video')), id = arg('id');
if (!video || !fs.existsSync(video)) die('--video <file> is required (and must exist)');
if (!id || !/^[a-z0-9][a-z0-9-]*$/.test(id)) die('--id <slug> is required: lowercase letters, digits, dashes');

function seconds(v) {
  if (!v) return null;
  if (/^\d+$/.test(v)) return Number(v);
  const h = Number(v.match(/(\d+)\s*h/i)?.[1] || 0), m = Number(v.match(/(\d+)\s*m/i)?.[1] || 0);
  return h || m ? h * 3600 + m * 60 : null;
}
const durationReal = seconds(arg('duration'));
if (!durationReal) die('--duration is required: 1h25m, 45m or seconds');
const layersTotal = Number(arg('layers'));
if (!(layersTotal > 0)) die('--layers <n> is required');
const slots = String(arg('slots', 'PLA:#E8452C')).split(',').map(s => {
  const [material, color] = s.split(':');
  if (!material || !/^#?[0-9a-f]{6}$/i.test(color || '')) die(`bad --slots entry "${s}" (want MATERIAL:#RRGGBB)`);
  return { material: material.trim(), color: `#${color.replace(/^#/, '').toUpperCase()}` };
});

const dir = path.join(ROOT, 'services/demo/prints', id);
fs.mkdirSync(dir, { recursive: true });
const ff = args => {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { maxBuffer: 1 << 26 });
  if (r.status !== 0) die(String(r.stderr || 'ffmpeg failed'));
};
const FIT = 'scale=640:480:force_original_aspect_ratio=decrease,pad=640:480:(ow-iw)/2:(oh-ih)/2:color=black';

const start = Number(arg('start', 0)), length = Number(arg('length', 60));
ff(['-ss', String(start), '-t', String(length), '-i', video, '-an', '-vf', `${FIT},fps=10`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '28', '-movflags', '+faststart', path.join(dir, 'video.mp4')]);

const thumb = home(arg('thumb'));
const THUMB = 'scale=300:300:force_original_aspect_ratio=decrease,pad=300:300:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba';
if (thumb) ff(['-i', thumb, '-frames:v', '1', '-vf', THUMB, path.join(dir, 'thumbnail.png')]);
else ff(['-sseof', '-1', '-i', path.join(dir, 'video.mp4'), '-frames:v', '1', '-vf', THUMB, path.join(dir, 'thumbnail.png')]);

for (const [opt, name] of [['finished', 'finished.jpg'], ['empty', 'empty.jpg']]) {
  const src = home(arg(opt));
  const out = path.join(dir, name);
  if (src) ff(['-i', src, '-frames:v', '1', '-vf', FIT, '-q:v', '4', out]);
  else fs.rmSync(out, { force: true });
}

const meta = {
  name: arg('name', `${id}.gcode`), durationReal, layersTotal,
  nozzleTemp: Number(arg('nozzle', 215)), bedTemp: Number(arg('bed', 60)),
  slots, slotStarts: slots.map((_, i) => +(i / slots.length).toFixed(3)), videoMode: 'loop',
};
fs.writeFileSync(path.join(dir, 'print.json'), JSON.stringify(meta, null, 2) + '\n');
const kb = f => (fs.existsSync(path.join(dir, f)) ? `${(fs.statSync(path.join(dir, f)).size / 1024).toFixed(0)} kB` : '—');
console.log(`services/demo/prints/${id}/  video ${kb('video.mp4')} · thumbnail ${kb('thumbnail.png')} · finished ${kb('finished.jpg')} · empty ${kb('empty.jpg')}`);
console.log('Restart Tiger Studio: the demo printers pick it up in their rotation.');
