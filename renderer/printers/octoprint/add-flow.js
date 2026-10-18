/**
 * printers/octoprint/add-flow.js — OctoPrint plugin, "add printer" flow.
 *
 *   1. Choice   — scan the network, or type the address.
 *   2. Scan     — `/plugin/appkeys/probe` sweep of the local /24s (+ the shared
 *                 extra subnets), results tickable like every other brand.
 *   3. Manual   — one address (IP or hostname, optional :port), probed.
 *   4. Approve  — when OctoPrint offers Application Keys, Studio asks for a key
 *                 and the user clicks "Allow" in OctoPrint: nothing to copy.
 *                 "Paste a key instead" skips straight to the form.
 *
 * Ends on the Printer Settings form, the API key prefilled when approved.
 * Entry point: openOctoAddFlow() — the plugin's `openAddFlow` hook.
 */
import { mountModelList } from '../model-list.js';
import { ctx } from '../context.js';
import { createScanPicker } from '../scan-pick.js';
import * as extraSubnets from '../extra-subnets.js';
import { opProbeIp, opScanLan, opDiscoveryRecord } from './probe.js';
import { opRequestApiKey } from './core.js';

const ACCENT = "#13c100";
const ADDR_RX = /^[\w.\-]+(:\d{1,5})?$/;   // IP or hostname (voron.local), optional :port

let _scanCtl = null;
function abortScan() { if (_scanCtl && !_scanCtl.signal.aborted) _scanCtl.abort(); }

let _chipsUnsub = null;
function renderExtraSubnetChips() {
  if (_chipsUnsub) { _chipsUnsub(); _chipsUnsub = null; }
  _chipsUnsub = extraSubnets.renderChipsInto("octoExtraSubnetsChips", ctx.esc, ctx.t);
}

function cardHtml(c) {
  const fallback = ctx.findPrinterModel("octoprint", "0");
  const img = ctx.printerImageUrl(fallback);
  return `
    <div class="snap-scan-card" role="button" tabindex="0" data-ip="${ctx.esc(c.ip)}">
      <span class="snap-scan-card-thumb">${img ? `<img src="${ctx.esc(img)}" alt="" onerror="this.style.opacity='.15'"/>` : ""}</span>
      <span class="snap-scan-card-main">
        <span class="snap-scan-card-title"><span class="snap-scan-card-title-text">OctoPrint</span></span>
        <span class="snap-scan-card-ip">${ctx.esc(c.ip)}</span>
        ${c.version ? `<span class="snap-scan-card-line snap-scan-card-line--model">OctoPrint ${ctx.esc(c.version)}</span>` : ""}
      </span>
      <span class="icon icon-chevron-r icon-14 snap-scan-card-chev"></span>
    </div>`;
}

// The model picked in the choice card (optional) — carried into the settings form.
let _model = null;
function prefillFor(c) {
  return { ip: c.ip, printerName: _model?.name || `OctoPrint ${c.ip}`, modelId: _model?.id || "0", discovery: opDiscoveryRecord(c) };
}
function continueWith(c) {
  if (c.appKeys) openApprove(c);
  else ctx.openPrinterSettings("octoprint", null, prefillFor(c));
}

const _pick = createScanPicker({
  ctx, brand: "octoprint", resultsId: "octoScanResults",
  prefillFor,
  onSingle: c => { abortScan(); closePanel("octoScanOverlay"); continueWith(c); },
  beforeAdd: abortScan,
});

