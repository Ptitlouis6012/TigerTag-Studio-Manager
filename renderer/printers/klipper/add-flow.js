/**
 * printers/klipper/add-flow.js — Klipper plugin, "add printer" flow.
 *
 *   1. Choice   — scan the network, or type the address.
 *   2. Scan     — Moonraker sweep of the local /24s (+ the shared extra subnets),
 *                 results tickable like every other brand (scan-pick.js).
 *   3. Manual   — one address (IP or hostname, optional :port), probed, then
 *                 the settings form.
 *
 * Either way the user lands on the Printer Settings form (optional API key).
 * The scan never sends a credential. Shared `snap*` strings for the generic
 * steps; the plugin's own `klipper*` strings for the rest.
 *
 * Entry point: openKlipperAddFlow() — the plugin's `openAddFlow` hook.
 */
import { ctx } from '../context.js';
import { createScanPicker } from '../scan-pick.js';
import * as extraSubnets from '../extra-subnets.js';
import { klipperProbeIp, klipperScanLan, klipperDiscoveryRecord } from './probe.js';

const ACCENT = "#b12f36";
const ADDR_RX = /^[\w.\-]+(:\d{1,5})?$/;   // IP or hostname (voron.local), optional :port

let _scanCtl = null;
function abortScan() { if (_scanCtl && !_scanCtl.signal.aborted) _scanCtl.abort(); }

let _chipsUnsub = null;
function renderExtraSubnetChips() {
  if (_chipsUnsub) { _chipsUnsub(); _chipsUnsub = null; }
  _chipsUnsub = extraSubnets.renderChipsInto("klipperExtraSubnetsChips", ctx.esc, ctx.t);
}

function cardHtml(c) {
  const fallback = ctx.findPrinterModel("klipper", "0");
  const img = ctx.printerImageUrl(fallback);
  return `
    <div class="snap-scan-card" role="button" tabindex="0" data-ip="${ctx.esc(c.ip)}">
      <span class="snap-scan-card-thumb">${img ? `<img src="${ctx.esc(img)}" alt="" onerror="this.style.opacity='.15'"/>` : ""}</span>
      <span class="snap-scan-card-main">
        <span class="snap-scan-card-title"><span class="snap-scan-card-title-text">Klipper</span></span>
        <span class="snap-scan-card-ip">${ctx.esc(c.ip)}</span>
        ${c.version ? `<span class="snap-scan-card-line snap-scan-card-line--model">Moonraker ${ctx.esc(c.version)}</span>` : ""}
      </span>
      <span class="icon icon-chevron-r icon-14 snap-scan-card-chev"></span>
    </div>`;
}

function prefillFor(c) {
  return { ip: c.ip, printerName: `Klipper ${c.ip}`, modelId: "0", discovery: klipperDiscoveryRecord(c) };
}
function continueWith(c) { ctx.openPrinterSettings("klipper", null, prefillFor(c)); }

const _pick = createScanPicker({
  ctx, brand: "klipper", resultsId: "klipperScanResults",
  prefillFor,
  onSingle: c => { abortScan(); closePanel("klipperScanOverlay"); continueWith(c); },
  beforeAdd: abortScan,
});

function openPanel(id)  { document.getElementById(id)?.classList.add("open"); }
function closePanel(id) { document.getElementById(id)?.classList.remove("open"); }
function closeAll() {
  abortScan();
  ["klipperChoiceOverlay", "klipperScanOverlay", "klipperManualOverlay"].forEach(closePanel);
}

