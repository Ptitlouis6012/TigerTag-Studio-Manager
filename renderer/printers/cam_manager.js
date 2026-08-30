/**
 * printers/cam_manager.js — Generic MJPEG stream multiplexer.
 *
 * One HTTP connection per printer key, N consumer <img> elements.
 * A 2-second grace period on last-consumer-unregister avoids reconnections
 * when the user quickly switches views (sidecard open/close, tab change).
 *
 * Public API:
 *   camStart(key, url)         — start or verify running with same URL
 *   camStop(key)               — immediate stop (explicit disconnect)
 *   camStopAll()               — stop all streams (leave cam view / logout)
 *   camRestart(key, url)       — restart fetch, keep consumers (retry button)
 *   camSubscribe(key, imgEl)   — add consumer; shows latest frame immediately
 *   camUnsubscribe(key, imgEl) — remove consumer; starts grace timer if last
 */

/* How long a stream survives with nobody watching. Two seconds was shorter than
   a view change takes: the board handed the feed back, the stream died before
   the arriving view had finished rendering, and that view then rebuilt it from
   nothing — a fresh connection, then the wait for a first JPEG. Seconds of black
   on every switch, for a feed the app was holding a moment earlier.

   Twelve seconds outlives any switch, so the new view subscribes to a LIVE
   stream and is handed the last frame at once — the picture is simply there.
   The camera is still released when you actually stop looking, which is what a
   single-client printer needs; it is just no longer released between two views
   that both want it. */
const GRACE_MS = 12000;

// Per-key state: { key, abort, url, consumers: Set<img>, lastFrame, running, graceTimer }
const _streams = new Map();

// Broadcast frames to the detached cam window (same origin — BroadcastChannel
// works across BrowserWindow instances sharing the same localhost origin).
// The cam window subscribes via new BroadcastChannel('cam-frames').
const _bc = typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('cam-frames')
  : null;

// ── Public API ────────────────────────────────────────────────────────────────

export function camStart(key, url) {
  const s = _streams.get(key);
  if (s && s.running && s.url === url) {
    clearTimeout(s.graceTimer);
    s.graceTimer = null;
    return;
  }
  if (s) { clearTimeout(s.graceTimer); s.graceTimer = null; }
  /* CARRY THE CONSUMERS OVER. A restart used to hand the new stream an empty
     set, so everything registered BEFORE it was orphaned and never fed again —
     each surface registers once, when it opens, and never learns that the
     stream underneath was replaced. Whoever registered last got the picture and
     the others stayed black: a side panel opened while the feed was failing, a
     card already on screen when another view started it.

     Elements no longer in the document are dropped on the way. That prune is
     what lets a stream notice its last consumer has gone — the condition that
     arms its stop, and with it the release of a single-client camera. */
  const kept = s ? [...s.consumers].filter(el => el && el.isConnected) : [];
  /* HAND THE LAST PICTURE OVER TOO, and hand it over BEFORE the teardown. Stopping
     a stream blanks its consumers (`src` removed) and revokes the frame they are
     showing — right when a stream really ends, wrong when it is merely being
     replaced: the elements we just decided to keep were being emptied and their
     image revoked underneath them. That is the broken-image icon and the alt text
     appearing a second after a feed opened perfectly. Cleared from the old stream
     first, so the teardown finds nothing to blank and nothing to revoke; the new
     stream owns the frame and releases it when its own first frame lands. */
  const carried = s ? s.lastFrame : null;
  if (s) { s.consumers = new Set(); s.lastFrame = null; }
  _stopStream(s);
  const stream = { key, abort: new AbortController(), url, consumers: new Set(kept),
                   lastFrame: carried, running: true, graceTimer: null, retryTimer: null };
  _streams.set(key, stream);
  _pump(stream).catch(() => {});
}

export function camStop(key) {
  const s = _streams.get(key);
  if (!s) return;
  clearTimeout(s.graceTimer);
  _stopStream(s);
  _streams.delete(key);
}

export function camStopAll() {
  for (const s of _streams.values()) { clearTimeout(s.graceTimer); _stopStream(s); }
  _streams.clear();
}

export function camRestart(key, url) {
  const s = _streams.get(key);
  if (!s) { camStart(key, url); return; }
  clearTimeout(s.graceTimer);
  s.graceTimer = null;
  s.abort.abort();
  s.running = false;
  if (s.lastFrame) { URL.revokeObjectURL(s.lastFrame); s.lastFrame = null; }
  s.abort   = new AbortController();
  s.url     = url;
  s.running = true;
  _pump(s).catch(() => {});
}

