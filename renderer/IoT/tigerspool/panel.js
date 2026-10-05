/**
 * renderer/IoT/tigerspool/panel.js — what a click on the TigerSpool glyph opens.
 *
 *   • at least one TigerSpool → the side card: each box (status, Wi-Fi, power,
 *     firmware, address) and the printers it is standing in front of, matched
 *     to the account's own printers by document id (`printer_ids` holds the ids
 *     of users/{uid}/printers/{brand}/devices). A row opens that printer.
 *     Each card has a hold-to-confirm "remove" (same gesture as a TigerScale),
 *     which deletes the box's presence document from the account.
 *   • none yet → the discovery modal: what the box does, and how to build one.
 *
 * Static shell in inventory.html: #tigerspoolPanel / #tigerspoolOverlay and
 * #tigerspoolDiscoverOverlay. The card chrome reuses tigerscale.css
 * (.scale-card*, .scale-chip*) so the two devices' cards read as siblings.
 */

const WIKI = "https://wiki.tigersystem.io";
const GITHUB = "https://github.com/TigerTag-Project/TigerSpool-RFID";
// The desktop stand comes in two mirror versions — the spool sits left or right of the box.
const MAKERWORLD_LEFT  = "https://makerworld.com/models/3360492-tigerspool-desktop-stand-spool-on-the-left";
const MAKERWORLD_RIGHT = "https://makerworld.com/models/3360619-tigerspool-desktop-stand-spool-on-the-right";
const PHOTO_CARD = "../assets/img/TigerSpool_card.png";
const PHOTO_LEFT  = "../assets/img/TigerSpool_left.webp";   // the modal: desktop stand, spool on the left
const PHOTO_RIGHT = "../assets/img/TigerSpool_right.webp";  // … and spool on the right  // the card: the whole box and its whole spool

const BRAND_LABEL = {
  bambulab: "Bambu Lab", creality: "Creality", elegoo: "Elegoo",
  flashforge: "FlashForge", snapmaker: "Snapmaker", anycubic: "Anycubic",
};

let _ctx = null;
let _helpers = null;   // { connState, tsToMs, agoString, statusLabel } from index.js

export function initTigerSpoolPanel(ctx, helpers) {
  _ctx = ctx; _helpers = helpers;
  const $ = id => document.getElementById(id);
  $("tigerspoolPanelClose")?.addEventListener("click", closeTigerSpoolPanel);
  $("tigerspoolOverlay")?.addEventListener("click", closeTigerSpoolPanel);
  $("tigerspoolDiscoverClose")?.addEventListener("click", closeTigerSpoolDiscover);
  $("tigerspoolDiscoverOverlay")?.addEventListener("click", e => {
    if (e.target.id === "tigerspoolDiscoverOverlay") closeTigerSpoolDiscover();
  });
  $("tigerspoolPanelBody")?.addEventListener("click", e => {
    // Raw JSON copy — read from the live document, not from the drawn text,
    // so the copy is the latest heartbeat even between two redraws.
    const copy = e.target.closest("[data-tsp-copy]");
    if (copy) {
      e.preventDefault(); e.stopPropagation();
      const doc = _ctx.state.tigerspools.find(x => x.mac === copy.dataset.tspCopy);
      if (!doc) return;
      try {
        navigator.clipboard.writeText(JSON.stringify(doc, null, 2));
        copy.classList.add("pp-copy--ok");
        setTimeout(() => copy.classList.remove("pp-copy--ok"), 900);
      } catch (_) { /* clipboard refused: nothing to undo */ }
      return;
    }
    const row = e.target.closest("[data-tsp-printer]");
    if (!row || !row.dataset.brand) return;
    closeTigerSpoolPanel();
    _ctx.openPrinterDetail?.(row.dataset.brand, row.dataset.tspPrinter);
  });
  $("tigerspoolDiscoverBody")?.addEventListener("click", e => {
    const a = e.target.closest("[data-tsp-link]");
    if (!a) return;
    e.preventDefault();
    window.electronAPI?.openExternal?.(a.dataset.tspLink);
  });
}

