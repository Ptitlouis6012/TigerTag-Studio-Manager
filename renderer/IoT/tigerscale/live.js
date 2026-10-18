/**
 * renderer/IoT/tigerscale/live.js — a TigerScale V3's screen, live, in Studio.
 *
 * Tiger-Scale-V3 docs/TELEMETRY.md § LAN live view: the scale publishes
 * `lan_live`, `lan_access_code` (case-sensitive, sent as stored) and `lan_url`
 * ("http://<ip>:81"). `GET {lan_url}/stream?c=CODE` is a chunked stream of
 * [u8 kind][payload] messages — 1 HELLO (u16 w, h, bandCols), 2 FRAME_BEGIN,
 * 5 BAND (u8 index, u16 len, rle565), 4 FRAME_END, 3 PING every 5 s. A new viewer
 * gets the whole screen first, then only the bands that changed; the canvas is
 * written once per FRAME_END, never half a frame. CORS is open, so the renderer
 * reads it directly. `POST {lan_url}/tap?c=&x=&y=` is a finger (480×320).
 *
 * The scale serves TWO viewers at most: the stream is aborted the moment the
 * view closes, never left open. A screen asleep is black: one tap in the middle
 * wakes it (swallowed, it opens nothing) before the stream starts.
 *
 * The modal is built here on the Tiger Touch live view's classes (tigertouch.css)
 * so the two devices' live views look the same.
 */

let _live = null;   // { mac, ctl, stop } while open

const LOCAL = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|\.local$/i;
function baseOf(s) {
  if (s?.lan_live !== true || typeof s.lan_url !== "string" || !s.lan_access_code) return null;
  try { const u = new URL(s.lan_url); return u.protocol === "http:" && LOCAL.test(u.hostname) ? u.origin : null; } catch { return null; }
}
export const scaleLiveAvailable = s => !!baseOf(s);

const R5 = new Uint8Array(32), G6 = new Uint8Array(64);
for (let i = 0; i < 32; i++) R5[i] = Math.round(i * 255 / 31);
for (let i = 0; i < 64; i++) G6[i] = Math.round(i * 255 / 63);

/** One band of rle565 → its 16 columns of the ImageData (columns run right to left). */
function decodeBand(img, idx, rle, BC, H) {
  const D = img.data, W = img.width;
  let p = 0, i = 0;
  const put = v => {
    const r = (i / H) | 0, y = i % H, x = idx * BC + (BC - 1 - r);
    i++;
    if (x >= W) return;
    const o = (y * W + x) * 4;
    D[o] = R5[(v >> 11) & 31]; D[o + 1] = G6[(v >> 5) & 63]; D[o + 2] = R5[v & 31]; D[o + 3] = 255;
  };
  while (p < rle.length) {
    const t = rle[p++];
    if (t < 0x80) { for (let k = 0; k <= t; k++, p += 2) put(rle[p] | (rle[p + 1] << 8)); }
    else {
      let n;
      if (t < 0xFF) n = t - 0x80 + 2; else { n = rle[p] | (rle[p + 1] << 8); p += 2; }
      const v = rle[p] | (rle[p + 1] << 8); p += 2;
      for (let k = 0; k < n; k++) put(v);
    }
  }
}

function ensureShell() {
  let el = document.getElementById("tigerscaleLiveOverlay");
  if (el) return el;
  document.body.insertAdjacentHTML("beforeend", `
    <div class="modal-overlay" id="tigerscaleLiveOverlay">
      <div class="modal-card ttc-shot-card tsc-live-card">
        <div class="modal-header">
          <span class="modal-title" id="tigerscaleLiveTitle">Tiger Scale</span>
          <button class="panel-close" id="tigerscaleLiveClose">✕</button>
        </div>
        <div class="ttc-shot-body" id="tigerscaleLiveBody"></div>
      </div>
    </div>`);
  el = document.getElementById("tigerscaleLiveOverlay");
  document.getElementById("tigerscaleLiveClose").addEventListener("click", closeScaleLive);
  el.addEventListener("click", e => { if (e.target === el) closeScaleLive(); });
  return el;
}

export function closeScaleLive() {
  if (_live) { _live.stop = true; _live.ctl?.abort(); }
  _live = null;
  document.getElementById("tigerscaleLiveOverlay")?.classList.remove("open");
}

/**
 * Open the live view of scale `s`. `getDoc(mac)` re-reads the live document
 * (the code can change on the scale), `onShot(s)` takes a screenshot.
 */
