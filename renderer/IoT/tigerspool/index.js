/**
 * renderer/IoT/tigerspool/index.js — TigerSpool presence in the header.
 *
 * A TigerSpool (the ESP32 reader box that sends spools to printers) writes its
 * own presence document to users/{uid}/tigerspools/{mac} from firmware 1.65.0.
 * The contract is the TigerScale's on purpose (TigerSpool-RFID docs/PRESENCE.md):
 * same field names, server-stamped `last_heartbeat_at`, a beat every 30 s while
 * the screen is on and every 5 min once it is off (`power_state: "screen_off"`).
 *
 * This module answers "is my TigerSpool there?": one header glyph per box
 * (capped at 2), coloured by its own state, and a hover popover listing every
 * box with its status and how many printers it is standing in front of. The
 * glyph is ALWAYS shown — grey with no box — so it doubles as the way to
 * discover the product. A click opens panel.js: the side card with each box and
 * its printers, or, with no box yet, the modal that presents it.
 *
 * Static shell: #tigerspoolHealth in inventory.html. Styles: tigerspool.css,
 * plus the battery badge borrowed from tigerscale.css (.scale-health-batt) so
 * the two devices' batteries read identically.
 *
 * Usage:
 *   initTigerSpool({ state, t, esc, fbDb, openPrinterDetail, printerImageUrlFor, printerModelName,
 *                    setupHoldToConfirm, reportError });
 *   subscribeTigerSpools(uid) / unsubscribeTigerSpools() as auth state changes.
 */

import { initTigerSpoolPanel, openTigerSpool, renderTigerSpoolPanel, isTigerSpoolPanelOpen } from "./panel.js";

/** Re-draw the side card now if it is open (e.g. debug mode was just toggled). */
export function refreshTigerSpoolPanel() {
  if (_ctx && isTigerSpoolPanelOpen()) renderTigerSpoolPanel(true);
}

let _ctx = null;

// Same windows as the TigerScale: a few missed beats in each regime.
const SPOOL_ONLINE_ACTIVE_MS  = 90 * 1000;        // 30 s cadence → offline after ~90 s
const SPOOL_ONLINE_STANDBY_MS = 11 * 60 * 1000;   // 5 min cadence → offline after ~11 min

let _healthSig = "";

/** Must be called once before any other export. */
export function initTigerSpool(ctx) {
  _ctx = ctx;
  initTigerSpoolPanel(ctx, { connState: spoolConnState, tsToMs, agoString, statusLabel });
  document.getElementById("tigerspoolHealth")?.addEventListener("click", openTigerSpool);
  // Online → offline is a change of TIME, not of data: a box that stops
  // beating sends no snapshot to say so. Re-evaluate every 10 s.
  setInterval(() => { if (_ctx.state.tigerspools.length) refresh(); }, 10 * 1000);
  renderTigerSpoolHealth();
}

function refresh() {
  renderTigerSpoolHealth();
  if (isTigerSpoolPanelOpen()) renderTigerSpoolPanel();
}


// ── Firestore subscription ─────────────────────────────────────────────────

export function subscribeTigerSpools(uid) {
  unsubscribeTigerSpools();
  const { state, fbDb } = _ctx;
  state.unsubTigerspools = fbDb(uid)
    .collection("users").doc(uid).collection("tigerspools")
    .onSnapshot(snap => {
      if (uid !== state.activeAccountId) return;
      state.tigerspools = snap.docs.map(d => ({ mac: d.id, ...d.data() }));
      refresh();
    }, err => console.warn("[tigerspool]", err.code, err.message));
}

export function unsubscribeTigerSpools() {
  if (!_ctx) return;
  const { state } = _ctx;
  if (state.unsubTigerspools) { state.unsubTigerspools(); state.unsubTigerspools = null; }
  state.tigerspools = [];
  refresh();
}

// ── State ──────────────────────────────────────────────────────────────────

function tsToMs(ts) {
  if (!ts) return 0;
  if (typeof ts === "number") return ts;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (ts.seconds != null) return ts.seconds * 1000 + Math.round((ts.nanoseconds || 0) / 1e6);
  return 0;
}