/** The glyph's click: the side card when there is a box, the modal otherwise. */
export function openTigerSpool() {
  if (_ctx.state.tigerspools.length) openTigerSpoolPanel();
  else openTigerSpoolDiscover();
}

// ── Side card ──────────────────────────────────────────────────────────────

export function isTigerSpoolPanelOpen() {
  return !!document.getElementById("tigerspoolPanel")?.classList.contains("open");
}

function openTigerSpoolPanel() {
  renderTigerSpoolPanel();
  document.getElementById("tigerspoolPanel")?.classList.add("open");
  document.getElementById("tigerspoolOverlay")?.classList.add("open");
}

export function closeTigerSpoolPanel() {
  document.getElementById("tigerspoolPanel")?.classList.remove("open");
  document.getElementById("tigerspoolOverlay")?.classList.remove("open");
}

let _panelSig = "";
// Which "Raw JSON (debug)" blocks are open, so a heartbeat rebuild keeps them open.
const _debugOpen = new Set();

export function renderTigerSpoolPanel(force = false) {
  const body = document.getElementById("tigerspoolPanelBody");
  if (!body) return;
  const { state } = _ctx;
  const list = state.tigerspools;
  // The last box was removed while the card was open: close it rather than
  // leave an empty card behind.
  if (!list.length) { closeTigerSpoolPanel(); return; }

  // In debug mode the raw document is on screen, so ANY field moving (the
  // heartbeat timestamp included) is a visible change.
  const sig = JSON.stringify([state.lang, !!state.debugEnabled, state.debugEnabled ? list : null, list.map(s => [s.mac, _helpers.connState(s), s.display_name,
    s.printer_ids, s.printers_online, s.wifi_signal_dbm, s.battery_percent, s.is_charging, s.fw_version, s.ip_address]),
    state.printers.map(p => [p.id, p.printerName, p.printerModelId])]);
  if (!force && sig === _panelSig) return;
  _panelSig = sig;

  // Live boxes first, the same order as the header glyphs.
  const rank = { active: 0, standby: 1, offline: 2 };
  const ordered = [...list].sort((a, b) => rank[_helpers.connState(a)] - rank[_helpers.connState(b)]
    || String(a.display_name || a.mac).localeCompare(String(b.display_name || b.mac)));
  body.innerHTML = ordered.map(cardHtml).join("");
  wireRemoveButtons(body);
  body.querySelectorAll("details.scale-debug[data-tsp-debug]").forEach(det => {
    det.addEventListener("toggle", () => {
      if (det.open) _debugOpen.add(det.dataset.tspDebug); else _debugOpen.delete(det.dataset.tspDebug);
    });
  });
}

/* The document exactly as Firestore holds it (users/{uid}/tigerspools/{mac}),
   shown in debug mode only — same block and styles as the TigerScale card. */
function debugHtml(s) {
  const { state, t, esc, highlight } = _ctx;
  if (!state.debugEnabled) return "";
  const json = JSON.stringify(s, null, 2);
  // Copy button: the printer panel's own (.pp-raw-copy), same place, same look.
  return `<details class="scale-debug" data-tsp-debug="${esc(s.mac)}"${_debugOpen.has(s.mac) ? " open" : ""}>
      <summary class="scale-debug-summary">Raw JSON (debug)</summary>
      <div class="pp-raw-wrap tsp-raw-wrap">
        <button type="button" class="pp-raw-copy pp-copy" data-tsp-copy="${esc(s.mac)}" title="${esc(t("copyLabel"))}">
          <span class="icon icon-copy icon-13"></span>
          <span>${esc(t("copyLabel"))}</span>
        </button>
        <pre class="json scale-debug-pre">${highlight ? highlight(json) : esc(json)}</pre>
      </div>
    </details>`;
}

/* Remove = delete users/{uid}/tigerspools/{mac}. Hold-to-confirm, like the
   TigerScale's, because it is one gesture away from losing the card.
   ⚠️ A box that is still ON and signed in writes its next beat as an upsert
   (firmware: no "document must exist" precondition), so it comes back within
   30 s. Removing is for a box that is off, sold or reset — said in the tooltip. */