export function openScaleLive(s, { t, esc, getDoc, onShot }) {
  closeScaleLive();
  const overlay = ensureShell();
  document.getElementById("tigerscaleLiveTitle").textContent = s.display_name || "Tiger Scale";
  const body = document.getElementById("tigerscaleLiveBody");
  body.innerHTML = `<div class="ttc-shot-frame ttc-live-frame" style="aspect-ratio:480 / 320"><canvas width="480" height="320" hidden></canvas>
      <span class="ttc-spinner"></span><span class="ttc-live-msg" hidden></span></div>
    <div class="ttc-shot-actions"><span class="ttc-live-hint">${esc(t("scaleLiveHint"))}</span>
      <button type="button" class="ttc-btn" data-tsc-live-shot><span class="icon icon-camera icon-14"></span><span>${esc(t("tigertouchScreenshot"))}</span></button></div>`;
  const live = _live = { mac: s.mac, ctl: null, stop: false };
  body.querySelector("[data-tsc-live-shot]").addEventListener("click", () => { const d = getDoc(s.mac); if (d) onShot(d); });
  wireTap(body.querySelector(".ttc-live-frame"), live, getDoc);
  overlay.classList.add("open");
  loop(live, { t, getDoc, asleep: s.power_state === "screen_off" });
}

async function loop(live, { t, getDoc, asleep }) {
  const frame = document.querySelector("#tigerscaleLiveBody .ttc-live-frame");
  const canvas = frame.querySelector("canvas"), g = canvas.getContext("2d");
  const msg = frame.querySelector(".ttc-live-msg"), spin = frame.querySelector(".ttc-spinner");
  let img = g.createImageData(480, 320), misses = 0;
  const fail = key => { msg.textContent = t(key); msg.hidden = false; spin.hidden = true; frame.classList.add("is-stale"); };
  const nap = ms => new Promise(r => setTimeout(r, ms));

  while (!live.stop && _live === live) {
    const s = getDoc(live.mac), base = baseOf(s);
    if (!base) { fail("scaleLiveOff"); await nap(3000); continue; }
    const q = `c=${encodeURIComponent(s.lan_access_code)}`;
    if (asleep) {
      asleep = false;
      try { await fetch(`${base}/tap?${q}&x=240&y=160`, { method: "POST" }); } catch (_) {}
      await nap(1500);
    }
    live.ctl = new AbortController();
    try {
      const res = await fetch(`${base}/stream?${q}`, { cache: "no-store", signal: live.ctl.signal });
      if (res.status === 403) { fail("tigertouchShotErrCode"); await nap(30000); continue; }   // stale code: next heartbeat
      if (!res.ok) throw new Error(`http ${res.status}`);
      const rd = res.body.getReader();
      let buf = new Uint8Array(0), BC = 16, H = 320;
      for (;;) {
        const { done, value } = await rd.read();
        if (done) break;
        const nb = new Uint8Array(buf.length + value.length); nb.set(buf); nb.set(value, buf.length); buf = nb;
        for (;;) {
          if (!buf.length) break;
          const k = buf[0];
          if (k === 3) { buf = buf.subarray(1); continue; }
          if (k === 2) { buf = buf.subarray(1); continue; }
          if (k === 1) {
            if (buf.length < 7) break;
            const w = buf[1] | (buf[2] << 8); H = buf[3] | (buf[4] << 8); BC = buf[5] | (buf[6] << 8);
            if (w !== img.width || H !== img.height) { canvas.width = w; canvas.height = H; img = g.createImageData(w, H); frame.style.aspectRatio = `${w} / ${H}`; }
            buf = buf.subarray(7); continue;
          }
          if (k === 5) {
            if (buf.length < 4) break;
            const l = buf[2] | (buf[3] << 8);
            if (buf.length < 4 + l) break;
            decodeBand(img, buf[1], buf.subarray(4, 4 + l), BC, H); buf = buf.subarray(4 + l); continue;
          }
          if (k === 4) {
            buf = buf.subarray(1);
            g.putImageData(img, 0, 0);
            canvas.hidden = false; spin.hidden = true; msg.hidden = true; frame.classList.remove("is-stale"); misses = 0;
            continue;
          }
          throw new Error("out of step");
        }
      }
    } catch (e) {
      if (live.stop) break;
      console.warn("[tigerscale live]", e?.message || e);
    }
    if (live.stop) break;
    // The stream ended (the scale hung up, Wi-Fi blip): back off, then reconnect.
    misses++;
    if (misses > 1) fail("scaleLiveUnreachable");
    await nap(Math.min(15000, 500 * 2 ** Math.min(misses, 5)));
  }
}

/** A click on the picture is a tap on the scale, in its own 480×320 pixels. */
function wireTap(frame, live, getDoc) {
  frame.addEventListener("click", async e => {
    const c = frame.querySelector("canvas");
    const r = c.getBoundingClientRect();
    if (c.hidden || !r.width) return;
    const x = Math.round((e.clientX - r.left) * c.width / r.width), y = Math.round((e.clientY - r.top) * c.height / r.height);
    if (x < 0 || y < 0 || x >= c.width || y >= c.height) return;
    const s = getDoc(live.mac), base = baseOf(s);
    if (!base) return;
    frame.classList.add("is-touched");
    setTimeout(() => frame.classList.remove("is-touched"), 160);
    try { await fetch(`${base}/tap?c=${encodeURIComponent(s.lan_access_code)}&x=${x}&y=${y}`, { method: "POST" }); } catch (_) {}
  });
}
