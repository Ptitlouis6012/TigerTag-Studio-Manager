/**
 * printers/octoprint/camera.js — OctoPrint plugin, camera banner.
 *
 * OctoPrint's settings name the stream (`webcam.streamUrl`, MJPEG from
 * mjpg-streamer / camera-streamer on OctoPi) and a snapshot URL; core.js reads
 * them. An <img> needs no CORS:
 *   • an MJPEG stream → straight into <img src>;
 *   • otherwise the snapshot URL, refreshed every 2 s.
 * flipH / flipV / rotate90 from OctoPrint's settings are applied.
 */
import { ctx } from '../context.js';
import { installCamImgRecovery } from '../cam-img-recovery.js';
import { opKey, opGetConn } from './core.js';

const SNAP_MS = 2000;
const _snapTimers = new Map();   // key → interval (snapshot mode only)
installCamImgRecovery("img.octo-camera-img");

const imgsFor = key => document.querySelectorAll(`img[data-op-cam="${CSS.escape(key)}"]`);

function isMjpeg(cam) { return /action=stream|mjpe?g|\/stream/i.test(cam.stream || ""); }

function ensureSnapTimer(key, url) {
  if (_snapTimers.has(key)) return;
  _snapTimers.set(key, setInterval(() => {
    const imgs = imgsFor(key);
    if (!imgs.length) { clearInterval(_snapTimers.get(key)); _snapTimers.delete(key); return; }
    const u = `${url}${url.includes("?") ? "&" : "?"}_t=${Date.now()}`;
    imgs.forEach(img => { img.src = u; });
  }, SNAP_MS));
}

export function opCamStopAll() {
  for (const t of _snapTimers.values()) clearInterval(t);
  _snapTimers.clear();
  // An MJPEG <img> keeps its connection until its src goes.
  document.querySelectorAll("img[data-op-cam]").forEach(img => img.removeAttribute("src"));
}

export function opHasCamera(p) {
  const conn = opGetConn(p);
  return !!(conn && conn.status === "connected" && (conn.camera?.stream || conn.camera?.snapshot));
}

function bannerHtml(p, withId) {
  if (!opHasCamera(p)) return "";
  const conn = opGetConn(p), cam = conn.camera, key = opKey(p);
  const stream = isMjpeg(cam) && cam.stream;
  const src = stream || cam.snapshot || cam.stream;
  if (!stream && cam.snapshot) queueMicrotask(() => ensureSnapTimer(key, cam.snapshot));
  const tf = [cam.rotate90 ? "rotate(-90deg)" : "", cam.flipH ? "scaleX(-1)" : "", cam.flipV ? "scaleY(-1)" : ""].filter(Boolean).join(" ");
  return `
    <div${withId ? ` id="octoCamHost"` : ""} class="pp-cam-full octo-cam-host">
      <img class="octo-camera-img" data-op-cam="${ctx.esc(key)}" src="${ctx.esc(src)}" data-cam-src="${ctx.esc(src)}"
           alt="${ctx.esc(ctx.t("ffgCameraAlt"))}"${tf ? ` style="transform:${tf}"` : ""}/>
    </div>`;
}

/** Side card banner. */
export const renderOpCamBanner = p => bannerHtml(p, true);
/** Camera wall / board banner (no fixed id — several can coexist). */
export const renderOpCamWallBanner = p => bannerHtml(p, false);