function wireRemoveButtons(body) {
  const { state, fbDb, setupHoldToConfirm, reportError } = _ctx;
  body.querySelectorAll(".scale-card-btn[data-tsp-remove]").forEach(btn => {
    setupHoldToConfirm?.(btn, 1500, async () => {
      const mac = btn.dataset.tspRemove;
      const uid = state.activeAccountId;
      if (!mac || !uid) return;
      try {
        await fbDb(uid).collection("users").doc(uid).collection("tigerspools").doc(mac).delete();
      } catch (e) { reportError?.("tigerspool.delete", e); }
    });
  });
}

function formatMac(raw) {
  const clean = String(raw || "").replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
  return clean ? clean.match(/.{1,2}/g).join(":") : "";
}

function pillClass(cs) { return cs === "active" ? "is-online" : cs === "standby" ? "is-standby" : "is-offline"; }

function wifiLabel(dbm) {
  const { t } = _ctx;
  if (dbm >= -67) return t("scaleChipWifiQualityExcellent");
  if (dbm >= -73) return t("scaleChipWifiQualityGood");
  if (dbm >= -80) return t("scaleChipWifiQualityFair");
  return t("scaleChipWifiQualityWeak");
}

function chipsHtml(s, cs) {
  const { t, esc } = _ctx;
  const online = cs !== "offline";
  const chips = [];
  const dbm = s.wifi_signal_dbm;
  if (typeof dbm === "number" && isFinite(dbm) && dbm !== 0) {
    chips.push(`<span class="scale-chip scale-chip--wifi scale-chip--wifi-${online ? "ok" : "off"}" title="${esc(wifiLabel(dbm))} · ${dbm} dBm">`
      + `<span class="icon icon-wifi icon-13" aria-hidden="true"></span></span>`);
  }
  const p = s.battery_percent;
  if (s.battery_present === true && typeof p === "number" && isFinite(p) && online) {
    const charging = s.is_charging === true;
    const st = charging ? "charging" : (p < 20 ? "low" : "neutral");
    chips.push(`<span class="scale-chip scale-chip--battery scale-chip--bat-${st}" title="${esc(charging ? `${p}% · ${t("scaleChipCharging")}` : `${p}%`)}">`
      + `<span class="scale-batt"><span class="scale-batt-fill" style="width:${Math.max(0, Math.min(100, p))}%"></span><span class="scale-batt-num">${p}</span></span>`
      + (charging ? `<span class="icon icon-bolt icon-10 scale-batt-bolt"></span>` : "") + `</span>`);
  } else if (s.power_source) {
    const usb = String(s.power_source).toLowerCase() === "usb";
    chips.push(`<span class="scale-chip scale-chip--power" title="${esc(t("scaleChipPower"))}">`
      + `<span class="icon ${usb ? "icon-plug" : "icon-battery"} icon-12"></span>`
      + `<span class="scale-chip-text">${esc(usb ? t("scaleChipPowerUsb") : t("scaleChipPowerBattery"))}</span></span>`);
  }
  if (s.fw_version) {
    chips.push(`<span class="scale-chip scale-chip--fw" title="${esc(t("scaleChipFwTooltip"))}">`
      + `<span class="icon icon-settings icon-12"></span><span class="scale-chip-text">v${esc(String(s.fw_version))}</span></span>`);
  }
  if (s.ip_address) {
    chips.push(`<span class="scale-chip" title="${esc(s.mdns_hostname || "")}">`
      + `<span class="scale-chip-text">${esc(String(s.ip_address))}</span></span>`);
  }
  if (!online) {
    const ms = _helpers.tsToMs(s.last_heartbeat_at);
    if (ms) chips.push(`<span class="scale-chip scale-chip--seen" title="${esc(t("scaleChipLastSeen"))}">`
      + `<span class="icon icon-clock icon-12"></span><span class="scale-chip-text">${esc(_helpers.agoString(ms))}</span></span>`);
  }
  return chips.join("");
}

/* The dot in front of each machine is what the BOX sees (`printers_online`,
   firmware: the same rule as the dots on its own home screen) — never Studio's
   own link to that printer, which can differ: a printer can answer Studio over
   the cloud and be unreachable from the box's network, or the reverse.
   Grey "unknown" when the box itself is offline (it is not reporting) or runs a
   firmware that does not publish the field yet. */
