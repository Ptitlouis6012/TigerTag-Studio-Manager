/**
 * report/index.js — "Bug or idea?": report something from inside the app, and
 * it lands as a PUBLIC issue on the Studio GitHub repo — no GitHub account
 * needed. The user writes a title + details, attaches screenshots (capture of
 * the window, paste, drop or file), can draw on them, ticks the box saying they
 * know it is public and put nothing private in it, and sends.
 *
 * The backend function `reportIssue` (TigerTag_Firebase_Backend
 * functions/reportIssue.js) checks the ID token, rate-limits, re-encodes and
 * stores the images, opens the issue and answers { number, url }.
 *
 * It is a SIDE CARD on the left (next to the sidebar), not a modal: the app
 * stays usable behind it, so the user can close it, navigate to the next screen,
 * open it again and snap that one too — the draft (text, screenshots, choices)
 * is kept until it is sent.
 *
 * Public API (called by inventory.js):
 *   initReport(ctx)  — ctx = { t, esc, getIdToken, getMeta, openExternal, onToggle }
 *   toggleReport()   — open / close the side card (the draft survives)
 *   isReportOpen()   — is it open?
 */

import { openAnnotator } from "./annotator.js";

const ENDPOINT = "https://us-central1-tigertag-connect.cloudfunctions.net/reportIssue";
const MINE_ENDPOINT = "https://us-central1-tigertag-connect.cloudfunctions.net/myReports";
// Request status (backend `statusOf`) → accent; finished ones are muted.
const STATUS = {
  open:        { key: "reportStatus_open",        c: "#1971c2" },
  in_progress: { key: "reportStatus_in_progress", c: "#f08c00" },
  done:        { key: "reportStatus_done",        c: "#2f9e44" },
  declined:    { key: "reportStatus_declined",    c: "#8a8f9c" },
  cancelled:   { key: "reportStatus_cancelled",   c: "#8a8f9c" },
};
const CLOSABLE = new Set(["open", "in_progress"]);
// What the user is asking for — chosen FIRST, like Zonara's requests. Same ids
// as the backend (`KINDS` in reportIssue.js), which maps each to a GitHub label.
const KINDS = [
  { id: "bug",      icon: "bug",     label: "reportKindBug",      hint: "reportHintBug",      title: "reportTitlePhBug",      body: "reportBodyPhBug" },
  { id: "improve",  icon: "sparkle", label: "reportKindImprove",  hint: "reportHintImprove",  title: "reportTitlePhImprove",  body: "reportBodyPhImprove" },
  { id: "idea",     icon: "bulb",    label: "reportKindIdea",     hint: "reportHintIdea",     title: "reportTitlePhIdea",     body: "reportBodyPhIdea" },
  { id: "question", icon: "info",    label: "reportKindQuestion", hint: "reportHintQuestion", title: "reportTitlePhQuestion", body: "reportBodyPhQuestion" },
  // About the CATALOGUE data, not the app: a wrong barcode, a missing value… —
  // tied to the product it concerns, picked with the catalogue search.
  { id: "catalog",  icon: "tag",     label: "reportKindCatalog",  hint: "reportHintCatalog",  title: "reportTitlePhCatalog",  body: "reportBodyPhCatalog" },
  // A materials brand the catalogue does not have yet: its name + website (to verify it).
  { id: "brand",    icon: "plus-circle", label: "reportKindBrand", hint: "reportHintBrand", title: null, body: "reportBodyPhBrand" },
];
const kindOf = id => KINDS.find(k => k.id === id) || null;
const MAX_IMAGES = 5;          // images + PDFs together
const MAX_PDF_BYTES = 5 * 1024 * 1024;
const MAX_WIDTH = 1920;

let ctx = null;
let st = null;           // draft — kept across close / reopen, reset only after a send
let _overlay = null;     // the side card (<aside>)
let _tab = null;
let _view = "new";       // "new" (kind picker / form) | "mine" (my requests)
let _mine = { list: null, loading: false, error: false };   // last "My requests" fetch
let _closeAsk = null;    // report id whose close is awaiting confirmation         // its tab: "«" closes it; "»" reopens a request in progress

