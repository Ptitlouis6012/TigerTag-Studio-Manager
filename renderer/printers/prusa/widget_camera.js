/**
 * printers/prusa/widget_camera.js — Prusa camera banner.
 *
 * A Prusa camera lives in one of two places, and both are handled:
 *   • a Buddy3D camera (MK4/MK4S, Core One, XL, MINI) has its OWN address and
 *     streams RTSP (`rtsp://<camera-ip>/live`) once "RTSP stream on local
 *     network" is on in the Prusa app → printer.cameraIp, decoded by main's
 *     ffmpeg into JPEG frames (`prusa:cam-frame`);
 *   • a camera PrusaLink itself serves (USB/Pi camera on a Raspberry-Pi
 *     PrusaLink) → `/api/v1/cameras/snap`, polled every 2 s.
 *
 * ONE feed per printer, whatever number of surfaces show it (side card, board,
 * camera wall): every surface is an <img data-prusa-cam="<key>">, the feed
 * paints them all, and it stops by itself once none is left in the document.
 */
import { ctx } from '../context.js';
import { prusaKey, prusaGetConn, prusaCameraMode, prusaCameraSnap } from './index.js';

const SNAP_MS = 2000;
const SWEEP_MS = 4000;
const _feeds = new Map();   // key → { mode, printer, url, timer }

function imgsFor(key) {
  return document.querySelectorAll(`img[data-prusa-cam="${CSS.escape(key)}"]`);
}
function paint(key, url) {
  const f = _feeds.get(key);
  if (!f) return;
  const prev = f.url;
  f.url = url;
  imgsFor(key).forEach(img => {
    img.src = url;
    const host = img.closest(".pp-cam-loading");
    if (host) { host.classList.remove("pp-cam-loading"); host.querySelector(".pp-cam-loading-overlay")?.remove(); }
  });
  if (prev && prev.startsWith("blob:")) URL.revokeObjectURL(prev);
}

let _frameWired = false;
function wireFrames() {
  if (_frameWired || !window.prusa?.onCamFrame) return;
  _frameWired = true;
  window.prusa.onCamFrame((key, buf) => {
    if (!_feeds.has(key)) return;
    paint(key, URL.createObjectURL(new Blob([buf], { type: "image/jpeg" })));
  });
}

function startFeed(printer) {
  const key = prusaKey(printer);
  const mode = prusaCameraMode(printer);
  const cur = _feeds.get(key);
  if (cur && cur.mode === mode) { cur.printer = printer; return; }
  if (cur) stopFeed(key);
  if (!mode) return;
  const feed = { mode, printer, url: null, timer: null };
  _feeds.set(key, feed);
  if (mode === "rtsp") {
    wireFrames();
    window.prusa?.camStartRtsp?.(key, String(printer.cameraIp).trim());
  } else {
    const tick = async () => {
      if (!_feeds.has(key)) return;
      const url = await prusaCameraSnap(feed.printer);
      if (url && _feeds.get(key) === feed) paint(key, url);
    };
    tick();
    feed.timer = setInterval(tick, SNAP_MS);
  }
}

function stopFeed(key) {
  const f = _feeds.get(key);
  if (!f) return;
  if (f.timer) clearInterval(f.timer);
  if (f.mode === "rtsp") window.prusa?.camStopRtsp?.(key);
  if (f.url && f.url.startsWith("blob:")) URL.revokeObjectURL(f.url);
  _feeds.delete(key);
}

export function prusaCamStopAll() {
  for (const key of Array.from(_feeds.keys())) stopFeed(key);
}

// A surface that left the document no longer needs its feed.
setInterval(() => {
  for (const key of Array.from(_feeds.keys())) if (!imgsFor(key).length) stopFeed(key);
}, SWEEP_MS);

function bannerHtml(p, withId) {
  const conn = prusaGetConn(prusaKey(p));
  if (!conn || conn.status !== "connected" || !prusaCameraMode(p)) return "";
  const key = prusaKey(p);
  // Start after the markup is in the document, so the first frame finds it.
  queueMicrotask(() => startFeed(p));
  const known = _feeds.get(key)?.url;
  return `
    <div${withId ? ` id="prusaCamHost"` : ""} class="pp-cam-full prusa-cam-host${known ? "" : " pp-cam-loading"}">
      <img class="prusa-camera-img" data-prusa-cam="${ctx.esc(key)}"${known ? ` src="${ctx.esc(known)}"` : ""}
           alt="${ctx.esc(ctx.t("ffgCameraAlt"))}"/>
      ${known ? "" : `<div class="pp-cam-loading-overlay"><span class="pp-cam-loading-dots"><span></span><span></span><span></span></span></div>`}
    </div>`;
}

/** Side card banner. */
export function renderPrusaCamBanner(p) { return bannerHtml(p, true); }
/** Camera wall / board banner (no fixed id — several can coexist). */
export function renderPrusaCamWallBanner(p) { return bannerHtml(p, false); }