function openPanel(id)  { document.getElementById(id)?.classList.add("open"); }
function closePanel(id) { document.getElementById(id)?.classList.remove("open"); }
function closeAll() {
  abortScan();
  abortApprove();
  ["octoChoiceOverlay", "octoScanOverlay", "octoManualOverlay", "octoApproveOverlay"].forEach(closePanel);
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
  root.id = "octoAddFlowRoot";
  root.innerHTML = `
<div class="modal-overlay" id="octoChoiceOverlay" role="dialog" aria-modal="true">
  <div class="modal-card pba-card">
    <div class="pba-header">
      <div class="pba-header-text">
        <div class="pba-title" data-i18n="octoAddChoiceTitle">Add an OctoPrint printer</div>
        <div class="pba-sub"   data-i18n="snapAddChoiceSub">How do you want to find your printer?</div>
      </div>
      <button class="modal-close" id="octoChoiceClose">✕</button>
    </div>
    <div class="pba-brands">
      ${choice("octoChoiceScan", "snapAddChoiceScan", "Scan network", "snapAddChoiceScanHint", "Auto-discover printers on your LAN")}
      ${choice("octoChoiceManual", "snapAddChoiceManual", "Enter IP address", "snapAddChoiceManualHint", "Manually enter the printer's local IP")}
    </div>
    <div class="pba-models" id="octoChoiceModels"></div>
    <div class="pba-footer">${back("octoChoiceBack")}</div>
  </div>
</div>

<div class="modal-overlay" id="octoScanOverlay" role="dialog" aria-modal="true">
  <div class="modal-card pba-card">
    <div class="pba-header">
      <div class="pba-header-text">
        <div class="pba-title" data-i18n="snapScanTitle">Scanning network…</div>
        <div class="pba-sub" id="octoScanSub"></div>
      </div>
      <button class="modal-close" id="octoScanClose">✕</button>
    </div>
    <div class="snap-scan-body">
      <div class="snap-scan-progress">
        <div class="snap-scan-bar"><span id="octoScanBar"></span></div>
        <div class="snap-scan-stats" id="octoScanStats">0 / 0</div>
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
            <input type="text" class="snap-extra-subnets-input" id="octoExtraSubnetsInput" placeholder="192.168.40" autocomplete="off" autocapitalize="off" spellcheck="false"/>
            <button type="button" class="snap-extra-subnets-add" id="octoExtraSubnetsAdd" data-i18n="snapScanExtraSubnetsAdd">Add</button>
          </div>
          <div class="snap-extra-subnets-chips" id="octoExtraSubnetsChips"></div>
        </div>
      </details>
      <div class="snap-scan-results" id="octoScanResults"></div>
      <div class="snap-scan-empty" id="octoScanEmpty" hidden data-i18n="octoScanEmpty">No OctoPrint found on your network</div>
    </div>
    <div class="pba-footer">
      ${back("octoScanBack")}
      <button class="adf-btn adf-btn--secondary" id="octoScanRestart">
        <span class="icon icon-refresh icon-13"></span><span data-i18n="snapScanRestart">Restart scan</span>
      </button>
    </div>
  </div>
</div>

<div class="modal-overlay" id="octoManualOverlay" role="dialog" aria-modal="true">
  <div class="modal-card pba-card">
    <div class="pba-header">
      <div class="pba-header-text">
        <div class="pba-title" data-i18n="snapManualTitle">Manual add</div>
        <div class="pba-sub"   data-i18n="snapManualSub">Type the printer's local IP — we'll probe it to pre-fill the rest.</div>
      </div>
      <button class="modal-close" id="octoManualClose">✕</button>
    </div>
    <div class="pba-body">
      <div class="pba-field">
        <span class="pba-field-label" data-i18n="printerLblIP">IP address</span>
        <input type="text" id="octoManualIpInput" class="pba-input pba-input--mono" placeholder="192.168.1.50" maxlength="64" spellcheck="false" autocomplete="off" autocapitalize="off"/>
        <div class="pba-error" id="octoManualIpError" hidden></div>
      </div>
    </div>
    <div class="pba-footer">
      ${back("octoManualBack")}
      <button class="adf-btn adf-btn--primary" id="octoManualProbeBtn">
        <span class="icon icon-check icon-13"></span>
        <span class="label" data-i18n="snapManualProbe">Probe + continue</span>
        <span class="spinner"></span>
      </button>
    </div>
  </div>
</div>

<div class="modal-overlay" id="octoApproveOverlay" role="dialog" aria-modal="true">
  <div class="modal-card pba-card">
    <div class="pba-header">
      <div class="pba-header-text">
        <div class="pba-title" data-i18n="octoApproveTitle">Say yes in OctoPrint</div>
        <div class="pba-sub" id="octoApproveSub"></div>
      </div>
      <button class="modal-close" id="octoApproveClose">✕</button>
    </div>
    <div class="pba-body">
      <div class="octo-approve-state" id="octoApproveState"><span class="spinner octo-approve-spin"></span><span id="octoApproveMsg"></span></div>
    </div>
    <div class="pba-footer">
      ${back("octoApproveBack")}
      <button class="adf-btn adf-btn--secondary" id="octoApprovePaste"><span data-i18n="octoApprovePaste">Paste a key instead</span></button>
    </div>
  </div>
</div>`;
  document.body.appendChild(root);
  wireDOM();
  ctx.applyTranslations();
}

function wireDOM() {
  const $ = id => document.getElementById(id);
  for (const id of ["octoChoiceOverlay", "octoScanOverlay", "octoManualOverlay", "octoApproveOverlay"]) {
    $(id)?.addEventListener("click", e => { if (e.target.id === id) closeAll(); });
  }
  $("octoChoiceClose")?.addEventListener("click", closeAll);
  $("octoChoiceBack")?.addEventListener("click", () => { closePanel("octoChoiceOverlay"); ctx.openBrandPicker(); });
  $("octoChoiceScan")?.addEventListener("click", () => { closePanel("octoChoiceOverlay"); openScanPanel(); });
  $("octoChoiceManual")?.addEventListener("click", () => { closePanel("octoChoiceOverlay"); openManualPanel(); });
  $("octoScanClose")?.addEventListener("click", closeAll);
  $("octoScanBack")?.addEventListener("click", () => { abortScan(); closePanel("octoScanOverlay"); openPanel("octoChoiceOverlay"); });
  $("octoScanRestart")?.addEventListener("click", () => { abortScan(); openScanPanel(); });
  $("octoExtraSubnetsAdd")?.addEventListener("click", () => {
    const input = $("octoExtraSubnetsInput");
    if (input && extraSubnets.addPrefix(input.value)) input.value = "";
  });
  $("octoExtraSubnetsInput")?.addEventListener("keydown", e => { if (e.key === "Enter") $("octoExtraSubnetsAdd")?.click(); });
  $("octoManualClose")?.addEventListener("click", closeAll);
  $("octoManualBack")?.addEventListener("click", () => { closePanel("octoManualOverlay"); openPanel("octoChoiceOverlay"); });
  $("octoManualProbeBtn")?.addEventListener("click", handleManualProbe);
  $("octoApproveClose")?.addEventListener("click", closeAll);
  $("octoApproveBack")?.addEventListener("click", () => { abortApprove(); closePanel("octoApproveOverlay"); openPanel("octoChoiceOverlay"); });
  $("octoApprovePaste")?.addEventListener("click", () => {
    const c = _approveFor; abortApprove(); closePanel("octoApproveOverlay");
    if (c) ctx.openPrinterSettings("octoprint", null, prefillFor(c));
  });
  $("octoManualIpInput")?.addEventListener("keydown", e => { if (e.key === "Enter") handleManualProbe(); });
}

