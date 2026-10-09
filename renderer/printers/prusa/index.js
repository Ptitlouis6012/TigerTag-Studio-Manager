/**
 * printers/prusa/index.js — Prusa integration over PrusaLink (local HTTP).
 *
 * One driver for every Prusa that runs PrusaLink: MK4/MK4S, MK3.9, Core One,
 * XL and MINI/MINI+ on Buddy firmware, and MK3S+/MK2.5S through a Raspberry Pi.
 * With or without an MMU, with or without a camera.
 *
 *   GET /api/v1/status  every 2 s   → state, temps, progress, fans, job id
 *   GET /api/v1/job     on a new job, then every 10 s → file name, thumbnail,
 *                                                     G-code metadata
 *   GET /api/v1/info    once        → mmu, serial, name, nozzle, camera
 *   GET /api/version    once        → firmware / PrusaLink version
 *
 * Every request goes through main (`prusa:http`): PrusaLink sends no CORS
 * headers and wants HTTP Digest auth. Reference: ./PROTOCOL.md.
 * Self-registers into the brands registry at module evaluation time.
 */
import { ctx } from '../context.js';
import { registerBrand, brands } from '../registry.js';
import { meta, schema, helper } from './settings.js';
import {
  renderPrusaJobCard, renderPrusaTempCard, renderPrusaStatusCard, renderPrusaFilamentCard,
} from './cards.js';
import { schemaWidget } from '../modal-helpers.js';
import { ensurePrinterIdentity } from '../identity.js';

const $ = id => document.getElementById(id);
const POLL_MS = 2000;
const JOB_REFRESH_MS = 10000;
const MMU_SLOTS = 5;   // MMU3 / MMU2S: five bays

const _conns = new Map();   // `${brand}:${id}` → live connection (never persisted)
const _pings = new Map();   // key → { online, lastChecked }

export function prusaKey(p) { return `${p.brand}:${p.id}`; }
export function prusaGetConn(key) { return _conns.get(key) ?? null; }