function dotHtml(dot) {
  const { t, esc } = _ctx;
  const title = dot === "up" ? t("tigerspoolPrinterUp")
              : dot === "down" ? t("tigerspoolPrinterDown") : t("tigerspoolPrinterUnknown");
  return `<span class="tsp-dot tsp-dot--${dot}" title="${esc(title)}"></span>`;
}

function printerRowHtml(id, dot) {
  const { state, t, esc } = _ctx;
  const p = state.printers.find(x => x.id === id);
  if (!p) {
    // The box still lists a printer this account no longer has (removed in
    // Studio since the box last synced). Shown, not hidden: it IS in the box.
    return `<div class="tsp-printer is-missing">` + dotHtml(dot)
      + `<span class="tsp-printer-img tsp-printer-img--none"></span>`
      + `<span class="tsp-printer-text"><span class="tsp-printer-name">${esc(t("tigerspoolPrinterMissing"))}</span>`
      + `<span class="tsp-printer-sub">${esc(id)}</span></span></div>`;
  }
  const img = _ctx.printerImageUrlFor?.(p.brand, p.printerModelId);
  const model = _ctx.printerModelName?.(p.brand, p.printerModelId) || "";
  const name = p.printerName || model || BRAND_LABEL[p.brand] || p.brand;
  const sub = [BRAND_LABEL[p.brand] || p.brand, model !== name ? model : ""].filter(Boolean).join(" · ");
  return `<button type="button" class="tsp-printer" data-tsp-printer="${esc(p.id)}" data-brand="${esc(p.brand)}">`
    + dotHtml(dot)
    + (img ? `<img class="tsp-printer-img" src="${esc(img)}" alt="" draggable="false" />`
           : `<span class="tsp-printer-img tsp-printer-img--none"></span>`)
    + `<span class="tsp-printer-text"><span class="tsp-printer-name">${esc(name)}</span>`
    + `<span class="tsp-printer-sub">${esc(sub)}</span></span>`
    + `<span class="tsp-printer-go" aria-hidden="true">›</span></button>`;
}

function cardHtml(s) {
  const { t, esc } = _ctx;
  const cs = _helpers.connState(s);
  const ids = Array.isArray(s.printer_ids) ? s.printer_ids : [];
  const online = (cs !== "offline" && Array.isArray(s.printers_online)) ? s.printers_online : null;
  const dotFor = id => online ? (online.includes(id) ? "up" : "down") : "unknown";
  const printers = ids.length
    ? ids.map(id => printerRowHtml(id, dotFor(id))).join("")
    : `<div class="tsp-printers-empty">${esc(t("tigerspoolNoPrinters"))}</div>`;
  return `<div class="tsp-entry">
    <div class="scale-card${cs !== "offline" ? " is-online" : ""}">
      <div class="scale-card-head">
        <img class="scale-card-photo tsp-card-photo" src="${PHOTO_CARD}" alt="" draggable="false" />
        <div class="scale-card-id">
          <div class="scale-card-name-row">
            <span class="scale-card-name">${esc(s.display_name || "TigerSpool")}</span>
            <span class="scale-card-status-pill ${pillClass(cs)}">
              <span class="scale-card-status-dot"></span>
              <span class="scale-card-status-pill-text">${esc(_helpers.statusLabel(cs))}</span>
            </span>
          </div>
          <div class="scale-card-mac">${esc(formatMac(s.mac))}</div>
        </div>
        <div class="scale-card-actions">
          <button class="scale-card-btn" data-tsp-remove="${esc(s.mac)}" title="${esc(t("tigerspoolRemove"))}">
            <span class="hold-progress"></span>
            <span class="icon icon-trash icon-13"></span>
          </button>
        </div>
      </div>
      <div class="scale-card-chips">${chipsHtml(s, cs)}</div>
      <div class="tsp-printers">
        <div class="tsp-printers-title">${esc(t("tigerspoolPrintersTitle", { n: ids.length }))}</div>
        ${printers}
      </div>
      ${debugHtml(s)}
    </div>
  </div>`;
}

