/**
 * renderer/IoT/tigertouch/index.js — Tiger Touch presence in the header.
 *
 * A Tiger Touch is a BIGTREETECH Panda Touch / K-Touch screen running the Tiger
 * Touch firmware: it follows the account's printers and shows them. It writes
 * its own presence document to users/{uid}/tigertouchs/{mac} — the TigerScale /
 * TigerSpool contract on purpose (Tiger-Touch docs/TELEMETRY.md): same identity,
 * liveness and power fields, a server-stamped `last_heartbeat_at`, a beat every
 * 30 s while the screen is on and every 5 min while it sleeps (`power_state:
 * "screen_off"` — asleep, not offline). On top: `printer_ids` / `printers_online`
 * (what it follows and reaches), `demo`, and the LAN mode (`lan_live`,
 * `lan_access_code`, `lan_url`) that serves the screen itself on the network.
 *
 * Same shape as the TigerSpool module: one header glyph per screen (capped at 2)
 * with a hover popover, ALWAYS shown (grey with none, so it doubles as the way to
 * discover the product); a click opens panel.js — the side card, or the
 * discovery modal when the account has no screen yet.
 *
 * `lan_access_code` / `lan_url` give control of the screen to anyone on that
 * network: they are shown to the owner only, in the side card, and never copied
 * anywhere else (the MCP masks them — MCP_SECRET_FIELD).
 *
 * Static shell: #tigertouchHealth, #tigertouchPanel, #tigertouchDiscoverOverlay,
 * #tigertouchShotOverlay in inventory.html. Styles: tigertouch.css (+ the
 * TigerSpool card / printer-row classes, so the two devices read as siblings).
 */

import { initTigerTouchPanel, openTigerTouch, renderTigerTouchPanel, isTigerTouchPanelOpen } from "./panel.js";
export { openTigerTouch };

let _ctx = null;

// Same windows as the TigerScale and the TigerSpool.
const ONLINE_ACTIVE_MS  = 90 * 1000;        // 30 s cadence → offline after ~90 s
const ONLINE_STANDBY_MS = 11 * 60 * 1000;   // 5 min cadence → offline after ~11 min

let _healthSig = "";

/** Re-draw the side card now if it is open (e.g. debug mode was just toggled). */
export function refreshTigerTouchPanel() {
  if (_ctx && isTigerTouchPanelOpen()) renderTigerTouchPanel(true);
}

/** Must be called once before any other export. */
export function initTigerTouch(ctx) {
  _ctx = ctx;
  initTigerTouchPanel(ctx, { connState, tsToMs, agoString, statusLabel });
  document.getElementById("tigertouchHealth")?.addEventListener("click", openTigerTouch);
  // Online → offline is a change of TIME, not of data: re-evaluate every 10 s.
  setInterval(() => { if (_ctx.state.tigertouchs.length) refresh(); }, 10 * 1000);
  renderTigerTouchHealth();
}

function refresh() {
  renderTigerTouchHealth();
  if (isTigerTouchPanelOpen()) renderTigerTouchPanel();
  _ctx?.onTouchsChanged?.();   // e.g. the open Tiger Touch sheet follows its live state
}

// ── Firestore subscription ─────────────────────────────────────────────────

export function subscribeTigerTouchs(uid) {
  unsubscribeTigerTouchs();
  const { state, fbDb } = _ctx;
  state.unsubTigertouchs = fbDb(uid)
    .collection("users").doc(uid).collection("tigertouchs")
    .onSnapshot(snap => {
      if (uid !== state.activeAccountId) return;
      state.tigertouchs = snap.docs.map(d => ({ mac: d.id, ...d.data() }));
      refresh();
    }, err => console.warn("[tigertouch]", err.code, err.message));
}