export function initReport(c) { ctx = c; }

const t = (k, p) => ctx.t(k, p);
const esc = s => ctx.esc(String(s == null ? "" : s));

function freshState() {
  return { kind: null, title: "", body: "", images: [], pdfs: [], consent: false, withErrors: false,
           product: null, pq: "", brandName: "", brandSite: "",
           sending: false, error: "", done: null, meta: null };
}

// ── Images ────────────────────────────────────────────────────────────────────
function loadImg(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}
// Any image source → JPEG data URL no wider than MAX_WIDTH (keeps uploads small).
async function normalize(src) {
  const img = await loadImg(src);
  const k = Math.min(1, MAX_WIDTH / img.naturalWidth);
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85);
}
const _attachCount = () => st.images.length + st.pdfs.length;
async function addImage(src) {
  if (!st || _attachCount() >= MAX_IMAGES) { if (st) { st.error = t("reportMaxImages", { n: MAX_IMAGES }); render(); } return; }
  try { st.images.push(await normalize(src)); st.error = ""; } catch (_) { st.error = t("reportImageBad"); }
  render();
}
function addFiles(files) {
  [...(files || [])].forEach(f => {
    if (/^image\//.test(f.type)) { const r = new FileReader(); r.onload = () => addImage(r.result); r.readAsDataURL(f); }
    else if (f.type === "application/pdf") addPdf(f);
  });
}
// A PDF (datasheet, invoice, label…) travels as is — no preview, a named chip.
function addPdf(f) {
  if (_attachCount() >= MAX_IMAGES) { st.error = t("reportMaxImages", { n: MAX_IMAGES }); render(); return; }
  if (f.size > MAX_PDF_BYTES) { st.error = t("reportPdfTooBig", { n: 5 }); render(); return; }
  const r = new FileReader();
  r.onload = () => { st.pdfs.push({ name: f.name, size: f.size, data: r.result }); st.error = ""; render(); };
  r.readAsDataURL(f);
}

// The window as it is right now — without this dialog on top of it.
async function captureWindow() {
  if (!window.electronAPI?.captureWindow) return;
  _overlay.classList.add("rep-hidden"); _tab.classList.add("rep-hidden");
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 120))));
  let shot = null;
  try { shot = await window.electronAPI.captureWindow(); } catch (_) {}
  _overlay.classList.remove("rep-hidden"); _tab.classList.remove("rep-hidden");
  if (!shot) { st.error = t("reportCaptureFail"); render(); return; }
  // Straight into the editor: a capture is almost always taken to point at
  // something on it.
  const before = st.images.length;
  await addImage(shot);
  if (st.images.length > before) annotate(st.images.length - 1);
}

