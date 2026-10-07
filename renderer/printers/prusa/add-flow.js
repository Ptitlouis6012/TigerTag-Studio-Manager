/**
 * printers/prusa/add-flow.js — Prusa "add printer" UI flow.
 *
 *   1. Choice   — scan the network, or type the IP.
 *   2. Scan     — HTTP sweep of the local /24s (+ the shared extra subnets),
 *                 results tickable like every other brand (scan-pick.js).
 *   3. Manual   — one IP, probed, then the settings form.
 *
 * Either way the user lands on the Printer Settings form, which asks for the
 * PrusaLink password (and, optionally, the Buddy3D camera's address). The scan
 * never sends a credential. Mirrors elegoo/add-flow.js; strings reuse the
 * shared `snap*` keys except the brand title and empty state.
 *
 * Entry point: openPrusaAddFlow() — called from the brand picker.
 */
import { ctx } from '../context.js';
import { createScanPicker } from '../scan-pick.js';
import * as extraSubnets from '../extra-subnets.js';
import { prusaProbeIp, prusaScanLan, prusaBuildDiscoveryRecord } from './probe.js';

const ACCENT = "#fa6831";
const IP_RX = /^\d{1,3}(\.\d{1,3}){3}(:\d{1,5})?$/;   // an optional :port (PrusaLink off port 80)

let _scanCtl = null;
function abortScan() { if (_scanCtl && !_scanCtl.signal.aborted) _scanCtl.abort(); }

let _chipsUnsub = null;
function renderExtraSubnetChips() {
  if (_chipsUnsub) { _chipsUnsub(); _chipsUnsub = null; }
  _chipsUnsub = extraSubnets.renderChipsInto("prusaExtraSubnetsChips", ctx.esc, ctx.t);
}

function cardHtml(c) {
  const fallback = ctx.findPrinterModel("prusa", "0");
  const img = ctx.printerImageUrl(fallback);
  return `
    <div class="snap-scan-card" role="button" tabindex="0" data-ip="${ctx.esc(c.ip)}">
      <span class="snap-scan-card-thumb">${img ? `<img src="${ctx.esc(img)}" alt="" onerror="this.style.opacity='.15'"/>` : ""}</span>
      <span class="snap-scan-card-main">
        <span class="snap-scan-card-title"><span class="snap-scan-card-title-text">Prusa</span></span>
        <span class="snap-scan-card-ip">${ctx.esc(c.ip)}</span>
        ${c.server ? `<span class="snap-scan-card-line snap-scan-card-line--model">${ctx.esc(c.server)}</span>` : ""}
      </span>
      <span class="icon icon-chevron-r icon-14 snap-scan-card-chev"></span>
    </div>`;
}

function prefillFor(c) {
  return { ip: c.ip, printerName: `Prusa ${c.ip}`, modelId: "0", discovery: prusaBuildDiscoveryRecord(c) };
}
function continueWith(c) { ctx.openPrinterSettings("prusa", null, prefillFor(c)); }

const _pick = createScanPicker({
  ctx, brand: "prusa", resultsId: "prusaScanResults",
  prefillFor,
  onSingle: c => { abortScan(); closePanel("prusaScanOverlay"); continueWith(c); },
  beforeAdd: abortScan,
});