export function unsubscribeTigerTouchs() {
  if (!_ctx) return;
  const { state } = _ctx;
  if (state.unsubTigertouchs) { state.unsubTigertouchs(); state.unsubTigertouchs = null; }
  state.tigertouchs = [];
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

/** "active" (online, screen on) · "standby" (online, screen asleep) · "offline". */
export function connState(s) {
  const gap = Date.now() - tsToMs(s?.last_heartbeat_at);
  const standby = s?.power_state === "screen_off";
  if (gap >= (standby ? ONLINE_STANDBY_MS : ONLINE_ACTIVE_MS)) return "offline";
  return standby ? "standby" : "active";
}

const RANK = { active: 0, standby: 1, offline: 2 };
function sorted() {
  return _ctx.state.tigertouchs
    .map(s => ({ s, cs: connState(s) }))
    .sort((a, b) => RANK[a.cs] - RANK[b.cs]
      || String(a.s.display_name || a.s.mac).localeCompare(String(b.s.display_name || b.s.mac)));
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

/* For a Tiger … report: each device and the printers it follows, so the issue
   says what the box saw. No address, no code, no MAC — the issue is public. */
const _BRAND = { bambulab: "Bambu Lab", creality: "Creality", elegoo: "Elegoo", flashforge: "FlashForge", snapmaker: "Snapmaker",
  anycubic: "Anycubic", prusa: "Prusa", klipper: "Klipper", octoprint: "OctoPrint" };
function _reportDevices(list, connStateOf) {
  const { state } = _ctx;
  return list.map(s => {
    const cs = connStateOf(s);
    const ids = Array.isArray(s.printer_ids) ? s.printer_ids : [];
    const seen = cs !== "offline" && Array.isArray(s.printers_online) ? s.printers_online : null;
    return {
      name: s.display_name || "", fw: s.fw_version || "", status: cs,
      wifi: typeof s.wifi_signal_dbm === "number" ? `${s.wifi_signal_dbm} dBm` : "",
      demo: s.demo === true,
      printers: s.demo === true ? [] : ids.slice(0, 30).map(id => {
        const p = state.printers.find(x => x.id === id);
        if (!p) return { name: "(removed from the account)", model: "", device: seen ? (seen.includes(id) ? "online" : "offline") : "unknown", studio: "" };
        let studio = "";
        try { studio = _ctx.isPrinterOnline?.(p) ? "online" : "offline"; } catch (_) {}
        return {
          name: p.printerName || "", model: [_BRAND[p.brand] || p.brand, _ctx.printerModelName?.(p.brand, p.printerModelId)].filter(Boolean).join(" "),
          device: seen ? (seen.includes(id) ? "online" : "offline") : "unknown", studio,
        };
      }),
    };
  });
}
export function touchReportDevices() { return _ctx ? _reportDevices(_ctx.state.tigertouchs, connState) : []; }

// ── Header glyph ───────────────────────────────────────────────────────────

/** Header glyph + hover. No battery figure: the board cannot measure it. */
export function renderTigerTouchHealth() {
  const el = document.getElementById("tigertouchHealth");
  if (!el || !_ctx) return;
  const { t, esc } = _ctx;
  const list = sorted();

  // The empty text is part of the signature: drawn before the locales finish
  // loading, the bubble would otherwise keep the raw key until something changed.
  const sig = _ctx.state.lang + "#" + t("tigertouchHealthNone") + "#" + list.map(({ s, cs }) => [s.mac, cs, s.display_name, s.printers_active, s.demo].join("/")).join("|");
  if (sig === _healthSig) return;
  _healthSig = sig;

  if (!list.length) {
    el.innerHTML = `<span class="ttc-glyphs"><span class="ttc-glyph ttc-none"><span class="ttc-icon"></span></span></span>`
      + `<div class="scale-health-pop ttc-pop"><div class="shp-row shp-row--empty">${esc(t("tigertouchHealthNone"))}</div></div>`;
    return;
  }

  const glyphs = list.slice(0, 2).map(({ cs }) =>
    `<span class="ttc-glyph ttc-${cs}"><span class="ttc-icon"></span>`
    + (cs === "active" ? `<span class="tsp-live" aria-hidden="true"></span>` : "") + `</span>`).join("");

  const rows = list.map(({ s, cs }, i) => {
    const name = s.display_name || `Tiger Touch #${i + 1}`;
    const detail = cs === "offline" ? agoString(tsToMs(s.last_heartbeat_at))
      : s.demo === true ? t("tigertouchDemoShort")
      : t("tigerspoolPrinters", { n: Number(s.printers_active) || 0 });
    return `<div class="shp-row"><span class="shp-dot shp-dot--${cs}"></span>`
      + `<span class="shp-name">${esc(name)}</span>`
      + `<span class="shp-status">${esc(statusLabel(cs))} · ${esc(detail)}</span></div>`;
  }).join("");

  el.innerHTML = `<span class="ttc-glyphs">${glyphs}</span><div class="scale-health-pop ttc-pop">${rows}</div>`;
}