let _domReady = false;
function ensureDOM() {
  if (_domReady) return;
  _domReady = true;
  const choice = (id, labelKey, label, hintKey, hint) => `
      <button type="button" class="pba-brand" id="${id}">
        <span class="pba-brand-dot" style="background:${ACCENT}"></span>
        <span class="pba-brand-text">
          <span class="pba-brand-label" data-i18n="${labelKey}">${label}</span>
          <span class="pba-brand-conn"  data-i18n="${hintKey}">${hint}</span>
        </span>
        <span class="icon icon-chevron-r icon-13 pba-brand-chev"></span>
      </button>`;
  const back = id => `
      <button class="adf-btn adf-btn--secondary" id="${id}">
        <span class="icon icon-chevron-l icon-13"></span><span data-i18n="printerAddBack">Back</span>
      </button>`;
  const root = document.createElement("div");
  root.id = "klipperAddFlowRoot";
  root.innerHTML = `
<div class="modal-overlay" id="klipperChoiceOverlay" role="dialog" aria-modal="true">
  <div class="modal-card pba-card">
    <div class="pba-header">
      <div class="pba-header-text">
        <div class="pba-title" data-i18n="klipperAddChoiceTitle">Add a Klipper</div>
        <div class="pba-sub"   data-i18n="snapAddChoiceSub">How do you want to find your printer?</div>
      </div>
      <button class="modal-close" id="klipperChoiceClose">✕</button>
    </div>
    <div class="pba-brands">
      ${choice("klipperChoiceScan", "snapAddChoiceScan", "Scan network", "snapAddChoiceScanHint", "Auto-discover printers on your LAN")}
      ${choice("klipperChoiceManual", "snapAddChoiceManual", "Enter IP address", "snapAddChoiceManualHint", "Manually enter the printer's local IP")}
    </div>
    <div class="pba-footer">${back("klipperChoiceBack")}</div>
  </div>
</div>

<div class="modal-overlay" id="klipperScanOverlay" role="dialog" aria-modal="true">
  <div class="modal-card pba-card">
    <div class="pba-header">
      <div class="pba-header-text">
        <div class="pba-title" data-i18n="snapScanTitle">Scanning network…</div>
        <div class="pba-sub" id="klipperScanSub"></div>
      </div>
      <button class="modal-close" id="klipperScanClose">✕</button>
    </div>
    <div class="snap-scan-body">
      <div class="snap-scan-progress">
        <div class="snap-scan-bar"><span id="klipperScanBar"></span></div>
        <div class="snap-scan-stats" id="klipperScanStats">0 / 0</div>
      </div>
      <details class="snap-extra-subnets">
        <summary class="snap-extra-subnets-summary">
          <span class="snap-extra-subnets-icon icon icon-cloud icon-14"></span>
          <span class="snap-extra-subnets-label" data-i18n="snapScanExtraSubnetsLabel">Extra subnets to scan</span>
          <span class="snap-extra-subnets-chev icon icon-chevron-r icon-13"></span>
        </summary>
        <div class="snap-extra-subnets-body">
          <div class="snap-extra-subnets-hint" data-i18n="snapScanExtraSubnetsHint">Add subnets your computer can reach via routing but isn't directly on.</div>
          <div class="snap-extra-subnets-row">
            <input type="text" class="snap-extra-subnets-input" id="klipperExtraSubnetsInput" placeholder="192.168.40" autocomplete="off" autocapitalize="off" spellcheck="false"/>
            <button type="button" class="snap-extra-subnets-add" id="klipperExtraSubnetsAdd" data-i18n="snapScanExtraSubnetsAdd">Add</button>
          </div>
          <div class="snap-extra-subnets-chips" id="klipperExtraSubnetsChips"></div>
        </div>
      </details>
      <div class="snap-scan-results" id="klipperScanResults"></div>
      <div class="snap-scan-empty" id="klipperScanEmpty" hidden data-i18n="klipperScanEmpty">No Klipper found on your network</div>
    </div>
    <div class="pba-footer">
      ${back("klipperScanBack")}
      <button class="adf-btn adf-btn--secondary" id="klipperScanRestart">
        <span class="icon icon-refresh icon-13"></span><span data-i18n="snapScanRestart">Restart scan</span>
      </button>
    </div>
  </div>
</div>

<div class="modal-overlay" id="klipperManualOverlay" role="dialog" aria-modal="true">
  <div class="modal-card pba-card">
    <div class="pba-header">
      <div class="pba-header-text">
        <div class="pba-title" data-i18n="snapManualTitle">Manual add</div>
        <div class="pba-sub"   data-i18n="snapManualSub">Type the printer's local IP — we'll probe it to pre-fill the rest.</div>
      </div>
      <button class="modal-close" id="klipperManualClose">✕</button>
    </div>
    <div class="pba-body">
      <div class="pba-field">
        <span class="pba-field-label" data-i18n="printerLblIP">IP address</span>
        <input type="text" id="klipperManualIpInput" class="pba-input pba-input--mono" placeholder="192.168.1.50" maxlength="64" spellcheck="false" autocomplete="off" autocapitalize="off"/>
        <div class="pba-error" id="klipperManualIpError" hidden></div>
      </div>
    </div>
    <div class="pba-footer">
      ${back("klipperManualBack")}
      <button class="adf-btn adf-btn--primary" id="klipperManualProbeBtn">
        <span class="icon icon-check icon-13"></span>
        <span class="label" data-i18n="snapManualProbe">Probe + continue</span>
        <span class="spinner"></span>
      </button>
    </div>
  </div>
</div>`;
  document.body.appendChild(root);
  wireDOM();
  ctx.applyTranslations();
}