function openPanel(id)  { document.getElementById(id)?.classList.add("open"); }
function closePanel(id) { document.getElementById(id)?.classList.remove("open"); }
function closeAll() {
  abortScan();
  ["prusaChoiceOverlay", "prusaScanOverlay", "prusaManualOverlay"].forEach(closePanel);
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
  root.id = "prusaAddFlowRoot";
  root.innerHTML = `
<div class="modal-overlay" id="prusaChoiceOverlay" role="dialog" aria-modal="true">
  <div class="modal-card pba-card">
    <div class="pba-header">
      <div class="pba-header-text">
        <div class="pba-title" data-i18n="prusaAddChoiceTitle">Add a Prusa</div>
        <div class="pba-sub"   data-i18n="snapAddChoiceSub">How do you want to find your printer?</div>
      </div>
      <button class="modal-close" id="prusaChoiceClose">✕</button>
    </div>
    <div class="pba-brands">
      ${choice("prusaChoiceScan", "snapAddChoiceScan", "Scan network", "snapAddChoiceScanHint", "Auto-discover printers on your LAN")}
      ${choice("prusaChoiceManual", "snapAddChoiceManual", "Enter IP address", "snapAddChoiceManualHint", "Manually enter the printer's local IP")}
    </div>
    <div class="pba-footer">${back("prusaChoiceBack")}</div>
  </div>
</div>

<div class="modal-overlay" id="prusaScanOverlay" role="dialog" aria-modal="true">
  <div class="modal-card pba-card">
    <div class="pba-header">
      <div class="pba-header-text">
        <div class="pba-title" data-i18n="snapScanTitle">Scanning network…</div>
        <div class="pba-sub" id="prusaScanSub"></div>
      </div>
      <button class="modal-close" id="prusaScanClose">✕</button>
    </div>
    <div class="snap-scan-body">
      <div class="snap-scan-progress">
        <div class="snap-scan-bar"><span id="prusaScanBar"></span></div>
        <div class="snap-scan-stats" id="prusaScanStats">0 / 0</div>
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
            <input type="text" class="snap-extra-subnets-input" id="prusaExtraSubnetsInput" placeholder="192.168.40" autocomplete="off" autocapitalize="off" spellcheck="false"/>
            <button type="button" class="snap-extra-subnets-add" id="prusaExtraSubnetsAdd" data-i18n="snapScanExtraSubnetsAdd">Add</button>
          </div>
          <div class="snap-extra-subnets-chips" id="prusaExtraSubnetsChips"></div>
        </div>
      </details>
      <div class="snap-scan-results" id="prusaScanResults"></div>
      <div class="snap-scan-empty" id="prusaScanEmpty" hidden data-i18n="prusaScanEmpty">No Prusa found on your network</div>
    </div>
    <div class="pba-footer">
      ${back("prusaScanBack")}
      <button class="adf-btn adf-btn--secondary" id="prusaScanRestart">
        <span class="icon icon-refresh icon-13"></span><span data-i18n="snapScanRestart">Restart scan</span>
      </button>
    </div>
  </div>
</div>

<div class="modal-overlay" id="prusaManualOverlay" role="dialog" aria-modal="true">
  <div class="modal-card pba-card">
    <div class="pba-header">
      <div class="pba-header-text">
        <div class="pba-title" data-i18n="snapManualTitle">Manual add</div>
        <div class="pba-sub"   data-i18n="snapManualSub">Type the printer's local IP — we'll probe it to pre-fill the rest.</div>
      </div>
      <button class="modal-close" id="prusaManualClose">✕</button>
    </div>
    <div class="pba-body">
      <div class="pba-field">
        <span class="pba-field-label" data-i18n="printerLblIP">IP address</span>
        <input type="text" id="prusaManualIpInput" class="pba-input pba-input--mono" placeholder="192.168.1.60" maxlength="15" spellcheck="false" autocomplete="off" autocapitalize="off"/>
        <div class="pba-error" id="prusaManualIpError" hidden></div>
      </div>
    </div>
    <div class="pba-footer">
      ${back("prusaManualBack")}
      <button class="adf-btn adf-btn--primary" id="prusaManualProbeBtn">
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
  for (const id of ["prusaChoiceOverlay", "prusaScanOverlay", "prusaManualOverlay"]) {
    $(id)?.addEventListener("click", e => { if (e.target.id === id) closeAll(); });
  }
  $("prusaChoiceClose")?.addEventListener("click", closeAll);
  $("prusaChoiceBack")?.addEventListener("click", () => { closePanel("prusaChoiceOverlay"); ctx.openBrandPicker(); });
  $("prusaChoiceScan")?.addEventListener("click", () => { closePanel("prusaChoiceOverlay"); openScanPanel(); });
  $("prusaChoiceManual")?.addEventListener("click", () => { closePanel("prusaChoiceOverlay"); openManualPanel(); });
  $("prusaScanClose")?.addEventListener("click", closeAll);
  $("prusaScanBack")?.addEventListener("click", () => { abortScan(); closePanel("prusaScanOverlay"); openPanel("prusaChoiceOverlay"); });
  $("prusaScanRestart")?.addEventListener("click", () => { abortScan(); openScanPanel(); });
  $("prusaExtraSubnetsAdd")?.addEventListener("click", () => {
    const input = $("prusaExtraSubnetsInput");
    if (input && extraSubnets.addPrefix(input.value)) input.value = "";
  });
  $("prusaExtraSubnetsInput")?.addEventListener("keydown", e => { if (e.key === "Enter") $("prusaExtraSubnetsAdd")?.click(); });
  $("prusaManualClose")?.addEventListener("click", closeAll);
  $("prusaManualBack")?.addEventListener("click", () => { closePanel("prusaManualOverlay"); openPanel("prusaChoiceOverlay"); });
  $("prusaManualProbeBtn")?.addEventListener("click", handleManualProbe);
  $("prusaManualIpInput")?.addEventListener("keydown", e => { if (e.key === "Enter") handleManualProbe(); });
}

function openScanPanel() {
  ensureDOM();
  const $ = id => document.getElementById(id);
  const results = $("prusaScanResults"), empty = $("prusaScanEmpty"), bar = $("prusaScanBar"),
        stats = $("prusaScanStats"), sub = $("prusaScanSub");
  if (results) results.innerHTML = "";
  _pick.reset();
  if (empty) empty.hidden = true;
  if (bar) bar.style.width = "0%";
  if (sub) sub.textContent = ctx.t("snapScanStarting") || "Starting scan…";
  renderExtraSubnetChips();
  openPanel("prusaScanOverlay");
  _scanCtl = new AbortController();
  const signal = _scanCtl.signal;
  let found = 0;
  prusaScanLan({
    signal,
    getExtraSubnets: () => extraSubnets.loadList(),
    onCandidate(c) {
      found++;
      const wrap = document.createElement("div");
      wrap.innerHTML = cardHtml(c);
      const card = wrap.firstElementChild;
      if (!card) return;
      _pick.attach(card, c);
      $("prusaScanResults")?.appendChild(card);
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
  const input = document.getElementById("prusaManualIpInput");
  const errEl = document.getElementById("prusaManualIpError");
  const btn = document.getElementById("prusaManualProbeBtn");
  if (!input) return;
  const ip = input.value.trim();
  if (!IP_RX.test(ip)) {
    if (errEl) { errEl.textContent = ctx.t("snapAddByIpInvalid") || "Invalid IP address format"; errEl.hidden = false; }
    input.focus();
    return;
  }
  if (errEl) errEl.hidden = true;
  if (btn) { btn.disabled = true; btn.classList.add("loading"); }
  const c = await prusaProbeIp(ip);
  if (btn) { btn.disabled = false; btn.classList.remove("loading"); }
  if (c) { closePanel("prusaManualOverlay"); continueWith(c); }
  else if (errEl) { errEl.textContent = ctx.t("prusaManualNoReply", { ip }); errEl.hidden = false; }
}

function openManualPanel() {
  ensureDOM();
  const input = document.getElementById("prusaManualIpInput");
  const errEl = document.getElementById("prusaManualIpError");
  if (input) input.value = "";
  if (errEl) errEl.hidden = true;
  openPanel("prusaManualOverlay");
  setTimeout(() => input?.focus(), 80);
}

export function openPrusaAddFlow() {
  ensureDOM();
  openPanel("prusaChoiceOverlay");
}
