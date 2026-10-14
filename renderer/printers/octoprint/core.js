/**
 * printers/octoprint/core.js — OctoPrint plugin, connection core.
 *
 * A Marlin (or any serial-firmware) printer behind OctoPrint. Everything goes
 * through this plugin's main-process side (main.cjs):
 *
 *   once   GET /api/version          server version
 *          GET /api/printerprofiles  extruder count, heated bed / chamber
 *          GET /api/settings         webcam stream / snapshot URLs
 *   2 s    GET /api/connection       is the serial link up?
 *          GET /api/printer          temps + state flags (409 = printer not connected)
 *          GET /api/job              file, completion, times
 *   on a new file  GET /api/files/local/<path> → thumbnail (thumbnail plugins)
 *
 * OctoPrint core reports no fan speed, speed factor or position: the control
 * card shows the last value sent from here, never a guess.
 * Reference: ./PROTOCOL.md. Self-contained: imports host services only.
 */
import { ctx } from '../context.js';
import { ensurePrinterIdentity } from '../identity.js';

export const BRAND = "octoprint";
const POLL_MS = 2000;
const PING_EVERY_MS = 30_000;

const _conns = new Map();
const _pings = new Map();

export const opKey = p => `${p.brand}:${p.id}`;
export const opGetConn = p => _conns.get(typeof p === "string" ? p : opKey(p)) ?? null;

// ── Transport ───────────────────────────────────────────────────────────────
const bridge = () => (window.printerPlugin?.invoke ? window.printerPlugin : null);

