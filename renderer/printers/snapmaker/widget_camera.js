/**
 * snapmaker/widget_camera.js — Snapmaker camera banner widget.
 *
 * Exports a single function used by the printer detail side-panel.
 * All Snapmaker camera logic lives here — inventory.js calls this and
 * never builds camera HTML inline.
 *
 * Two feeds, picked per firmware (`conn.camMode`, see index.js):
 *   • "webrtc" (Paxx extended firmware) — Crowsnest WebRTC player page (port 80,
 *     path /webcam/webrtc). The iframe handles the full WebRTC negotiation
 *     internally — no RTCPeerConnection in the renderer.
 *   • "still" (stock firmware) — there is no stream, but the printer's own
 *     service refreshes a 1080p JPEG (~1 fps) while it is woken up every few
 *     seconds. An <img> is fed frame by frame; see the still-feed loop below.
 */
import { ctx } from '../context.js';
import { snapGetConn, snapKey, snapWakeStockCamera } from './index.js';

const LOADING_OVERLAY = `
      <div class="pp-cam-loading-overlay">
        <span class="pp-cam-loading-dots">
          <span></span><span></span><span></span>
        </span>
      </div>`;

/**
 * Returns the full camera banner HTML for a Snapmaker printer,
 * or "" when the printer is offline / not yet connected / has no camera.
 *
 * @param  {object} p  — printer record from state.printers
 * @returns {string}   — HTML string (safe to assign to innerHTML)
 */
export function renderSnapCamBanner(p) {
  const key  = snapKey(p);
  const conn = snapGetConn(key);
  if (!conn || conn.status !== "connected" || !conn.ip) return "";
  if (conn.camMode === "none") return "";
  // Mode not known yet (the webcams query is in flight): hold the frame with
  // the loading dots rather than load a player that may not exist — the
  // answer triggers a re-render.
  if (!conn.camMode) return `<div class="pp-cam-full pp-cam-loading">${LOADING_OVERLAY}</div>`;
  if (conn.camMode === "still") {
    _stillEnsure(key);
    return `
    <div class="pp-cam-full pp-cam-loading">
      <img class="snap-camera-frame snap-camera-still" data-snap-cam="${ctx.esc(key)}" alt="" draggable="false">
      ${LOADING_OVERLAY}
    </div>`;
  }
  return `
    <div class="pp-cam-full pp-cam-loading">
      <iframe class="snap-camera-frame" src="${ctx.esc(`http://${conn.ip}/webcam/webrtc`)}"
              sandbox="allow-scripts allow-same-origin"
              loading="lazy" referrerpolicy="no-referrer"
              allow="autoplay"
              onload="var h=this.closest('.pp-cam-loading');if(h){h.classList.remove('pp-cam-loading');h.querySelector('.pp-cam-loading-overlay')?.remove();}"></iframe>
      ${LOADING_OVERLAY}
    </div>`;
}

/* ── Still feed (stock firmware) ─────────────────────────────────────────────
   One loop per printer, shared by every surface showing it (side panel, camera
   wall, printer card): each tick finds the <img data-snap-cam="key"> currently
   in the document and hands them the same frame.

   • Wake every WAKE_MS — the printer stops refreshing the JPEG once nobody asks.
   • A frame every FRAME_MS, fetched with no-store into a Blob URL: the image is
     swapped only once fully downloaded (no blank between frames), and the
     previous Blob URL is revoked, so an hour of watching does not pile up
     ~100 KB frames in the HTTP cache.
   • Nobody on screen for IDLE_STOP_MS → the loop stops, and so do the wake-ups:
     the camera goes back to idle on its own. Same grace idea as cam_manager.js,
     so a view switch does not restart the feed from nothing. */
const FRAME_MS     = 1000;
const WAKE_MS      = 10000;
const IDLE_STOP_MS = 12000;
const _stills = new Map();   // key → { timer, lastWake, idleSince, busy, blobUrl }

function _stillImgs(key) {
  return document.querySelectorAll(`img.snap-camera-still[data-snap-cam="${CSS.escape(key)}"]`);
}

function _stillEnsure(key) {
  if (_stills.has(key)) return;
  const s = { timer: null, lastWake: 0, idleSince: 0, busy: false, blobUrl: null };
  _stills.set(key, s);
  s.timer = setInterval(() => _stillTick(key, s), FRAME_MS);
  // First tick after the banner HTML has landed in the DOM.
  setTimeout(() => _stillTick(key, s), 0);
}

function _stillStop(key) {
  const s = _stills.get(key);
  if (!s) return;
  clearInterval(s.timer);
  if (s.blobUrl) URL.revokeObjectURL(s.blobUrl);
  _stills.delete(key);
}

async function _stillTick(key, s) {
  const conn = snapGetConn(key);
  if (!conn || conn.status !== "connected" || conn.camMode !== "still") { _stillStop(key); return; }
  const imgs = _stillImgs(key);
  const now = Date.now();
  if (!imgs.length) {
    if (!s.idleSince) s.idleSince = now;
    else if (now - s.idleSince > IDLE_STOP_MS) _stillStop(key);
    return;
  }
  s.idleSince = 0;
  if (now - s.lastWake >= WAKE_MS && snapWakeStockCamera(conn)) s.lastWake = now;
  if (s.busy) return;   // a slow frame is still downloading — skip, never queue
  s.busy = true;
  try {
    const res = await fetch(`http://${conn.ip}:7125/server/files/camera/monitor.jpg`, { cache: "no-store" });
    if (!res.ok) return;
    const url = URL.createObjectURL(await res.blob());
    if (!_stills.has(key)) { URL.revokeObjectURL(url); return; }   // stopped meanwhile
    const prev = s.blobUrl;
    s.blobUrl = url;
    _stillImgs(key).forEach(img => {
      img.src = url;
      const host = img.closest(".pp-cam-loading");
      if (host) { host.classList.remove("pp-cam-loading"); host.querySelector(".pp-cam-loading-overlay")?.remove(); }
    });
    // Revoke once the new frame is painted, not before (the old URL may still
    // be the one on screen for a few ms).
    if (prev) setTimeout(() => URL.revokeObjectURL(prev), 2000);
  } catch (_) {
    // Printer busy / network blip — the next tick simply tries again.
  } finally {
    s.busy = false;
  }
}