// ── Side card ─────────────────────────────────────────────────────────────────
// Pinned to the sidebar's right edge, which moves when the sidebar collapses or
// expands — followed with a ResizeObserver so the card never overlaps it.
function _pinToSidebar() {
  const sb = document.querySelector(".sidebar");
  const x = sb ? Math.round(sb.getBoundingClientRect().right) : 0;
  _overlay.style.left = `${x}px`;
  // The tab rides the card's right edge when open, the sidebar's edge when closed.
  if (_tab) _tab.style.left = `${x + (isReportOpen() ? _overlay.offsetWidth : 0)}px`;
}
// A request is IN PROGRESS once a topic is picked and until it is sent (or the
// user goes back to the topic list = abandoned). While in progress, closing the
// card leaves its "»" tab on the edge, so it reads as "still there, reopen me" —
// to go and snap another screen, then come back.
const _inProgress = () => !!(st && !st.done && kindOf(st.kind));
function _syncTab() {
  if (!_tab) return;
  const open = isReportOpen();
  _tab.hidden = !(open || _inProgress());
  _tab.innerHTML = open ? "&laquo;" : "&raquo;";
  _tab.classList.toggle("is-parked", !open);
  // The sidebar button stays lit exactly as long as the tab is shown: open, or
  // a request in progress parked on the edge.
  ctx.onToggle?.(open || _inProgress());
  _tab.setAttribute("aria-label", t(open ? "tutoClose" : "reportReopen"));
  _pinToSidebar();
}
function _ensureCard() {
  if (_overlay) return;
  _overlay = document.createElement("aside");
  _overlay.className = "rep-panel";
  _overlay.id = "reportPanel";
  _overlay.setAttribute("aria-labelledby", "repHead");
  _tab = document.createElement("button");
  _tab.type = "button";
  _tab.className = "rep-close-tab";
  _tab.id = "reportCloseTab";
  _tab.innerHTML = "&laquo;";
  _tab.hidden = true;
  _tab.addEventListener("click", toggleReport);
  document.body.appendChild(_tab);      // outside the card: it must stay when the card is closed
  const body = document.createElement("div");
  body.className = "rep-scroll";
  _overlay.appendChild(body);
  document.body.appendChild(_overlay);
  _overlay.addEventListener("click", onClick);
  _overlay.addEventListener("input", onInput);
  _overlay.addEventListener("change", onInput);
  _overlay.addEventListener("dragover", e => { e.preventDefault(); });
  _overlay.addEventListener("drop", e => { e.preventDefault(); e.stopPropagation(); reportDragState(false); addFiles(e.dataTransfer?.files); });
  // The drop overlay (shown while files are dragged over the window).
  const drop = document.createElement("div");
  drop.className = "rep-drop";
  drop.setAttribute("aria-hidden", "true");
  _overlay.appendChild(drop);
  document.addEventListener("paste", onPaste);
  const sb = document.querySelector(".sidebar");
  if (sb && window.ResizeObserver) new ResizeObserver(_pinToSidebar).observe(sb);
  window.addEventListener("resize", _pinToSidebar);
}
const _body = () => _overlay.querySelector(".rep-scroll");

// POST with the Firebase ID token in its own header (Cloud Run inspects a Bearer
// `Authorization` itself); one retry with a fresh token on 401.
async function authedPost(url, body) {
  const payload = JSON.stringify(body);
  const post = async force => {
    const token = await ctx.getIdToken(force);
    if (!token) throw Object.assign(new Error("auth"), { code: "UNAUTHENTICATED" });
    return fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Firebase-Id-Token": token }, body: payload });
  };
  let res = await post(false);
  if (res.status === 401) res = await post(true);
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(j.error || res.status), { code: j.error });
  return j;
}

/** Fetch "My requests" — the backend also syncs each with GitHub and raises a
 *  notification for any status change. Called at sign-in and when the tab opens. */
export async function syncReports() {
  if (!ctx) return null;
  const uid = ctx.getUid?.() || null;
  if (_mine.uid !== uid) _mine = { list: null, loading: false, error: false, uid };   // account switched
  if (!uid || _mine.loading) return _mine.list;
  _mine.loading = true; _mine.error = false;
  if (isReportOpen() && _view === "mine") render();
  try { _mine.list = (await authedPost(MINE_ENDPOINT, { action: "list" })).reports || []; }
  catch (_) { _mine.error = true; }
  _mine.loading = false;
  if (isReportOpen() && _view === "mine") render(); else if (isReportOpen()) render();
  return _mine.list;
}
async function closeMine(id) {
  _closeAsk = null;
  const r = (_mine.list || []).find(x => x.id === id);
  if (r) r.closing = true;
  render();
  try {
    await authedPost(MINE_ENDPOINT, { action: "close", reportId: id });
    if (r) { r.status = "cancelled"; r.closing = false; }
  } catch (_) { if (r) { r.closing = false; r.closeFailed = true; } }
  render();
}

export function isReportOpen() { return !!_overlay?.classList.contains("open"); }
// Files dropped anywhere in the window while the card is open land here — the
// .ttag import stands down meanwhile (inventory.js).
export function reportDropFiles(files) { reportDragState(false); if (isReportOpen() && st && !st.done) addFiles(files); }
// Files are being dragged over the window: the card says "drop here" (a big
// overlay on the card) — otherwise nothing hints that a drop would work.
export function reportDragState(on) {
  if (!_overlay) return;
  _overlay.classList.toggle("rep-dragging", !!on && !!st && !st.done && !!kindOf(st.kind));
}
export function toggleReport() { isReportOpen() ? closeReport() : openReport(); }