// ── Discovery modal ────────────────────────────────────────────────────────

export function openTigerSpoolDiscover() {
  const body = document.getElementById("tigerspoolDiscoverBody");
  if (!body) return;
  const { t, esc, state } = _ctx;
  const guide = `${WIKI}${state.lang === "fr" ? "/fr" : ""}/products/tigerspool/`;
  // A product launch card, not an install flow: the two desktop stands glowing
  // up top, the promise, an animated "chip → TigerSpool → printer slot" strip
  // that shows what it does at a glance, then three equal tiles saying where to
  // go next — print it (MakerWorld, spool left / right), discover it (wiki),
  // hack it (GitHub).
  const badges = [["printer", "tigerspoolPointBrands"], ["coins", "tigerspoolPointCheap"], ["wrench", "tigerspoolPointEasy"]]
    .map(([ico, k]) => `<span class="tsp-badge"><span class="icon icon-${ico} icon-13" aria-hidden="true"></span>${esc(t(k))}</span>`).join("");
  const node = (ico, label) => `<div class="tsp-flow-node"><span class="tsp-flow-ico">${ico}</span><span>${esc(label)}</span></div>`;
  const pill = (url, key) => `<a class="tsp-pill" href="${esc(url)}" data-tsp-link="${esc(url)}">${esc(t(key))}</a>`;
  const tile = (ico, title, sub) => `
      <span class="tsp-tile-ico"><span class="icon icon-${ico} icon-20" aria-hidden="true"></span></span>
      <span class="tsp-tile-title">${esc(t(title))}</span>
      <span class="tsp-tile-sub">${esc(t(sub))}</span>`;
  const arrow = `<span class="tsp-tile-go"><span class="icon icon-arrow-r icon-13" aria-hidden="true"></span></span>`;
  body.innerHTML = `
    <div class="tsp-hero">
      <span class="tsp-eyebrow">${esc(t("tigerspoolEyebrow"))}</span>
      <div class="tsp-hero-stands">
        <img src="${PHOTO_LEFT}" alt="" draggable="false" />
        <img src="${PHOTO_RIGHT}" alt="" draggable="false" />
      </div>
    </div>
    <div class="tsp-discover-text">
      <h2 class="tsp-discover-lead">${esc(t("tigerspoolPitch"))}</h2>
      <p class="tsp-discover-sub">${esc(t("tigerspoolSub"))}</p>
      <div class="tsp-badges">${badges}</div>
    </div>
    <div class="tsp-flow" aria-hidden="true">
      ${node(`<span class="icon icon-nfc icon-20"></span>`, t("tigerspoolFlowChip"))}
      <span class="tsp-flow-line"></span>
      ${node(`<span class="tsp-flow-spool"></span>`, "TigerSpool")}
      <span class="tsp-flow-line"></span>
      ${node(`<span class="icon icon-printer icon-20"></span>`, t("tigerspoolFlowSlot"))}
    </div>
    <div class="tsp-tiles">
      <div class="tsp-tile tsp-tile--hot">
        ${tile("package", "tigerspoolCtaPrint", "tigerspoolCtaPrintSub")}
        <span class="tsp-pills">${pill(MAKERWORLD_LEFT, "tigerspoolSpoolLeft")}${pill(MAKERWORLD_RIGHT, "tigerspoolSpoolRight")}</span>
      </div>
      <a class="tsp-tile" href="${esc(guide)}" data-tsp-link="${esc(guide)}">${tile("book", "tigerspoolCtaWiki", "tigerspoolCtaWikiSub")}${arrow}</a>
      <a class="tsp-tile" href="${esc(GITHUB)}" data-tsp-link="${esc(GITHUB)}">${tile("github", "tigerspoolCtaCode", "tigerspoolCtaCodeSub")}${arrow}</a>
    </div>`;
  document.getElementById("tigerspoolDiscoverOverlay")?.classList.add("open");
}

export function closeTigerSpoolDiscover() {
  document.getElementById("tigerspoolDiscoverOverlay")?.classList.remove("open");
}