function wireDOM() {
  const $ = id => document.getElementById(id);
  for (const id of ["klipperChoiceOverlay", "klipperScanOverlay", "klipperManualOverlay"]) {
    $(id)?.addEventListener("click", e => { if (e.target.id === id) closeAll(); });
  }
  $("klipperChoiceClose")?.addEventListener("click", closeAll);
  $("klipperChoiceBack")?.addEventListener("click", () => { closePanel("klipperChoiceOverlay"); ctx.openBrandPicker(); });
  $("klipperChoiceScan")?.addEventListener("click", () => { closePanel("klipperChoiceOverlay"); openScanPanel(); });
  $("klipperChoiceManual")?.addEventListener("click", () => { closePanel("klipperChoiceOverlay"); openManualPanel(); });
  $("klipperScanClose")?.addEventListener("click", closeAll);
  $("klipperScanBack")?.addEventListener("click", () => { abortScan(); closePanel("klipperScanOverlay"); openPanel("klipperChoiceOverlay"); });
  $("klipperScanRestart")?.addEventListener("click", () => { abortScan(); openScanPanel(); });
  $("klipperExtraSubnetsAdd")?.addEventListener("click", () => {
    const input = $("klipperExtraSubnetsInput");
    if (input && extraSubnets.addPrefix(input.value)) input.value = "";
  });
  $("klipperExtraSubnetsInput")?.addEventListener("keydown", e => { if (e.key === "Enter") $("klipperExtraSubnetsAdd")?.click(); });
  $("klipperManualClose")?.addEventListener("click", closeAll);
  $("klipperManualBack")?.addEventListener("click", () => { closePanel("klipperManualOverlay"); openPanel("klipperChoiceOverlay"); });
  $("klipperManualProbeBtn")?.addEventListener("click", handleManualProbe);
  $("klipperManualIpInput")?.addEventListener("keydown", e => { if (e.key === "Enter") handleManualProbe(); });
}

function openScanPanel() {
  ensureDOM();
  const $ = id => document.getElementById(id);
  const results = $("klipperScanResults"), empty = $("klipperScanEmpty"), bar = $("klipperScanBar"),
        stats = $("klipperScanStats"), sub = $("klipperScanSub");
  if (results) results.innerHTML = "";
  _pick.reset();
  if (empty) empty.hidden = true;
  if (bar) bar.style.width = "0%";
  if (sub) sub.textContent = ctx.t("snapScanStarting") || "Starting scan…";
  renderExtraSubnetChips();
  openPanel("klipperScanOverlay");
  _scanCtl = new AbortController();
  const signal = _scanCtl.signal;
  let found = 0;
  klipperScanLan({
    signal,
    getExtraSubnets: () => extraSubnets.loadList(),
    onCandidate(c) {
      found++;
      const wrap = document.createElement("div");
      wrap.innerHTML = cardHtml(c);
      const card = wrap.firstElementChild;
      if (!card) return;
      _pick.attach(card, c);
      $("klipperScanResults")?.appendChild(card);
    },
    onProgress({ done, total }) {
      if (bar) bar.style.width = `${Math.min(100, Math.round((done / total) * 100))}%`;
      if (stats) stats.textContent = `${done} / ${total}`;
    },
  }).then(() => {
    if (sub) sub.textContent = "";
    if (!signal.aborted && found === 0 && empty) empty.hidden = false;
  }).catch(() => { if (sub) sub.textContent = ""; });
}

async function handleManualProbe() {
  const input = document.getElementById("klipperManualIpInput");
  const errEl = document.getElementById("klipperManualIpError");
  const btn = document.getElementById("klipperManualProbeBtn");
  if (!input) return;
  const ip = input.value.trim();
  if (!ADDR_RX.test(ip)) {
    if (errEl) { errEl.textContent = ctx.t("snapAddByIpInvalid") || "Invalid IP address format"; errEl.hidden = false; }
    input.focus();
    return;
  }
  if (errEl) errEl.hidden = true;
  if (btn) { btn.disabled = true; btn.classList.add("loading"); }
  const c = await klipperProbeIp(ip);
  if (btn) { btn.disabled = false; btn.classList.remove("loading"); }
  if (c) { closePanel("klipperManualOverlay"); continueWith(c); }
  else if (errEl) { errEl.textContent = ctx.t("klipperManualNoReply", { ip }); errEl.hidden = false; }
}

function openManualPanel() {
  ensureDOM();
  const input = document.getElementById("klipperManualIpInput");
  const errEl = document.getElementById("klipperManualIpError");
  if (input) input.value = "";
  if (errEl) errEl.hidden = true;
  openPanel("klipperManualOverlay");
  setTimeout(() => input?.focus(), 80);
}

export function openKlipperAddFlow() {
  ensureDOM();
  openPanel("klipperChoiceOverlay");
}
