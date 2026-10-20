/**
 * printers/klipper/camera.js — Klipper plugin, camera banner.
 *
 * Moonraker lists the cameras (`/server/webcams/list`, read by core.js); the
 * frames come from the camera streamer itself (crowsnest / ustreamer /
 * camera-streamer), usually behind nginx on port 80. An <img> needs no CORS:
 *   • MJPEG services → the multipart stream straight into <img src>;
 *   • anything else (WebRTC, HLS…) → the snapshot URL, refreshed every 2 s
 *     (beta: no WebRTC player yet).
 * Mirrors and rotation from the camera's Moonraker settings are applied.
 */
import { ctx } from '../context.js';
import { installCamImgRecovery } from '../cam-img-recovery.js';
import { klipperKey, klipperGetConn } from './core.js';

const SNAP_MS = 2000;
const _snapTimers = new Map();   // key → interval (snapshot mode only)
installCamImgRecovery("img.klipper-camera-img");

const imgsFor = key => document.querySelectorAll(`img[data-klipper-cam="${CSS.escape(key)}"]`);

// "mjpegstreamer-adaptive": Mainsail never opens its stream URL, it asks the snapshot URL again and
// again at the camera's target FPS. Same here, with a snapshot URL to ask: at most two pictures a
// second, whatever the target. Every other service keeps the way it was drawn.
const isAdaptive = cam => /adaptive/i.test(cam.service || "") && !!cam.snapshot;
const snapMsFor = cam => isAdaptive(cam) ? Math.min(SNAP_MS, Math.max(500, Math.round(1000 / (cam.fps || 10)))) : SNAP_MS;

function isMjpeg(cam) { return !isAdaptive(cam) && (/mjpeg|ustreamer/i.test(cam.service || "") || /action=stream/.test(cam.stream || "")); }

function ensureSnapTimer(key, url, ms) {
  if (_snapTimers.has(key)) return;
  _snapTimers.set(key, setInterval(() => {
    const imgs = imgsFor(key);
    if (!imgs.length) { clearInterval(_snapTimers.get(key)); _snapTimers.delete(key); return; }
    const u = `${url}${url.includes("?") ? "&" : "?"}_t=${Date.now()}`;
    imgs.forEach(img => { img.src = u; });
  }, ms));
}

export function klipperCamStopAll() {
  for (const t of _snapTimers.values()) clearInterval(t);
  _snapTimers.clear();
  // An MJPEG <img> keeps its connection until its src goes.
  document.querySelectorAll("img[data-klipper-cam]").forEach(img => img.removeAttribute("src"));
}

export function klipperHasCamera(p) {
  const conn = klipperGetConn(p);
  return !!(conn && conn.status === "connected" && (conn.camera?.stream || conn.camera?.snapshot));
}

function bannerHtml(p, withId) {
  if (!klipperHasCamera(p)) return "";
  const conn = klipperGetConn(p), cam = conn.camera, key = klipperKey(p);
  const stream = isMjpeg(cam) && cam.stream;
  const src = stream || cam.snapshot || cam.stream;
  if (!stream && cam.snapshot) queueMicrotask(() => ensureSnapTimer(key, cam.snapshot, snapMsFor(cam)));
  const tf = [cam.rotation ? `rotate(${cam.rotation}deg)` : "", cam.flipH ? "scaleX(-1)" : "", cam.flipV ? "scaleY(-1)" : ""].filter(Boolean).join(" ");
  return `
    <div${withId ? ` id="klipperCamHost"` : ""} class="pp-cam-full klipper-cam-host">
      <img class="klipper-camera-img" data-klipper-cam="${ctx.esc(key)}" src="${ctx.esc(src)}" data-cam-src="${ctx.esc(src)}"
           alt="${ctx.esc(ctx.t("ffgCameraAlt"))}"${tf ? ` style="transform:${tf}"` : ""}/>
    </div>`;
}

/** Side card banner. */
export const renderKlipperCamBanner = p => bannerHtml(p, true);
/** Camera wall / board banner (no fixed id — several can coexist). */
export const renderKlipperCamWallBanner = p => bannerHtml(p, false);