export async function openReport(opts = {}) {
  if (!ctx) return;
  if (_mine.uid !== (ctx.getUid?.() || null)) _mine = { list: null, loading: false, error: false, uid: ctx.getUid?.() || null };
  if (opts.tab === "mine") { _view = "mine"; syncReports(); }
  _ensureCard();
  const dz = _overlay.querySelector(".rep-drop");
  dz.innerHTML = `<span class="icon icon-download icon-32"></span><span class="rep-drop-title">${esc(t("reportDropHere"))}</span><span class="rep-drop-sub">${esc(t("reportDropSub", { n: MAX_IMAGES }))}</span>`;
  if (!st || st.done) st = freshState();   // after a send, the next open starts clean
  // Refreshed on every open: the view and the printers may have changed since.
  try { st.meta = await ctx.getMeta(); } catch (_) { st.meta = st.meta || {}; }
  _pinToSidebar();
  render();
  requestAnimationFrame(() => { _overlay.classList.add("open"); _syncTab(); });
  if (st.kind && !st.title && !st.done) setTimeout(() => _overlay.querySelector("#repTitle")?.focus(), 250);
}
function closeReport() {
  if (!_overlay) return;
  _overlay.classList.remove("open");
  _syncTab();
}

function onPaste(e) {
  if (!_overlay?.classList.contains("open") || st?.done) return;
  const files = [...(e.clipboardData?.items || [])].filter(i => i.kind === "file" && (/^image\//.test(i.type) || i.type === "application/pdf")).map(i => i.getAsFile());
  if (!files.length) return;          // plain text → normal paste into the field
  e.preventDefault();
  addFiles(files);
}

function onInput(e) {
  const el = e.target;
  if (el.id === "repTitle") st.title = el.value;
  else if (el.id === "repBody") st.body = el.value;
  else if (el.id === "repConsent") { st.consent = el.checked; syncSend(); }
  else if (el.id === "repErrors") st.withErrors = el.checked;
  else if (el.id === "repFile") { addFiles(el.files); el.value = ""; }
  else if (el.id === "repBrandName") st.brandName = el.value;
  else if (el.id === "repBrandSite") st.brandSite = el.value;
  else if (el.id === "repProdQ") { st.pq = el.value; searchProducts(); }
  if (el.id === "repTitle" || el.id === "repBrandName" || el.id === "repBrandSite") syncSend();
}
const _validSite = u => { try { const x = new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`); return /\./.test(x.hostname); } catch { return false; } };
function canSend() {
  if (st.sending || !kindOf(st.kind) || !st.consent) return false;
  if (st.kind === "brand") return st.brandName.trim().length >= 2 && _validSite(st.brandSite.trim());
  if (st.kind === "catalog" && !st.product) return false;
  return st.title.trim().length >= 3;
}

// ── Catalogue product picker (catalogue corrections) ──
// Only the results list is repainted while typing — the field keeps its focus.
let _pqTimer = null;
function searchProducts() {
  clearTimeout(_pqTimer);
  _pqTimer = setTimeout(async () => {
    const box = _overlay?.querySelector("#repProdResults");
    if (!box) return;
    const q = st.pq.trim();
    if (q.length < 2) { box.innerHTML = ""; return; }
    let hits = [];
    try { hits = await ctx.searchCatalog(q, 8); } catch (_) {}
    if (q !== st.pq.trim()) return;                       // typed on meanwhile
    box.innerHTML = hits.length ? hits.map((p, i) => `
      <button type="button" class="rep-prod" data-rep="pick" data-i="${i}">
        ${p.img ? `<img src="${esc(p.img)}" alt="">` : `<span class="rep-prod-noimg"></span>`}
        <span class="rep-prod-txt"><span class="rep-prod-name">${esc(p.title)}</span><span class="rep-prod-sub">${esc([p.brand, p.material].filter(Boolean).join(" · "))}</span></span>
      </button>`).join("") : `<div class="rep-prod-empty">${esc(t("reportProdNone"))}</div>`;
    box._hits = hits;
  }, 160);
}
function productCardHTML(p) {
  return `
    <div class="rep-prod rep-prod--picked">
      ${p.img ? `<img src="${esc(p.img)}" alt="">` : `<span class="rep-prod-noimg"></span>`}
      <span class="rep-prod-txt"><span class="rep-prod-name">${esc(p.title)}</span><span class="rep-prod-sub">${esc([p.brand, p.material, p.barcode && `EAN ${p.barcode}`].filter(Boolean).join(" · "))}</span></span>
      <button type="button" class="rep-prod-x" data-rep="unpick" aria-label="${esc(t("reportProdChange"))}"><span class="icon icon-close icon-12"></span></button>
    </div>`;
}
function syncSend() { const b = _overlay.querySelector("#repSend"); if (b) b.disabled = !canSend(); }

function onClick(e) {
  const a = e.target.closest("[data-rep]");
  if (!a) return;
  const act = a.dataset.rep;
  if (act === "close") closeReport();
  else if (act === "kind") { st.kind = a.dataset.kind; render(); setTimeout(() => _overlay.querySelector("#repTitle")?.focus(), 50); }
  else if (act === "kindReset") { st.kind = null; render(); }
  // Cancel = the request is dropped: draft cleared, card closed, no parked tab.
  else if (act === "cancel") { const meta = st.meta; st = freshState(); st.meta = meta; render(); closeReport(); }
  else if (act === "capture") captureWindow();
  else if (act === "file") _overlay.querySelector("#repFile")?.click();
  else if (act === "remove") { st.images.splice(Number(a.dataset.i), 1); render(); }
  else if (act === "removePdf") { st.pdfs.splice(Number(a.dataset.i), 1); render(); }
  else if (act === "pick") { const h = _overlay.querySelector("#repProdResults")?._hits?.[Number(a.dataset.i)]; if (h) { st.product = h; render(); setTimeout(() => _overlay.querySelector("#repTitle")?.focus(), 50); } }
  else if (act === "unpick") { st.product = null; render(); setTimeout(() => { _overlay.querySelector("#repProdQ")?.focus(); searchProducts(); }, 50); }
  else if (act === "annotate") annotate(Number(a.dataset.i));
  else if (act === "send") send();
  else if (act === "issue" && st.done?.url) ctx.openExternal(st.done.url);
  else if (act === "coffee") ctx.openCoffee?.();
  else if (act === "view") { _view = a.dataset.view; _closeAsk = null; render(); if (_view === "mine") syncReports(); }
  else if (act === "mineOpen") { const r = (_mine.list || []).find(x => x.id === a.dataset.id); if (r?.url) ctx.openExternal(r.url); }
  else if (act === "mineClose") { _closeAsk = a.dataset.id; render(); setTimeout(() => { if (_closeAsk === a.dataset.id) { _closeAsk = null; render(); } }, 4000); }
  else if (act === "mineCloseYes") closeMine(a.dataset.id);
  else if (act === "again") { const meta = st.meta; st = freshState(); st.meta = meta; render(); }
}

// "Buy me a coffee" — fuel for getting requests done faster. Big on the thank-you
// screen (they just asked for something), small under the kind picker.
function coffeeHTML(big) {
  return `
    <button type="button" class="rep-coffee${big ? " rep-coffee--big" : ""}" data-rep="coffee">
      <img class="rep-coffee-cup" src="../assets/svg/logos/logo_buy_me_coffee.svg" alt="" aria-hidden="true">
      <span class="rep-coffee-txt"><span class="rep-coffee-title">${esc(t("reportCoffeeTitle"))}</span><span class="rep-coffee-sub">${esc(t("reportCoffeeSub"))}</span></span>
      ${big ? `<span class="rep-coffee-cta">${esc(t("reportCoffeeCta"))}</span>` : `<span class="icon icon-chevron-r icon-12 rep-kind-chev"></span>`}
    </button>`;
}

function mineHTML() {
  if (_mine.loading && !_mine.list) return `<div class="rep-mine-empty">${esc(t("reportMineLoading"))}</div>`;
  if (_mine.error && !_mine.list) return `<div class="rep-mine-empty">${esc(t("reportMineError"))}</div>`;
  const list = _mine.list || [];
  if (!list.length) return `<div class="rep-mine-empty">${esc(t("reportMineEmpty"))}</div>`;
  return `<div class="rep-mine">${list.map(r => {
    const k = kindOf(r.kind) || KINDS[0];
    const sdef = STATUS[r.status] || STATUS.open;
    const sub = [r.number ? `#${r.number}` : null, r.createdAt ? ctx.timeAgo(r.createdAt) : null,
                 r.comments ? t("reportMineComments", { n: r.comments }) : null].filter(Boolean).join(" · ");
    const asking = _closeAsk === r.id;
    return `
      <div class="rep-mine-row${CLOSABLE.has(r.status) ? "" : " is-final"}">
        <span class="rep-kind-ico rep-kind--${k.id}"><span class="icon icon-${k.icon} icon-14"></span></span>
        <div class="rep-mine-main">
          <div class="rep-mine-title">${esc(r.title || r.brand?.name || "—")}</div>
          <div class="rep-mine-sub">${esc(sub)}</div>
          ${r.closeFailed ? `<div class="rep-error">${esc(t("reportErrSend"))}</div>` : ""}
        </div>
        <span class="rep-status" style="--sc:${sdef.c}">${esc(t(sdef.key))}</span>
        <div class="rep-mine-acts">
          ${r.url ? `<button type="button" class="rep-mine-btn" data-rep="mineOpen" data-id="${esc(r.id)}" aria-label="${esc(t("reportOpenIssue"))}"><span class="icon icon-github icon-14"></span></button>` : ""}
          ${CLOSABLE.has(r.status) ? (r.closing
            ? `<span class="rep-mine-closing">…</span>`
            : asking
            ? `<button type="button" class="rep-mine-confirm" data-rep="mineCloseYes" data-id="${esc(r.id)}">${esc(t("reportMineCloseConfirm"))}</button>`
            : `<button type="button" class="rep-mine-btn" data-rep="mineClose" data-id="${esc(r.id)}" aria-label="${esc(t("reportMineClose"))}"><span class="icon icon-close icon-12"></span></button>`) : ""}
        </div>
      </div>`;
  }).join("")}</div>
  <div class="rep-hint">${esc(t("reportMineHint"))}</div>`;
}

function metaLine(m) {
  return [m.appVersion && `v${m.appVersion}`, m.os, m.lang, m.printers].filter(Boolean).join(" · ");
}

function render() {
  if (!_overlay) return;
  queueMicrotask(_syncTab);   // topic picked / sent / abandoned → the tab follows
  if (st.done) {
    _body().innerHTML = `
      <div class="rep-card rep-card--done">
        <span class="icon icon-check rep-done-icon"></span>
        <div class="rep-done-title">${esc(t("reportDoneTitle", { n: st.done.number }))}</div>
        <div class="rep-done-sub">${esc(t("reportDoneSub"))}</div>
        <div class="rep-done-actions">
          <button type="button" class="rep-btn rep-btn--primary" data-rep="issue"><span class="icon icon-github icon-14"></span>${esc(t("reportOpenIssue"))}</button>
          <button type="button" class="rep-btn" data-rep="again">${esc(t("reportAnother"))}</button>
        </div>
        ${coffeeHTML(true)}
      </div>`;
    return;
  }
  // Step 1 — what kind of request is it? (or the "My requests" list — shown
  // even with a request in progress: "New request" then goes back to its form)
  if (!kindOf(st.kind) || _view === "mine") {
    const openN = (_mine.list || []).filter(r => CLOSABLE.has(r.status)).length;
    const tabs = `
        <div class="rep-views" role="tablist">
          <button type="button" class="rep-view${_view === "new" ? " is-on" : ""}" data-rep="view" data-view="new" role="tab" aria-selected="${_view === "new"}">${esc(t("reportTabNew"))}</button>
          <button type="button" class="rep-view${_view === "mine" ? " is-on" : ""}" data-rep="view" data-view="mine" role="tab" aria-selected="${_view === "mine"}">${esc(t("reportTabMine"))}${openN ? `<span class="rep-view-count">${openN}</span>` : ""}</button>
        </div>`;
    if (_view === "mine") { _body().innerHTML = `<div class="rep-card">${tabs}${mineHTML()}</div>`; return; }
    _body().innerHTML = `
      <div class="rep-card">
        ${tabs}
        <div class="rep-sub">${esc(t("reportChooseKind"))}</div>
        <div class="rep-kind-list">
          ${KINDS.map(k => `
          <button type="button" class="rep-kind-card rep-kind--${k.id}" data-rep="kind" data-kind="${k.id}">
            <span class="rep-kind-ico"><span class="icon icon-${k.icon} icon-18"></span></span>
            <span class="rep-kind-txt"><span class="rep-kind-name">${esc(t(k.label))}</span><span class="rep-kind-hint">${esc(t(k.hint))}</span></span>
            <span class="icon icon-chevron-r icon-12 rep-kind-chev"></span>
          </button>`).join("")}
        </div>
        ${coffeeHTML(false)}
      </div>`;
    return;
  }
  const kind = kindOf(st.kind);
  const errs = st.meta?.errors || [];
  const shots = st.images.map((src, i) => `
      <div class="rep-shot">
        <button type="button" class="rep-shot-img" data-rep="annotate" data-i="${i}" aria-label="${esc(t("reportAnnotate"))}"><img src="${src}" alt=""><span class="rep-shot-pen"><span class="icon icon-edit icon-12"></span></span></button>
        <button type="button" class="rep-shot-x" data-rep="remove" data-i="${i}" aria-label="${esc(t("reportRemoveImage"))}"><span class="icon icon-close icon-10"></span></button>
      </div>`).join("");
  _body().innerHTML = `
    <div class="rep-card">
      <!-- Back to the kind picker (wrong topic) — what was typed is kept. -->
      <button type="button" class="rep-back" data-rep="kindReset"><span class="icon icon-chevron-l icon-12"></span>${esc(t("reportBack"))}</button>
      <div class="rep-head" id="repHead">${esc(t("reportTitle"))}</div>
      <button type="button" class="rep-kind-chip rep-kind--${kind.id}" data-rep="kindReset" aria-label="${esc(t("reportChangeKind"))}">
        <span class="icon icon-${kind.icon} icon-14"></span><span>${esc(t(kind.label))}</span><span class="rep-kind-change">${esc(t("reportChangeKind"))}</span>
      </button>
      ${kind.id === "catalog" ? `
      <div class="rep-field-label">${esc(t("reportProdLabel"))}</div>
      ${st.product ? productCardHTML(st.product) : `
      <div class="rep-prod-search">
        <span class="icon icon-search icon-14"></span>
        <input id="repProdQ" class="rep-input" type="text" value="${esc(st.pq)}" placeholder="${esc(t("reportProdPh"))}" autocomplete="off">
      </div>
      <div class="rep-prod-results" id="repProdResults"></div>`}` : ""}
      ${kind.id === "brand" ? `
      <input id="repBrandName" class="rep-input" type="text" maxlength="80" value="${esc(st.brandName)}" placeholder="${esc(t("reportBrandNamePh"))}">
      <input id="repBrandSite" class="rep-input" type="url" maxlength="300" value="${esc(st.brandSite)}" placeholder="${esc(t("reportBrandSitePh"))}">` : `
      <input id="repTitle" class="rep-input" type="text" maxlength="200" value="${esc(st.title)}" placeholder="${esc(t(kind.title))}">`}
      <textarea id="repBody" class="rep-input rep-textarea" maxlength="20000" placeholder="${esc(t(kind.body))}">${esc(st.body)}</textarea>
      <div class="rep-attach">
      <div class="rep-field-label">${esc(t("reportAttachLabel"))} <span class="rep-attach-count">${_attachCount()}/${MAX_IMAGES}</span></div>
      <div class="rep-shots">
        ${shots}
        ${st.pdfs.map((f, i) => `
        <div class="rep-shot rep-shot--pdf">
          <span class="rep-pdf"><span class="icon icon-pdf icon-16"></span><span class="rep-pdf-name">${esc(f.name)}</span></span>
          <button type="button" class="rep-shot-x" data-rep="removePdf" data-i="${i}" aria-label="${esc(t("reportRemoveImage"))}"><span class="icon icon-close icon-10"></span></button>
        </div>`).join("")}
        ${_attachCount() < MAX_IMAGES ? `
        <button type="button" class="rep-add" data-rep="capture"><span class="icon icon-camera icon-16"></span><span>${esc(t("reportCapture"))}</span></button>
        <button type="button" class="rep-add" data-rep="file"><span class="icon icon-plus icon-16"></span><span>${esc(t("reportAddImage"))}</span></button>` : ""}
        <input id="repFile" type="file" accept="image/*,application/pdf" multiple hidden>
      </div>
      <div class="rep-hint"><span class="icon icon-download icon-12"></span>${esc(t("reportPasteHint"))}</div>
      </div>
      <div class="rep-meta"><span class="icon icon-info icon-12"></span><span>${esc(t("reportMetaLabel"))} <b>${esc(metaLine(st.meta || {}))}</b></span></div>
      ${errs.length ? `<label class="rep-check"><input type="checkbox" id="repErrors"${st.withErrors ? " checked" : ""}><span>${esc(t("reportAttachErrors", { n: errs.length }))}</span></label>` : ""}
      <label class="rep-check rep-check--public"><input type="checkbox" id="repConsent"${st.consent ? " checked" : ""}><span>${esc(t("reportPublicConsent"))}</span></label>
      ${st.error ? `<div class="rep-error">${esc(st.error)}</div>` : ""}
      <div class="rep-foot">
        <button type="button" class="rep-btn rep-btn--ghost" data-rep="cancel">${esc(t("btnCancel"))}</button>
        <button type="button" class="rep-btn rep-btn--primary" id="repSend" data-rep="send"${canSend() ? "" : " disabled"}>${esc(t(st.sending ? "reportSending" : "reportSend"))}</button>
      </div>
    </div>`;
}

async function send() {
  if (!canSend()) return;
  st.sending = true; st.error = ""; render();
  try {
    // Fresh at send time: the card may have been opened before the printers
    // (or the view) were what they are now.
    try { st.meta = await ctx.getMeta(); } catch (_) {}
    const m = st.meta || {};
    const payload = JSON.stringify({
      kind: st.kind, publicConsent: true,
      title: st.kind === "brand" ? st.brandName.trim() : st.title.trim(), body: st.body.trim(),
      images: st.images,
      pdfs: st.pdfs.map(f => ({ name: f.name, data: f.data })),
      product: st.kind === "catalog" && st.product ? st.product : undefined,
      brand: st.kind === "brand" ? { name: st.brandName.trim(), website: st.brandSite.trim() } : undefined,
      meta: { appVersion: m.appVersion, os: m.os, view: m.view, lang: m.lang, printers: m.printers,
              errors: st.withErrors ? (m.errors || []) : [] },
    });
    // The Firebase ID token travels in its own header, NOT `Authorization`:
    // Cloud Run inspects a Bearer token itself and can answer 401 before the
    // function runs. One retry with a freshly minted token covers an expired one.
    const post = async force => {
      const token = await ctx.getIdToken(force);
      if (!token) throw Object.assign(new Error("auth"), { code: "UNAUTHENTICATED" });
      return fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json", "X-Firebase-Id-Token": token }, body: payload });
    };
    let res = await post(false);
    if (res.status === 401) res = await post(true);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(j.error || res.status), { code: j.error });
    st.done = { number: j.number, url: j.url };
    syncReports();   // the new one shows up in "My requests"
  } catch (e) {
    st.error = t(e.code === "RATE_LIMITED" ? "reportErrLimit" : e.code === "UNAUTHENTICATED" ? "reportNeedLogin" : "reportErrSend");
  }
  st.sending = false;
  render();
}

// ── Annotator ─────────────────────────────────────────────────────────────────
// The editor itself lives in annotator.js; the edited image replaces the shot.
async function annotate(index) {
  const out = await openAnnotator({ src: st.images[index], t, esc });
  if (out && st) { st.images[index] = out; render(); }
}
