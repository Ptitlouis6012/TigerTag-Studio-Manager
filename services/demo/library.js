/**
 * services/demo/library.js — the demo prints and their camera pictures
 * (docs/DEMO-MODE.md §3.2–3.3).
 *
 * A print is a folder of prints/: print.json + thumbnail.png + video.mp4. The
 * video is decoded once, on first use, into JPEG frames held in memory (the
 * bundled ffmpeg); a face asks frameFor(machine) for the picture to send now.
 *
 * Which frame (§3.3):
 *   printing      the loop plays            — videoMode "loop": by time;
 *                                             "progress": the frame matching the
 *                                             progress (a timelapse)
 *   paused        stays on the current frame, resumes from there
 *   heating, leveling, idle   empty.jpg if the print has one, else the first frame
 *   complete      finished.jpg if the print has one, else the last frame
 *   cancelled     frozen where it stopped
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PRINTS_DIR = path.join(__dirname, 'prints');
const FPS = 10;

function createLibrary({ ffmpegPath, log = () => {} } = {}) {
  const prints = [];
  try {
    for (const d of fs.readdirSync(PRINTS_DIR, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const dir = path.join(PRINTS_DIR, d.name);
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(dir, 'print.json'), 'utf8'));
        prints.push({ ...meta, id: d.name, dir });
      } catch (e) { log(`[demo] print ${d.name} skipped: ${e.message}`); }
    }
  } catch (e) { log(`[demo] no print library: ${e.message}`); }
  prints.sort((a, b) => a.id.localeCompare(b.id));

  const thumbs = new Map();
  const frames = new Map();      // print id → Promise<Buffer[]> (decode in flight or done)
  const decoded = new Map();     // print id → Buffer[] (done)

  function thumbnail(id) {
    if (!thumbs.has(id)) {
      const p = prints.find(x => x.id === id);
      try { thumbs.set(id, p ? fs.readFileSync(path.join(p.dir, 'thumbnail.png')) : null); } catch (_) { thumbs.set(id, null); }
    }
    return thumbs.get(id);
  }

  /** Decode video.mp4 into JPEG frames (once). Falls back to [] — the face then sends the thumbnail. */
  function decode(print) {
    if (frames.has(print.id)) return frames.get(print.id);
    // ffmpeg is another process: it cannot read inside app.asar. The prints are
    // unpacked beside it in a packaged app (package.json build.asarUnpack).
    const file = path.join(print.dir, 'video.mp4').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
    const job = new Promise(resolve => {
      if (!ffmpegPath || !fs.existsSync(file)) return resolve([]);
      const chunks = [];
      const ff = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', file,
        '-vf', `fps=${FPS}`, '-q:v', '5', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-'], { windowsHide: true });
      ff.stdout.on('data', c => chunks.push(c));
      ff.on('error', e => { log(`[demo] ffmpeg: ${e.message}`); resolve([]); });
      ff.on('close', () => resolve(splitJpegs(Buffer.concat(chunks))));
    });
    frames.set(print.id, job);
    job.then(f => { decoded.set(print.id, f); log(`[demo] ${print.id}: ${f.length} frames`); });
    return job;
  }

  /** prints/<id>/empty.jpg | finished.jpg, read once (null when absent). */
  const stills = new Map();
  function still(print, name) {
    const k = `${print.id}/${name}`;
    if (!stills.has(k)) { try { stills.set(k, fs.readFileSync(path.join(print.dir, `${name}.jpg`))); } catch (_) { stills.set(k, null); } }
    return stills.get(k);
  }

  /** Per-machine playhead, so a paused loop resumes where it stopped. */
  const heads = new WeakMap();

  /**
   * The picture for this machine right now: { data: Buffer, type } or null.
   * Synchronous: until a video is decoded the thumbnail stands in.
   */
  function frameFor(m) {
    const print = m.print || prints[m.nextIndex % prints.length];
    if (!print) return null;
    // A filmed loop ends mid-print: its own photos stand in for the empty plate
    // (idle, heating, leveling) and the finished object (complete), when given.
    const before = !m.print || m.phase === 'idle' || m.phase === 'heating' || m.phase === 'leveling';
    const photo = before ? still(print, 'empty') : m.phase === 'complete' ? still(print, 'finished') : null;
    if (photo) return { data: photo, type: 'image/jpeg' };
    const cached = decoded.get(print.id);
    if (!cached) decode(print);
    const f = cached || [];
    if (!f.length) {
      const t = thumbnail(print.id);
      return t ? { data: t, type: 'image/png' } : null;
    }
    const last = f.length - 1;
    let i;
    if (before) i = 0;
    else if (m.phase === 'complete') i = last;
    else if (print.videoMode === 'progress') i = Math.round(m.progress * last);
    else {
      let h = heads.get(m);
      if (!h || h.print !== print.id) { h = { print: print.id, pos: 0, at: Date.now() }; heads.set(m, h); }
      if (m.phase === 'printing') h.pos = (h.pos + (Date.now() - h.at) / 1000 * FPS) % f.length;
      h.at = Date.now();
      i = Math.floor(h.pos);
    }
    return { data: f[Math.max(0, Math.min(last, i))], type: 'image/jpeg' };
  }

  return {
    list: () => prints,
    get: id => prints.find(p => p.id === id || p.name === id) || null,
    thumbnail,
    frameFor,
    /** Decode every video ahead of time (called when the simulator starts). */
    warm: () => Promise.all(prints.map(decode)),
  };
}

/** Split an MJPEG byte stream (concatenated JPEGs) on their start markers. */
function splitJpegs(buf) {
  const out = [];
  let start = -1;
  for (let i = 0; i < buf.length - 2; i++) {
    if (buf[i] === 0xff && buf[i + 1] === 0xd8 && buf[i + 2] === 0xff) {
      if (start >= 0) out.push(buf.subarray(start, i));
      start = i;
    }
  }
  if (start >= 0) out.push(buf.subarray(start));
  return out;
}

module.exports = { createLibrary };