function hostOf(printer) {
  const raw = String(printer?.ip || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  return raw || null;
}

/** One PrusaLink request through main. Never throws. */
export async function prusaHttp(printer, method, path, extra = {}) {
  const api = window.prusa;
  const host = hostOf(printer);
  if (!api?.http) return { ok: false, status: 0, error: "bridge unavailable (restart the app)" };
  if (!host) return { ok: false, status: 0, error: "no IP" };
  try {
    return await api.http({
      host, method, path,
      user: String(printer.username || "").trim() || "maker",
      password: String(printer.password || ""),
      apiKey: String(printer.apiKey || ""),
      ...extra,
    });
  } catch (e) {
    return { ok: false, status: 0, error: e?.message || String(e) };
  }
}

// ── Online state ─────────────────────────────────────────────────────────

export function prusaIsOnline(printer) {
  if (printer?.brand !== "prusa") return null;
  const k = prusaKey(printer);
  if (ctx.isForcedOffline?.(k)) return false;
  const conn = _conns.get(k);
  if (conn) return conn.status === "connected";
  const ping = _pings.get(k);
  return ping ? ping.online : null;
}

/** Reachability only (no credentials): does PrusaLink answer on that address? */
export async function prusaPingPrinter(printer) {
  if (!printer || printer.brand !== "prusa") return;
  const host = hostOf(printer);
  if (!host || !window.prusa?.probe) return;
  const k = prusaKey(printer);
  const cached = _pings.get(k);
  const now = Date.now();
  if (cached && now - cached.lastChecked < 30_000) return;
  _pings.set(k, { online: cached?.online ?? null, lastChecked: now });
  let online = false;
  try { online = !!(await window.prusa.probe(host, 2500))?.prusa; } catch (_) { online = false; }
  _pings.set(k, { online, lastChecked: now });
  refreshOnlineUI(k);
}

export function prusaPingAllPrinters() {
  for (const p of ctx.getState().printers || []) if (p.brand === "prusa" && p.ip) prusaPingPrinter(p);
}
setInterval(prusaPingAllPrinters, 30_000);

function refreshOnlineUI(key) {
  document.querySelectorAll(`[data-printer-key="${key}"] .printer-online`).forEach(el => {
    const p = (ctx.getState().printers || []).find(x => prusaKey(x) === key);
    el.outerHTML = renderPrusaOnlineBadge(p, "card");
  });
  const active = ctx.getActivePrinter();
  if (active && prusaKey(active) === key) {
    const host = $("ppOnlineRow");
    if (host) host.outerHTML = renderPrusaOnlineBadge(active, "side");
  }
}

export function renderPrusaOnlineBadge(printer, where) {
  if (!printer || printer.brand !== "prusa") return "";
  const online = prusaIsOnline(printer);
  const cls = online === true ? "is-online" : (online === false ? "is-offline" : "is-checking");
  const lbl = online === true ? ctx.t("snapStatusOnline") : online === false ? ctx.t("snapStatusOffline") : ctx.t("snapStatusConnecting");
  const id = where === "side" ? ` id="ppOnlineRow"` : "";
  return `<span class="printer-online printer-online--${ctx.esc(where)} ${cls}"${id}>
            <span class="printer-online-dot"></span>
            <span class="printer-online-lbl">${ctx.esc(lbl)}</span>
          </span>`;
}

// ── Connection lifecycle ─────────────────────────────────────────────────

export function prusaConnect(printer) {
  const key = prusaKey(printer);
  const existing = _conns.get(key);
  if (existing && existing.intervalId && existing.ip === printer.ip) {
    existing.printer = printer;
    return;
  }
  if (existing) prusaDisconnect(key);
  const conn = {
    key, ip: printer.ip, printer,
    status: "connecting",          // connecting | connected | offline | error
    lastError: null, retry: 0, retryTimer: null, intervalId: null,
    jobFetchedAt: 0, jobIdSeen: null, infoLoaded: false, thumbRef: null,
    data: {
      temps: {}, fans: {}, speed: null, flow: null,
      printState: null, progress: 0, printEstimated: null, printDuration: 0,
      printFilename: null, printPreviewUrl: null, jobId: null, jobMeta: null,
      filaments: [], info: null, version: null, statusMessage: null,
    },
    log: [],
  };
  _conns.set(key, conn);
  pollOnce(conn);
  conn.intervalId = setInterval(() => pollOnce(conn), POLL_MS);
  notifyChange(conn, true);
}

export function prusaDisconnect(key) {
  const conn = _conns.get(key);
  if (!conn) return;
  if (conn.intervalId) clearInterval(conn.intervalId);
  if (conn.retryTimer) clearTimeout(conn.retryTimer);
  _conns.delete(key);
}

function scheduleReconnect(conn) {
  if (conn.retryTimer || !_conns.has(conn.key)) return;
  if (conn.intervalId) { clearInterval(conn.intervalId); conn.intervalId = null; }
  conn.retry = Math.min(conn.retry + 1, 5);
  if (conn.retry >= 3) ctx.requestPrinterRefind?.("prusa", conn.key);
  const delay = Math.min(2000 * (1 << (conn.retry - 1)), 30000);
  conn.retryTimer = setTimeout(() => {
    conn.retryTimer = null;
    if (!_conns.has(conn.key)) return;
    pollOnce(conn);
    if (!conn.intervalId && _conns.has(conn.key)) conn.intervalId = setInterval(() => pollOnce(conn), POLL_MS);
  }, delay);
}

// ── Debug request log (debug mode only shows it) ─────────────────────────
const LOG_MAX = 100;
function logPush(conn, dir, raw, summary) {
  if (!conn || conn.logPaused) return;
  const ts = new Date().toLocaleTimeString([], { hour12: false });
  conn.log.push({ dir, ts, summary: summary || "", raw: typeof raw === "string" ? raw : JSON.stringify(raw) });
  if (conn.log.length > LOG_MAX) conn.log.splice(0, conn.log.length - LOG_MAX);
}

async function call(conn, method, path, extra) {
  logPush(conn, "→", { method, path }, `${method} ${path}`);
  const res = await prusaHttp(conn.printer, method, path, extra);
  logPush(conn, "←", extra?.binary ? { ...res, data: res.data ? `(${res.data.length} b64 chars)` : undefined } : res,
    `${res.status || "—"} ${path}${res.error ? `  ${String(res.error).slice(0, 60)}` : ""}`);
  return res;
}

// ── Poll ─────────────────────────────────────────────────────────────────

const _warned = new Set();
function warnOnce(conn, kind, msg) {
  const sig = `${conn.key}:${kind}`;
  if (_warned.has(sig)) return;
  _warned.add(sig);
  try { ctx.toast(msg, "error"); } catch (_) {}
}
function clearWarnings(key) { for (const s of Array.from(_warned)) if (s.startsWith(key + ":")) _warned.delete(s); }

async function pollOnce(conn) {
  if (!_conns.has(conn.key)) return;
  if (conn.polling) return;           // a slow printer never stacks requests
  conn.polling = true;
  try {
    const res = await call(conn, "GET", "/api/v1/status");
    if (!_conns.has(conn.key)) return;
    const prev = conn.status;
    if (res.status === 401 || res.status === 403) {
      conn.status = "error";
      conn.lastError = "auth";
      warnOnce(conn, "auth", ctx.t("prusaErrAuth"));
      notifyChange(conn, prev !== "error");
      return;
    }
    if (!res.ok || !res.json) {
      // An old PrusaLink without the v1 API answers 404 — say so instead of
      // retrying forever.
      if (res.status === 404) {
        conn.status = "error";
        conn.lastError = "api";
        warnOnce(conn, "api", ctx.t("prusaErrOldApi"));
        notifyChange(conn, prev !== "error");
        return;
      }
      conn.status = "offline";
      conn.lastError = res.error || `HTTP ${res.status}`;
      notifyChange(conn, prev !== "offline");
      scheduleReconnect(conn);
      return;
    }
    conn.retry = 0;
    if (prev !== "connected") {
      clearWarnings(conn.key);
      ensurePrinterIdentity("prusa", conn.key, conn.ip);   // ARP MAC, for a re-find after an IP change
    }
    conn.status = "connected";
    conn.lastError = null;
    mergeStatus(conn, res.json);
    if (!conn.infoLoaded) await loadInfo(conn);
    const jid = conn.data.jobId;
    const jobDue = jid != null && (jid !== conn.jobIdSeen || Date.now() - conn.jobFetchedAt > JOB_REFRESH_MS);
    if (jobDue) await loadJob(conn);
    if (jid == null && conn.jobIdSeen != null && !["complete", "cancelled", "error"].includes(conn.data.printState)) {
      // Back to idle: the finished job's file/thumbnail no longer apply.
      conn.jobIdSeen = null;
      conn.data.printFilename = null;
      conn.data.printPreviewUrl = null;
      conn.data.jobMeta = null;
      conn.thumbRef = null;
    }
    buildSlots(conn);
    notifyChange(conn, prev !== "connected");
  } finally {
    conn.polling = false;
  }
}

const STATE_MAP = {
  PRINTING: "printing", PAUSED: "paused", FINISHED: "complete", STOPPED: "cancelled",
  ERROR: "error", ATTENTION: "attention", BUSY: "busy", IDLE: "idle", READY: "ready",
};

function num(v) { return typeof v === "number" && isFinite(v) ? v : null; }

function mergeStatus(conn, s) {
  const d = conn.data;
  const pr = s.printer || {};
  d.printState = STATE_MAP[String(pr.state || "").toUpperCase()] || String(pr.state || "").toLowerCase() || "idle";
  d.temps = {
    nozzle: num(pr.temp_nozzle), nozzleTarget: num(pr.target_nozzle),
    bed: num(pr.temp_bed), bedTarget: num(pr.target_bed),
    // Core One / XL firmwares add the chamber; read it when present.
    chamber: num(pr.temp_chamber), chamberTarget: num(pr.target_chamber),
  };
  d.fans = { print: num(pr.fan_print), hotend: num(pr.fan_hotend) };
  d.speed = num(pr.speed);
  d.flow = num(pr.flow);
  d.statusMessage = pr.status_printer && pr.status_printer.ok === false ? (pr.status_printer.message || null) : null;
  const job = s.job || null;
  d.jobId = job && job.id != null ? job.id : null;
  if (job) {
    d.progress = Math.max(0, Math.min(1, (num(job.progress) ?? 0) / 100));
    d.printEstimated = num(job.time_remaining);
    d.printDuration = num(job.time_printing) ?? 0;
  } else if (!["complete", "cancelled", "error"].includes(d.printState)) {
    d.progress = 0; d.printEstimated = null; d.printDuration = 0;
  }
  d.hasCamera = !!(s.camera && s.camera.id) || !!d.info?.active_camera;
}

async function loadInfo(conn) {
  const [info, ver] = await Promise.all([call(conn, "GET", "/api/v1/info"), call(conn, "GET", "/api/version")]);
  if (info.ok && info.json) conn.data.info = info.json;
  if (ver.ok && ver.json) conn.data.version = ver.json;
  conn.infoLoaded = true;
  // Remember the printer's stable identity so a new DHCP address can be
  // re-found later (printers/refind.js matches on it).
  const sn = conn.data.info?.serial;
  if (sn && conn.printer && conn.printer.serialNumber !== sn) {
    ctx.savePrinterField?.("prusa", conn.printer.id, "serialNumber", sn);
  }
}

async function loadJob(conn) {
  const res = await call(conn, "GET", "/api/v1/job");
  conn.jobFetchedAt = Date.now();
  if (!res.ok || !res.json) return;
  const j = res.json;
  conn.jobIdSeen = j.id ?? conn.data.jobId;
  const f = j.file || {};
  conn.data.printFilename = f.display_name || f.name || null;
  conn.data.jobMeta = f.meta || null;
  const ref = f.refs?.thumbnail || f.refs?.icon || null;
  if (ref && ref !== conn.thumbRef) {
    const img = await call(conn, "GET", ref, { binary: true });
    if (img.ok && img.data) {
      conn.thumbRef = ref;
      conn.data.printPreviewUrl = `data:${img.contentType || "image/png"};base64,${img.data}`;
    }
  }
}

// ── Slots (MMU bays, XL tools, or the single nozzle) ─────────────────────
// PrusaLink never says what is loaded. The running job's G-code metadata says
// what it EXPECTS per tool (`filament_type`, `extruder_colour`, `filament_colour`
// as ;-separated lists), which is the best truth on offer while printing.
function metaList(meta, ...keys) {
  for (const k of keys) {
    const v = meta?.[k];
    if (Array.isArray(v)) return v.map(String);
    if (typeof v === "string" && v.trim()) return v.split(";").map(s => s.trim());
  }
  return [];
}
function hexOrNull(s) {
  const v = String(s || "").trim().replace(/^#/, "");
  return /^[0-9a-f]{6}$/i.test(v) ? `#${v.toUpperCase()}` : null;
}
function toolCount(conn) {
  const model = ctx.findPrinterModel?.("prusa", conn.printer?.printerModelId);
  return Math.max(1, Number(model?.tools) || 1);
}
function buildSlots(conn) {
  const d = conn.data;
  const mmu = !!d.info?.mmu;
  const tools = toolCount(conn);
  const n = mmu ? MMU_SLOTS : tools;
  const kind = mmu ? "mmu" : tools > 1 ? "tool" : "ext";
  const types = metaList(d.jobMeta, "filament_type", "filament_type[]");
  const colors = metaList(d.jobMeta, "extruder_colour", "filament_colour");
  const printing = ["printing", "paused", "attention"].includes(d.printState);
  d.filaments = Array.from({ length: n }, (_, i) => ({
    slotId: i + 1,
    slotKind: kind,
    label: kind === "mmu" ? `${i + 1}` : kind === "tool" ? `T${i + 1}` : "E1",
    type: printing || d.printState === "complete" ? (types[i] || (n === 1 ? types[0] : null) || null) : null,
    color: printing || d.printState === "complete" ? hexOrNull(colors[i]) : null,
    isActive: false,
  }));
}

export function prusaGetSlots(printer) {
  const conn = _conns.get(prusaKey(printer));
  if (!conn || conn.status !== "connected") return [];
  return conn.data.filaments.map((f, i) => ({
    key: `s${f.slotId}`, label: f.label, color: f.color, material: f.type, vendor: null,
    empty: !f.color && !f.type, loaded: !!(f.color || f.type), index: i,
  }));
}

export function prusaGetUnits(printer) {
  const slots = prusaGetSlots(printer);
  if (!slots.length) return [];
  const conn = _conns.get(prusaKey(printer));
  const kind = conn?.data?.filaments?.[0]?.slotKind;
  if (kind === "mmu") {
    return [{ kind: "holder", index: 0, label: "MMU", hwId: null, rows: 1, cols: slots.length,
      slots: slots.map((s, i) => ({ ...s, index: i, hw: { slot: i + 1 } })) }];
  }
  if (kind === "tool") {
    return [{ kind: "holder", index: 0, label: "", hwId: null, rows: 1, cols: slots.length,
      slots: slots.map((s, i) => ({ ...s, index: i, hw: { tool: i + 1 } })) }];
  }
  return [{ kind: "ext", index: 0, label: "", hwId: null, rows: 1, cols: 1,
    slots: slots.map((s, i) => ({ ...s, index: i, hw: { external: true } })) }];
}

export function prusaGetTempHtml(printer) {
  const conn = _conns.get(prusaKey(printer));
  return conn && conn.status === "connected" ? renderPrusaTempCard(conn) : "";
}

// ── Job control ──────────────────────────────────────────────────────────

/** action: "pause" | "resume" | "stop". Returns { ok, error? }. */
export async function prusaJobControl(printer, action) {
  const conn = _conns.get(prusaKey(printer));
  const id = conn?.data?.jobId;
  if (id == null) return { ok: false, error: "no job" };
  const res = action === "stop"
    ? await call(conn, "DELETE", `/api/v1/job/${id}`)
    : await call(conn, "PUT", `/api/v1/job/${id}/${action === "resume" ? "resume" : "pause"}`);
  if (!res.ok) {
    try { ctx.toast(ctx.t("prusaErrCommand"), "error"); } catch (_) {}
  }
  if (conn) setTimeout(() => pollOnce(conn), 400);
  return { ok: !!res.ok, error: res.error };
}

/** Wire the job buttons of a freshly rendered live block (hold-to-confirm). */
export function prusaWireLive(root, printer) {
  if (!root || !printer) return;
  root.querySelectorAll("[data-prusa-job]").forEach(btn => {
    if (btn.dataset.wired) return;
    btn.dataset.wired = "1";
    const action = btn.dataset.prusaJob;
    ctx.setupHoldToConfirm(btn, action === "stop" ? 1500 : 1200, () => prusaJobControl(printer, action));
  });
}

// ── Camera ───────────────────────────────────────────────────────────────
/** "rtsp" (Buddy3D camera at its own IP), "snap" (camera behind PrusaLink), or null. */
export function prusaCameraMode(printer) {
  if (String(printer?.cameraIp || "").trim()) return "rtsp";
  const conn = _conns.get(prusaKey(printer));
  return conn?.data?.hasCamera ? "snap" : null;
}

/** One snapshot from the camera PrusaLink knows about, as a data URL (or null). */
export async function prusaCameraSnap(printer) {
  const res = await prusaHttp(printer, "GET", "/api/v1/cameras/snap", { binary: true, timeoutMs: 8000 });
  return res.ok && res.data ? `data:${res.contentType || "image/png"};base64,${res.data}` : null;
}

// ── Change propagation (same cadence as the other HTTP brands) ───────────

let _statusRaf = null, _gridRaf = null, _renderRaf = null;
function notifyChange(conn, statusChanged = false) {
  if (statusChanged) {
    if (!_statusRaf) _statusRaf = requestAnimationFrame(() => { _statusRaf = null; ctx.onPrinterGridChange(); });
    refreshOnlineUI(conn.key);
  }
  if (!_gridRaf) _gridRaf = requestAnimationFrame(() => { _gridRaf = null; ctx.onGridJobsChange(); });
  const active = ctx.getActivePrinter();
  if (!active || prusaKey(active) !== conn.key || _renderRaf) return;
  _renderRaf = requestAnimationFrame(() => {
    _renderRaf = null;
    const live = $("prusaLive");
    if (live) {
      live.innerHTML = renderPrusaLiveInner(active);
      prusaWireLive(live, active);
    }
    const logHost = $("prusaLog");
    if (logHost) logHost.innerHTML = renderPrusaLogInner(active);
    const countEl = $("prusaLogCount");
    if (countEl) countEl.textContent = String(conn.log?.length || 0);
  });
}

// ── Side-card renderers ──────────────────────────────────────────────────

export function renderPrusaLiveInner(p) {
  const conn = _conns.get(prusaKey(p));
  if (!conn) return `
    <div class="snap-empty">
      <span class="icon icon-cloud icon-18"></span>
      <span>${ctx.esc(ctx.t("snapNoConnection"))}</span>
    </div>`;
  if (conn.status === "error") {
    const key = conn.lastError === "auth" ? "prusaErrAuth" : conn.lastError === "api" ? "prusaErrOldApi" : null;
    return `<div class="ffg-error-banner"><span class="icon icon-info icon-14"></span><span>${ctx.esc(key ? ctx.t(key) : String(conn.lastError || ""))}</span></div>`;
  }
  const b = brands.get("prusa");
  const betaNote = `<div class="ffg-error-banner printer-beta-note"><span class="icon icon-info icon-14"></span><span>${ctx.esc(ctx.t("printerBetaNote"))}</span></div>`;
  const msg = conn.data.statusMessage || (conn.data.printState === "attention" ? ctx.t("prusaAttention") : "");
  const banner = msg ? `<div class="ffg-error-banner"><span class="icon icon-alert icon-14"></span><span>${ctx.esc(msg)}</span></div>` : "";
  return `
    ${betaNote}
    ${banner}
    ${b.renderJobCard(p, conn)}
    ${renderPrusaStatusCard(conn)}
    ${b.renderTempCard(conn)}
    ${b.renderFilamentCard(p, conn)}`;
}

export function renderPrusaLogInner(p) {
  const log = _conns.get(prusaKey(p))?.log || [];
  if (!log.length) return `<div class="snap-log-empty">${ctx.esc(ctx.t("snapLogEmpty"))}</div>`;
  return log.slice().reverse().map((e, i) => {
    let pretty = e.raw;
    try { pretty = JSON.stringify(JSON.parse(e.raw), null, 2); } catch (_) {}
    const expanded = !!e.expanded;
    return `
      <div class="snap-log-row snap-log-row--${e.dir === "→" ? "out" : "in"}${expanded ? " snap-log-row--expanded" : ""}" data-log-idx="${log.length - 1 - i}">
        <button type="button" class="snap-log-row-head" data-row-toggle="1">
          <span class="snap-log-dir">${ctx.esc(e.dir)}</span>
          <span class="snap-log-ts">${ctx.esc(e.ts)}</span>
          <span class="snap-log-summary">${ctx.esc(e.summary)}</span>
          <span class="snap-log-row-chev icon icon-chevron-r icon-13"></span>
        </button>
        <div class="snap-log-detail"${expanded ? "" : " hidden"}>
          <button type="button" class="snap-log-detail-copy" data-copy="${ctx.esc(pretty)}">${ctx.esc(ctx.t("copyLabel"))}</button>
          <pre>${ctx.esc(pretty)}</pre>
        </div>
      </div>`;
  }).join("");
}

registerBrand("prusa", {
  controlJob: (p, a) => prusaJobControl(p, a === "stop" ? "stop" : a === "resume" ? "resume" : "pause"),
  getTempHtml: prusaGetTempHtml,
  getUnits: prusaGetUnits,
  getSlots: prusaGetSlots,
  meta, schema, helper,
  renderJobCard: renderPrusaJobCard,
  renderTempCard: renderPrusaTempCard,
  renderFilamentCard: renderPrusaFilamentCard,
  renderSettingsWidget: schemaWidget(schema),
});