export function hostOf(printer) {
  const raw = String(printer?.ip || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  return raw || null;
}

export async function opHttp(printer, method, path, extra = {}) {
  const b = bridge(), host = hostOf(printer);
  if (!b) return { ok: false, status: 0, error: "bridge unavailable (restart the app)" };
  if (!host) return { ok: false, status: 0, error: "no IP" };
  try {
    return await b.invoke(BRAND, "http", { host, method, path, apiKey: String(printer.apiKey || ""), ...extra });
  } catch (e) { return { ok: false, status: 0, error: e?.message || String(e) }; }
}

export async function opProbe(host, timeoutMs = 2500) {
  const b = bridge();
  if (!b || !host) return null;
  try { return await b.invoke(BRAND, "probe", host, timeoutMs); } catch (_) { return null; }
}

// ── Application Keys: get an API key without typing it (PROTOCOL.md §2) ─────
/** Ask OctoPrint for a key; the user clicks "Allow" in OctoPrint. → { ok, apiKey?, error? } */
export async function opRequestApiKey(host, { onPending, signal } = {}) {
  const b = bridge();
  if (!b) return { ok: false, error: "bridge" };
  const req = await b.invoke(BRAND, "http", { host, method: "POST", path: "/plugin/appkeys/request", body: { app: "Tiger Studio" } });
  const token = req?.json?.app_token;
  if (!token) return { ok: false, error: req?.error || "appkeys unavailable" };
  onPending?.();
  const until = Date.now() + 120_000;
  while (Date.now() < until && !signal?.aborted) {
    await new Promise(r => setTimeout(r, 1500));
    const r = await b.invoke(BRAND, "http", { host, path: `/plugin/appkeys/request/${token}` });
    if (r.status === 200 && r.json?.api_key) return { ok: true, apiKey: r.json.api_key };
    if (r.status === 404) return { ok: false, error: "denied" };
  }
  return { ok: false, error: signal?.aborted ? "aborted" : "timeout" };
}

// ── Online state ────────────────────────────────────────────────────────────
export function opIsOnline(printer) {
  if (printer?.brand !== BRAND) return null;
  const k = opKey(printer);
  if (ctx.isForcedOffline?.(k)) return false;
  const conn = _conns.get(k);
  if (conn) return conn.status === "connected";
  const ping = _pings.get(k);
  return ping ? ping.online : null;
}

export async function opPing(printer) {
  if (!printer || printer.brand !== BRAND) return;
  const host = hostOf(printer);
  if (!host) return;
  const k = opKey(printer), cached = _pings.get(k), now = Date.now();
  if (cached && now - cached.lastChecked < PING_EVERY_MS) return;
  _pings.set(k, { online: cached?.online ?? null, lastChecked: now });
  const r = await opProbe(host, 2500);
  _pings.set(k, { online: !!r?.octoprint, lastChecked: now });
  emit("online", k);
}
setInterval(() => {
  for (const p of ctx.getState?.()?.printers || []) if (p.brand === BRAND && p.ip) opPing(p);
}, PING_EVERY_MS);

const _listeners = new Set();
export function onOpChange(fn) { _listeners.add(fn); return () => _listeners.delete(fn); }
function emit(kind, key) { for (const fn of _listeners) { try { fn(kind, key); } catch (_) {} } }

// ── Lifecycle ───────────────────────────────────────────────────────────────
export function opConnect(printer) {
  const key = opKey(printer);
  const existing = _conns.get(key);
  if (existing?.intervalId && existing.host === hostOf(printer) && existing.apiKey === (printer.apiKey || "")) {
    existing.printer = printer;
    return;
  }
  if (existing) opDisconnect(key);
  const conn = {
    key, printer, host: hostOf(printer), apiKey: printer.apiKey || "",
    status: "connecting", lastError: null, retry: 0, retryTimer: null, intervalId: null,
    ready: false, profile: { extruders: 1, heatedBed: true, heatedChamber: false }, camera: null,
    thumbFor: null, log: [],
    sent: { fanPct: null, speedPct: 100 },   // what WE last set — OctoPrint cannot read it back
    data: {
      link: null, version: null, printState: null, stateText: null, progress: 0,
      printFilename: null, printDuration: 0, remaining: null, estimated: null, printPreviewUrl: null,
      temps: { tools: [], bed: null, bedTarget: null, chamber: null, chamberTarget: null },
    },
  };
  _conns.set(key, conn);
  pollOnce(conn);
  conn.intervalId = setInterval(() => pollOnce(conn), POLL_MS);
  emit("status", key);
}

export function opDisconnect(keyOrPrinter) {
  const key = typeof keyOrPrinter === "string" ? keyOrPrinter : opKey(keyOrPrinter);
  const conn = _conns.get(key);
  if (!conn) return;
  if (conn.intervalId) clearInterval(conn.intervalId);
  if (conn.retryTimer) clearTimeout(conn.retryTimer);
  _conns.delete(key);
  emit("status", key);
}
export function opDisconnectAll() { for (const k of [..._conns.keys()]) opDisconnect(k); }

function scheduleReconnect(conn) {
  if (conn.retryTimer || !_conns.has(conn.key)) return;
  if (conn.intervalId) { clearInterval(conn.intervalId); conn.intervalId = null; }
  conn.retry = Math.min(conn.retry + 1, 5);
  if (conn.retry >= 3) ctx.requestPrinterRefind?.(BRAND, conn.key);
  conn.retryTimer = setTimeout(() => {
    conn.retryTimer = null;
    if (!_conns.has(conn.key)) return;
    pollOnce(conn);
    if (!conn.intervalId && _conns.has(conn.key)) conn.intervalId = setInterval(() => pollOnce(conn), POLL_MS);
  }, Math.min(2000 * (1 << (conn.retry - 1)), 30000));
}

// ── Debug log ───────────────────────────────────────────────────────────────
function logPush(conn, dir, raw, summary) {
  const ts = new Date().toLocaleTimeString([], { hour12: false });
  conn.log.push({ dir, ts, summary, raw: typeof raw === "string" ? raw : JSON.stringify(raw) });
  if (conn.log.length > 100) conn.log.splice(0, conn.log.length - 100);
}
async function call(conn, method, path, extra) {
  logPush(conn, "→", { method, path, body: extra?.body }, `${method} ${path}`);
  const res = await opHttp(conn.printer, method, path, extra);
  const shown = extra?.binary ? { ...res, data: res.data ? `(${res.data.length} b64 chars)` : undefined } : res;
  logPush(conn, "←", shown, `${res.status || "—"} ${path.split("?")[0]}${res.error ? `  ${String(res.error).slice(0, 60)}` : ""}`);
  return res;
}

// ── Detection (once per connection) ─────────────────────────────────────────
async function detect(conn) {
  const [ver, prof, set] = await Promise.all([
    call(conn, "GET", "/api/version"),
    call(conn, "GET", "/api/printerprofiles"),
    call(conn, "GET", "/api/settings"),
  ]);
  if (!ver.ok) return ver;
  conn.data.version = ver.json?.server || null;
  const profiles = prof.json?.profiles || {};
  const cur = Object.values(profiles).find(x => x.current) || Object.values(profiles).find(x => x.default) || null;
  if (cur) conn.profile = {
    extruders: Math.max(1, Number(cur.extruder?.count) || 1),
    heatedBed: cur.heatedBed !== false, heatedChamber: !!cur.heatedChamber,
  };
  const w = set.json?.webcam || {};
  conn.camera = w.webcamEnabled === false || !(w.streamUrl || w.snapshotUrl) ? null : {
    stream: absUrl(conn, w.streamUrl), snapshot: absUrl(conn, w.snapshotUrl),
    flipH: !!w.flipH, flipV: !!w.flipV, rotate90: !!w.rotate90,
  };
  try { ensurePrinterIdentity(BRAND, conn.key, String(conn.host || "").replace(/:\d+$/, "")); } catch (_) {}
  conn.ready = true;
  return ver;
}

function absUrl(conn, u) {
  const s = String(u || "").trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  return `http://${conn.host}${s.startsWith("/") ? "" : "/"}${s}`;
}

// ── Poll ────────────────────────────────────────────────────────────────────
const _warned = new Set();
function warnOnce(conn, kind, msg) {
  const sig = `${conn.key}:${kind}`;
  if (_warned.has(sig)) return;
  _warned.add(sig);
  try { ctx.toast?.(msg, "error"); } catch (_) {}
}

async function pollOnce(conn) {
  if (!_conns.has(conn.key) || conn.polling) return;
  conn.polling = true;
  const prev = conn.status;
  try {
    if (!conn.ready) {
      const r = await detect(conn);
      if (!_conns.has(conn.key)) return;
      if (r.status === 401 || r.status === 403) return fail(conn, "error", "auth", prev, () => warnOnce(conn, "auth", ctx.t("octoErrAuth")));
      if (!r.ok) return fail(conn, "offline", r.error || `HTTP ${r.status}`, prev, () => scheduleReconnect(conn));
    }
    const [cx, pr, jb] = await Promise.all([
      call(conn, "GET", "/api/connection"),
      call(conn, "GET", "/api/printer"),
      call(conn, "GET", "/api/job"),
    ]);
    if (!_conns.has(conn.key)) return;
    if ([cx, pr, jb].some(r => r.status === 401 || r.status === 403)) return fail(conn, "error", "auth", prev, () => warnOnce(conn, "auth", ctx.t("octoErrAuth")));
    if (!cx.ok) return fail(conn, "offline", cx.error || `HTTP ${cx.status}`, prev, () => scheduleReconnect(conn));
    conn.retry = 0;
    conn.status = "connected";
    conn.lastError = null;
    merge(conn, cx.json, pr.status === 409 ? null : pr.json, jb.json);
    await refreshThumb(conn);
    emit(prev !== "connected" ? "status" : "data", conn.key);
  } finally {
    conn.polling = false;
  }
}

function fail(conn, status, why, prev, then) {
  conn.status = status;
  conn.lastError = why;
  then?.();
  emit(prev !== status ? "status" : "data", conn.key);
}

const num = v => (typeof v === "number" && isFinite(v) ? v : null);

function merge(conn, cx, pr, jb) {
  const d = conn.data;
  const link = String(cx?.current?.state || "");
  d.link = link;
  // The serial link is down (Closed / Offline / Error…): OctoPrint is up, the printer is not.
  d.linkUp = !!pr && !/^(closed|offline|error|detecting|connecting|opening)/i.test(link);
  const f = pr?.state?.flags || {};
  const pct = num(jb?.progress?.completion);
  const wasActive = d.printState === "printing" || d.printState === "paused";
  d.stateText = pr?.state?.text || link || null;
  d.printState = !d.linkUp ? "offline"
    : f.error ? "error"
    : f.cancelling ? "cancelled"
    : f.paused || f.pausing ? "paused"
    : f.printing ? "printing"
    : (pct != null && pct >= 99.9) || (wasActive && pct != null && pct >= 99) ? "complete"
    : "idle";
  d.progress = pct != null ? Math.max(0, Math.min(1, pct / 100)) : 0;
  if (d.printState === "complete") d.progress = 1;
  d.printFilename = jb?.job?.file?.path || jb?.job?.file?.name || null;
  d.printDuration = num(jb?.progress?.printTime) ?? 0;
  d.remaining = num(jb?.progress?.printTimeLeft);
  d.estimated = num(jb?.job?.estimatedPrintTime);
  const t = pr?.temperature || {};
  d.temps = {
    tools: Array.from({ length: conn.profile.extruders }, (_, i) => ({
      name: `tool${i}`, label: `T${i}`, cur: num(t[`tool${i}`]?.actual), tgt: num(t[`tool${i}`]?.target),
    })),
    bed: num(t.bed?.actual), bedTarget: num(t.bed?.target),
    chamber: num(t.chamber?.actual), chamberTarget: num(t.chamber?.target),
  };
}

async function refreshThumb(conn) {
  const d = conn.data, fn = d.printFilename;
  if (!fn) { d.printPreviewUrl = null; conn.thumbFor = null; return; }
  if (conn.thumbFor === fn) return;
  conn.thumbFor = fn;
  d.printPreviewUrl = null;
  const info = await call(conn, "GET", `/api/files/local/${fn.split("/").map(encodeURIComponent).join("/")}`);
  const rel = info.ok ? String(info.json?.thumbnail || "") : "";
  if (!rel) return;
  const img = await call(conn, "GET", `/${rel.replace(/^\/+/, "")}`, { binary: true });
  if (img.ok && img.data && conn.thumbFor === fn) d.printPreviewUrl = `data:${img.contentType || "image/png"};base64,${img.data}`;
}

/** Remaining seconds: OctoPrint's own estimate, else extrapolated from progress. */
export function opRemainingSec(d) {
  if (d.remaining != null && d.remaining >= 0) return Math.round(d.remaining);
  if (d.estimated > 0 && d.printDuration >= 0 && d.estimated > d.printDuration) return Math.round(d.estimated - d.printDuration);
  if (d.printDuration > 0 && d.progress > 0 && d.progress < 1) return Math.round(d.printDuration * (1 - d.progress) / d.progress);
  return null;
}

// ── Commands ────────────────────────────────────────────────────────────────
async function command(printer, path, body) {
  const conn = _conns.get(opKey(printer));
  if (!conn || conn.status !== "connected") return { ok: false, error: "not connected" };
  const res = await call(conn, "POST", path, { body });
  if (!res.ok) {
    const why = String(res.error || "").split("\n")[0];
    try { ctx.toast?.(why && !/^HTTP \d+$/.test(why) && why.length < 140 ? why : ctx.t("octoErrCommand"), "error"); } catch (_) {}
  }
  setTimeout(() => pollOnce(conn), 300);
  return { ok: !!res.ok, error: res.error };
}

/** action: "pause" | "resume" | "stop" */
export const opJobControl = (p, action) => action === "stop"
  ? command(p, "/api/job", { command: "cancel" })
  : command(p, "/api/job", { command: "pause", action: action === "resume" ? "resume" : "pause" });

export const opJog = (p, axis, dist) => {
  const a = String(axis).toLowerCase();
  if (!/^[xyz]$/.test(a) || !isFinite(dist)) return Promise.resolve({ ok: false });
  return command(p, "/api/printer/printhead", { command: "jog", [a]: Number(dist) });
};
/** axes: "XY" | "Z" | "X" | "Y" */
export const opHome = (p, axes) => command(p, "/api/printer/printhead", {
  command: "home", axes: [...String(axes).toLowerCase()].filter(c => "xyz".includes(c)),
});
export function opSetFan(p, pct) {
  const conn = _conns.get(opKey(p));
  const v = Math.round(Math.max(0, Math.min(100, Number(pct) || 0)) * 2.55);
  if (conn) conn.sent.fanPct = Math.round(v / 2.55);
  return command(p, "/api/printer/command", { commands: [v > 0 ? `M106 S${v}` : "M107"] });
}
export function opSetSpeed(p, pct) {
  const conn = _conns.get(opKey(p));
  const v = Math.round(Math.max(10, Math.min(300, Number(pct) || 100)));
  if (conn) conn.sent.speedPct = v;
  return command(p, "/api/printer/command", { commands: [`M220 S${v}`] });
}
/** Open the serial link to the printer (OctoPrint up, printer not connected). */
export const opConnectSerial = p => command(p, "/api/connection", { command: "connect" });