function openScanPanel() {
  ensureDOM();
  const $ = id => document.getElementById(id);
  const results = $("octoScanResults"), empty = $("octoScanEmpty"), bar = $("octoScanBar"),
        stats = $("octoScanStats"), sub = $("octoScanSub");
  if (results) results.innerHTML = "";
  _pick.reset();
  if (empty) empty.hidden = true;
  if (bar) bar.style.width = "0%";
  if (sub) sub.textContent = ctx.t("snapScanStarting") || "Starting scan…";
  renderExtraSubnetChips();
  openPanel("octoScanOverlay");
  _scanCtl = new AbortController();
  const signal = _scanCtl.signal;
  let found = 0;
  opScanLan({
    signal,
    getExtraSubnets: () => extraSubnets.loadList(),
    onCandidate(c) {
      found++;
      const wrap = document.createElement("div");
      wrap.innerHTML = cardHtml(c);
      const card = wrap.firstElementChild;
      if (!card) return;
      _pick.attach(card, c);
      $("octoScanResults")?.appendChild(card);
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
  const input = document.getElementById("octoManualIpInput");
  const errEl = document.getElementById("octoManualIpError");
  const btn = document.getElementById("octoManualProbeBtn");
  if (!input) return;
  const ip = input.value.trim();
  if (!ADDR_RX.test(ip)) {
    if (errEl) { errEl.textContent = ctx.t("snapAddByIpInvalid") || "Invalid IP address format"; errEl.hidden = false; }
    input.focus();
    return;
  }
  if (errEl) errEl.hidden = true;
  if (btn) { btn.disabled = true; btn.classList.add("loading"); }
  const c = await opProbeIp(ip);
  if (btn) { btn.disabled = false; btn.classList.remove("loading"); }
  if (c) { closePanel("octoManualOverlay"); continueWith(c); }
  else if (errEl) { errEl.textContent = ctx.t("octoManualNoReply", { ip }); errEl.hidden = false; }
}

function openManualPanel() {
  ensureDOM();
  const input = document.getElementById("octoManualIpInput");
  const errEl = document.getElementById("octoManualIpError");
  if (input) input.value = "";
  if (errEl) errEl.hidden = true;
  openPanel("octoManualOverlay");
  setTimeout(() => input?.focus(), 80);
}

// ── Approve: Application Keys (PROTOCOL.md §2) ─────────────────────────────
let _approveCtl = null, _approveFor = null;
function abortApprove() { if (_approveCtl && !_approveCtl.signal.aborted) _approveCtl.abort(); _approveCtl = null; }

async function openApprove(c) {
  ensureDOM();
  abortApprove();
  _approveFor = c;
  _approveCtl = new AbortController();
  const signal = _approveCtl.signal;
  const sub = document.getElementById("octoApproveSub"), msg = document.getElementById("octoApproveMsg"),
        box = document.getElementById("octoApproveState");
  if (sub) sub.textContent = c.ip;
  if (msg) msg.textContent = ctx.t("octoApproveAsking");
  box?.classList.remove("is-error");
  openPanel("octoApproveOverlay");
  const r = await opRequestApiKey(c.ip, { signal, onPending: () => { if (msg) msg.textContent = ctx.t("octoApproveWaiting"); } });
  if (signal.aborted) return;
  if (r.ok) {
    closePanel("octoApproveOverlay");
    ctx.openPrinterSettings("octoprint", null, { ...prefillFor(c), apiKey: r.apiKey });
    return;
  }
  box?.classList.add("is-error");
  if (msg) msg.textContent = ctx.t(r.error === "denied" ? "octoApproveDenied" : "octoApproveTimeout");
}

let _modelList = null;
export function openOctoAddFlow() {
  ensureDOM();
  // Built on first open (the catalogues are loaded by then), cleared on every open.
  if (!_modelList) _modelList = mountModelList(document.getElementById("octoChoiceModels"), "octoprint", m => { _model = m; });
  _modelList.reset();
  openPanel("octoChoiceOverlay");
}