export function camSubscribe(key, imgEl) {
  const s = _streams.get(key);
  if (!s) return;
  clearTimeout(s.graceTimer);
  s.graceTimer = null;
  s.consumers.add(imgEl);
  if (s.lastFrame) imgEl.src = s.lastFrame;
}

export function camUnsubscribe(key, imgEl) {
  const s = _streams.get(key);
  if (!s) return;
  s.consumers.delete(imgEl);
  try { imgEl.src = "about:blank"; imgEl.removeAttribute("src"); } catch {}
  if (s.consumers.size === 0 && !s.graceTimer) {
    s.graceTimer = setTimeout(() => camStop(key), GRACE_MS);
  }
}

// ── Internal ──────────────────────────────────────────────────────────────────

function _stopStream(s) {
  if (!s) return;
  s.running = false;
  clearTimeout(s.retryTimer); s.retryTimer = null;
  s.abort.abort();
  if (s.lastFrame) { URL.revokeObjectURL(s.lastFrame); s.lastFrame = null; }
  s.consumers.forEach(el => { try { el.src = "about:blank"; el.removeAttribute("src"); } catch {} });
}

async function _pump(stream) {
  try {
    const res = await fetch(stream.url, { signal: stream.abort.signal, cache: "no-store" });
    if (!res.ok || !res.body) { stream.running = false; return; }

    const ct   = res.headers.get("content-type") || "";
    const bm   = ct.match(/boundary=([^\s;,]+)/i);
    const rawB = bm ? bm[1].replace(/^-+/, "") : "boundary";
    const sep  = _enc("--" + rawB);

    const reader = res.body.getReader();
    let buf = new Uint8Array(0);

    while (stream.running) {
      const { done, value } = await reader.read();
      if (done) break;
      buf = _concat(buf, value);

      let consumed = 0;
      while (true) {
        const b1 = _indexOf(buf, sep, consumed);
        if (b1 === -1) break;
        const b2 = _indexOf(buf, sep, b1 + sep.length + 1);
        if (b2 === -1) break;
        const hdrEnd = _indexOf(buf, _enc("\r\n\r\n"), b1 + sep.length);
        if (hdrEnd !== -1 && hdrEnd < b2) {
          let bodyEnd = b2;
          if (bodyEnd >= 2 && buf[bodyEnd - 2] === 13 && buf[bodyEnd - 1] === 10) bodyEnd -= 2;
          const frame = buf.slice(hdrEnd + 4, bodyEnd);
          if (frame.length > 100) _pushFrame(stream, frame);
        }
        consumed = b2;
      }
      if (consumed > 0) buf = buf.slice(consumed);
      if (buf.length > 2_000_000) buf = new Uint8Array(0);
    }
  } catch (e) {
    if (e?.name !== "AbortError") console.warn("[cam-mgr]", e.message);
  } finally {
    stream.running = false;
    /* RETRY WHILE SOMEONE IS STILL WATCHING. A camera that accepts ONE client —
       FlashForge's does — refuses every attempt made in the gap between a view
       handing the stream back and the printer actually closing it. Switching
       from one view to another lands in that gap almost every time. Nothing
       retried, so the arriving view stayed black for good while the one that got
       there first kept the picture; and a stream is only ever re-asked for by a
       render, which the side panel does once and never again.

       Stops on its own: with no consumer still in the document, or once the
       stream has been replaced, it does not run. */
    const live = [...stream.consumers].filter(el => el && el.isConnected);
    if (live.length && _streams.get(stream.key) === stream && !stream.abort.signal.aborted) {
      clearTimeout(stream.retryTimer);
      stream.retryTimer = setTimeout(() => {
        if (_streams.get(stream.key) === stream) camStart(stream.key, stream.url);
      }, 2500);
    }
  }
}

function _pushFrame(stream, frame) {
  const blobUrl = URL.createObjectURL(new Blob([frame], { type: "image/jpeg" }));
  stream.consumers.forEach(el => { try { el.src = blobUrl; } catch {} });
  if (stream.lastFrame) URL.revokeObjectURL(stream.lastFrame);
  stream.lastFrame = blobUrl;
  // Forward to the detached cam window via BroadcastChannel (zero-copy transfer).
  if (_bc) {
    try {
      const copy = frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength);
      _bc.postMessage({ key: stream.key, frame: copy }, [copy]);
    } catch (_) {}
  }
}

const _te  = new TextEncoder();
const _enc = s => _te.encode(s);

function _concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a); out.set(b, a.length);
  return out;
}

function _indexOf(arr, pat, from = 0) {
  outer: for (let i = from; i <= arr.length - pat.length; i++) {
    for (let j = 0; j < pat.length; j++) { if (arr[i + j] !== pat[j]) continue outer; }
    return i;
  }
  return -1;
}
