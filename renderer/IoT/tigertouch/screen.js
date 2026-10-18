/**
 * renderer/IoT/tigertouch/screen.js — talking to a Tiger Touch's screen on the LAN.
 *
 * Tiger-Touch docs/LAN-MODE.md: every request is `{lan_url}<path>?c=<code>&…`,
 * CORS is open (X- headers exposed), there is no web page.
 *
 *   GET  /screen.raw?fmt=rle565[&since=<ver>][&scale=2]  → the screen (≈30 KB) or,
 *        with `since`, only the rectangle that changed — X-Frame-Ver, X-Rect x,y,w,h
 *   GET  /screen.ver?wait=<ver>&ms=5000  → held until the screen changed and settled
 *   POST /api/tap?x=&y=&wait=1 · /api/swipe?x1=&y1=&x2=&y2=&ms=&wait=1 → 204 once
 *        the screen settled, with X-Frame-Ver
 *
 * Errors map to: "code" (403), "locked" (429), "busy" (503), "old" (404 on
 * screen.raw: a firmware from before rle565 — the caller falls back to the BMP
 * path in main.js), "unreachable" (network).
 *
 * The code is a secret: it only ever travels in these requests, never in a log.
 */

export const W = 800, H = 480;

const LOCAL = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|\.local$/i;

/** The screen's base URL from its document, or null if not usable. */
export function screenBase(s) {
  if (!s || s.lan_live !== true || typeof s.lan_url !== "string" || !s.lan_access_code) return null;
  try {
    const u = new URL(s.lan_url);
    return u.protocol === "http:" && LOCAL.test(u.hostname) ? u.origin : null;
  } catch { return null; }
}

export class ScreenError extends Error {
  constructor(kind) { super(kind); this.kind = kind; }
}

/** One request to the screen. Resolves with the Response, or throws a ScreenError. */
export async function screenFetch(s, path, params = {}, { method = "GET", signal, timeout = 10000 } = {}) {
  const base = screenBase(s);
  if (!base) throw new ScreenError("off");
  const q = new URLSearchParams({ c: String(s.lan_access_code), ...params });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  const stop = () => ctl.abort();
  signal?.addEventListener("abort", stop);
  try {
    const res = await fetch(`${base}${path}?${q}`, { method, cache: "no-store", signal: ctl.signal });
    if (res.status === 403) throw new ScreenError("code");
    if (res.status === 429) throw new ScreenError("locked");
    if (res.status === 503) throw new ScreenError("busy");
    if (res.status === 404 && path === "/screen.raw") throw new ScreenError("old");
    if (!res.ok && res.status !== 204) throw new ScreenError(`http ${res.status}`);
    return res;
  } catch (e) {
    if (e instanceof ScreenError) throw e;
    throw new ScreenError(signal?.aborted ? "aborted" : "unreachable");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
  }
}

const rect = h => {
  const [x, y, w, hh] = String(h || "0,0,0,0").split(",").map(n => Math.max(0, Number(n) || 0));
  return { x, y, w, h: hh };
};

/** GET /screen.raw — { ver, rect, bytes } (rect in 800×480 coordinates). */
export async function fetchRaw(s, { since, signal } = {}) {
  const res = await screenFetch(s, "/screen.raw", { fmt: "rle565", ...(since != null ? { since } : {}) }, { signal });
  return { ver: res.headers.get("X-Frame-Ver"), rect: rect(res.headers.get("X-Rect")), bytes: new Uint8Array(await res.arrayBuffer()) };
}

/** GET /screen.ver?wait — the next version once the screen changed (or the same one after `ms`). */
export async function waitChange(s, ver, { signal, ms = 5000 } = {}) {
  const res = await screenFetch(s, "/screen.ver", { wait: ver, ms }, { signal, timeout: ms + 4000 });
  return (await res.text()).trim();
}

/** A finger on the screen. Resolves with the version once the screen settled. */
export async function touch(s, t) {
  const n = (v, max) => String(Math.max(0, Math.min(max, Math.round(Number(v) || 0))));
  const res = t.x2 == null
    ? await screenFetch(s, "/api/tap", { x: n(t.x, W - 1), y: n(t.y, H - 1), wait: 1 }, { method: "POST" })
    : await screenFetch(s, "/api/swipe", {
        x1: n(t.x, W - 1), y1: n(t.y, H - 1), x2: n(t.x2, W - 1), y2: n(t.y2, H - 1),
        ms: String(Math.max(60, Math.min(2000, Math.round(t.ms || 200)))), wait: 1,
      }, { method: "POST" });
  return res.headers.get("X-Frame-Ver");
}

/**
 * rle565 → RGBA, into `img` (an 800×480 ImageData) at rect r, row-major.
 * Token t: ≤0x7F → t+1 literal pixels · 0x80-0xFE → one pixel ×(t-0x80+2) ·
 * 0xFF → u16 count, one pixel ×count. Pixels are RGB565, little-endian.
 */
export function decodeRle565(bytes, img, r) {
  const out = img.data, total = r.w * r.h;
  let i = 0, n = 0;
  const put = p => {
    const x = r.x + (n % r.w), y = r.y + ((n / r.w) | 0), o = (y * img.width + x) * 4;
    out[o]     = ((p >> 11) << 3) | (p >> 13);
    out[o + 1] = (((p >> 5) & 63) << 2) | ((p >> 9) & 3);
    out[o + 2] = ((p & 31) << 3) | ((p >> 2) & 7);
    out[o + 3] = 255;
    n++;
  };
  while (i < bytes.length && n < total) {
    const t = bytes[i++];
    if (t <= 0x7F) {
      for (let k = 0; k <= t && n < total; k++, i += 2) put(bytes[i] | (bytes[i + 1] << 8));
    } else {
      let count;
      if (t === 0xFF) { count = bytes[i] | (bytes[i + 1] << 8); i += 2; }
      else count = t - 0x80 + 2;
      const p = bytes[i] | (bytes[i + 1] << 8); i += 2;
      for (let k = 0; k < count && n < total; k++) put(p);
    }
  }
}

/** The whole screen as an 800×480 ImageData, with its version. */
export async function grabScreen(s, img = new ImageData(W, H)) {
  const f = await fetchRaw(s);
  decodeRle565(f.bytes, img, f.rect.w ? f.rect : { x: 0, y: 0, w: W, h: H });
  return { img, ver: f.ver };
}