/** "active" (online, screen on) · "standby" (online, screen off) · "offline". */
function spoolConnState(s) {
  const gap = Date.now() - tsToMs(s?.last_heartbeat_at);
  const standby = s?.power_state === "screen_off";
  if (gap >= (standby ? SPOOL_ONLINE_STANDBY_MS : SPOOL_ONLINE_ACTIVE_MS)) return "offline";
  return standby ? "standby" : "active";
}

// Online first, then by name, so the glyphs shown (max 2) are the live ones.
const RANK = { active: 0, standby: 1, offline: 2 };
function sortedSpools() {
  return _ctx.state.tigerspools
    .map(s => ({ s, cs: spoolConnState(s) }))
    .sort((a, b) => RANK[a.cs] - RANK[b.cs]
      || String(a.s.display_name || a.s.mac).localeCompare(String(b.s.display_name || b.s.mac)));
}

// ── Header glyph ───────────────────────────────────────────────────────────

/* Same iOS-style badge as the TigerScale glyph. No figure for an offline box:
   its last reading is only what was true when it went quiet. */
function battHtml(s, cs) {
  if (cs === "offline" || s.battery_present !== true) return "";
  const p = s.battery_percent;
  if (typeof p !== "number" || !isFinite(p)) return "";
  const charging = s.is_charging === true;
  const bst = charging ? "charging" : (p < 20 ? "low" : "neutral");
  const pct = Math.max(0, Math.min(100, p));
  return `<span class="scale-health-batt is-${bst}">`
    + `<span class="shb-fill" style="width:${pct}%"></span>`
    + `<span class="shb-txt">${p}${charging ? "" : "%"}</span>`
    + (charging ? `<span class="shb-bolt"></span>` : "")
    + `</span>`;
}

function agoString(ms) {
  const { t } = _ctx;
  const m = Math.floor(Math.max(0, Date.now() - ms) / 60000);
  if (m < 1)  return t("agoNow");
  if (m < 60) return t("agoMin", { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("agoHour", { n: h });
  return t("agoDay", { n: Math.floor(h / 24) });
}

function statusLabel(cs) {
  const { t } = _ctx;
  return cs === "active" ? t("scaleStatusOnline") : cs === "standby" ? t("scaleStatusStandby") : t("scaleStatusOffline");
}

/** Header glyph + hover. With no box: one grey glyph, and the hover says the
 * click is a way to discover it. */
export function renderTigerSpoolHealth() {
  const el = document.getElementById("tigerspoolHealth");
  if (!el || !_ctx) return;
  const { t, esc } = _ctx;
  const list = sortedSpools();

  // Rebuild only when something visible changes, so the ping isn't restarted.
  const sig = _ctx.state.lang + "#" + list.map(({ s, cs }) => [s.mac, cs, s.display_name, s.printers_active,
    s.battery_present, s.battery_percent, s.is_charging].join("/")).join("|");
  if (sig === _healthSig) return;
  _healthSig = sig;

  if (!list.length) {
    el.innerHTML = `<span class="tsp-glyphs"><span class="tsp-glyph tsp-none"><span class="tsp-icon"></span></span></span>`
      + `<div class="scale-health-pop tsp-pop"><div class="shp-row shp-row--empty">${esc(t("tigerspoolHealthNone"))}</div></div>`;
    return;
  }

  const glyphs = list.slice(0, 2).map(({ s, cs }) =>
    `<span class="tsp-glyph tsp-${cs}"><span class="tsp-icon"></span>`
    + (cs === "active" ? `<span class="tsp-live" aria-hidden="true"></span>` : "")
    + battHtml(s, cs) + `</span>`).join("");

  const rows = list.map(({ s, cs }, i) => {
    const name = s.display_name || `TigerSpool #${i + 1}`;
    const n = Number(s.printers_active) || 0;
    const detail = cs === "offline"
      ? agoString(tsToMs(s.last_heartbeat_at))
      : t("tigerspoolPrinters", { n });
    return `<div class="shp-row"><span class="shp-dot shp-dot--${cs}"></span>`
      + `<span class="shp-name">${esc(name)}</span>`
      + `<span class="shp-status">${esc(statusLabel(cs))} · ${esc(detail)}</span></div>`;
  }).join("");

  el.innerHTML = `<span class="tsp-glyphs">${glyphs}</span><div class="scale-health-pop tsp-pop">${rows}</div>`;
}
