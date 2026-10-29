/**
 * rfid_protocol/eraser — the chip eraser card (#chipEraserPanel), the "Erase
 * chips" choice of the new-chip card (rfid_protocol/linked), shown in its pane.
 *
 * While it is open a spool placed on the TigerPOD opens nothing: the scan
 * routing in inventory.js hands every chip here instead (chipEraserOpen()). Each
 * reader's chip is read and classified, and the card offers what can be done
 * with what is there:
 *   • Erase → TigerTag Init  (rfid:format, SDK TigerTag.asInit)
 *   • Recycle → blank NFC    (rfid:erase,  SDK TigerTag.erase)
 * Either is held 1.5 s (the burn banner's look and hold) and writes every erasable chip on the readers
 * at once (one or both chips of a spool). A spool of the inventory whose chip
 * is erased is removed from it, as the spool card's own Erase / Recycle do.
 *
 *   initChipEraser(ctx)                      — t, state, chipBanner, wireChipBanner, …
 *   openChipEraser() / closeChipEraser()
 *   chipEraserOpen()                         — true while the card is up
 *   eraserCardPresent(readerName, uid)       — a chip placed / taken off
 *   eraserForeignChip({ readerName, uid })   — a maker's chip (MIFARE): not erasable
 *   eraserReadersChanged()                   — a reader plugged / unplugged
 */

const ID_TIGERTAG      = 1542820452;  // id_version.json — TIGER_TAG_V1.0
const ID_TIGERTAG_PLUS = 3155151767;  // TIGER_TAG_PLUS_V1.0
const ID_TIGERTAG_INIT = 1816240865;  // TIGER_TAG_INIT
const INIT_HEX = "6c41a2e1";

let ctx = null;
let busy = false;
let lastMode = null;         // "format" | "recycle" | "ndef" — the last write, for the hint line
const writing = new Set();   // readers whose chip is being written right now
// Auto mode — "format" (the Format banner) or "ndef" (the NDEF form's write
// banner), one at a time: every chip placed on the TigerPOD is written straight
// away, no hold — to write a batch. Off on every open.
let autoMode = null;
let autoCount = 0;           // chips written since Auto was turned on
// readerName → { uid, kind, result }
//   kind: reading | tigertag | plus | init | blank | other | maker | unreadable
//   result: undefined | "ok" | "fail"
const slots = new Map();

const $ = id => document.getElementById(id);
const norm = u => String(u || "").replace(/[^0-9a-f]/gi, "").toUpperCase();

export function initChipEraser(c) {
  ctx = c;
  $("chipEraserClose")?.addEventListener("click", closeChipEraser);
}

export function chipEraserOpen() { return !!$("chipEraserPanel")?.classList.contains("open"); }

export function openChipEraser() {
  if (!window.electronAPI?.formatRfidTag) return;
  slots.clear();
  busy = false;
  lastMode = null;
  ndefOpen = false;
  autoMode = null;
  autoCount = 0;
  $("chipEraserPanel")?.classList.add("open");
  renderActions();
  // Chips already lying on the readers count too.
  for (const [readerName, card] of ctx.state.nfcCardPresent) readChip(readerName, card.uid);
  render();
  ctx.syncPanels?.();
}

export function closeChipEraser() {
  if (!chipEraserOpen()) return;
  ctx.hideTip?.();
  $("chipEraserPanel").classList.remove("open");
  slots.clear();
  autoMode = null;
  // What was typed (a Wi-Fi password…) does not outlive the card — except the
  // link and the contact card, kept in localStorage.
  for (const k of Object.keys(ndefValues)) delete ndefValues[k];
  ctx.syncPanels?.();
}

export function eraserCardPresent(readerName, uid) {
  // A chip being written stays put; another reader keeps working (Auto mode).
  if (!chipEraserOpen() || writing.has(readerName)) return;
  if (uid) readChip(readerName, uid);
  else slots.delete(readerName);
  render();
}

export function eraserForeignChip({ readerName, uid }) {
  if (!chipEraserOpen()) return;
  slots.set(readerName, { uid: norm(uid), kind: "maker" });
  render();
}

export function eraserReadersChanged() {
  if (!chipEraserOpen()) return;
  for (const name of [...slots.keys()]) if (!ctx.state.nfcReaders.has(name)) slots.delete(name);
  render();
}

async function readChip(readerName, uid) {
  uid = norm(uid);
  const prev = slots.get(readerName);
  if (prev?.uid === uid && prev.kind !== "unreadable") return;
  slots.set(readerName, { uid, kind: "reading" });
  render();
  let kind = "unreadable";
  try {
    const res = await window.electronAPI.readRfidNow(readerName);
    if (res?.ok) kind = classify(res);
  } catch (_) { /* stays unreadable */ }
  const s = slots.get(readerName);
  // The chip moved meanwhile, or the maker's-chip event already said what it is.
  if (!s || s.uid !== uid || s.kind === "maker") return;
  s.kind = kind;
  // Its NDEF room (144 NTAG213, 496 NTAG215, 872 NTAG216): the form's counter.
  if (ERASABLE.has(kind)) {
    try { s.cap = await window.electronAPI.ndefCapacity(readerName); } catch (_) {}
    if (slots.get(readerName) !== s) return;
  }
  render();
  autoWrite();
}

// The room the NDEF content must fit in: the smallest chip on the readers (the
// TigerTag region when none is there yet).
const ROOM_DEFAULT = 144;
function ndefRoom() {
  const caps = [...slots.values()].filter(s => ERASABLE.has(s.kind) && s.cap).map(s => s.cap);
  return caps.length ? Math.min(...caps) : ROOM_DEFAULT;
}

function classify({ rawPagesHex, tagData }) {
  const hex = String(rawPagesHex || "").toLowerCase();
  const id = Number(tagData?.id_tigertag);
  if (id === ID_TIGERTAG_PLUS) return "plus";
  if (id === ID_TIGERTAG) return "tigertag";
  if (id === ID_TIGERTAG_INIT || hex.startsWith(INIT_HEX)) return "init";
  if (!hex || /^[0f]*$/.test(hex) || /^0300fe0*$/.test(hex)) return "blank";
  return "other";
}

// Both actions write onto every NTAG on the readers, whatever it holds — even
// one already in that state: the user decides.
const ERASABLE = new Set(["tigertag", "plus", "init", "blank", "other"]);
function targetsFor() {
  return [...slots].filter(([, s]) => ERASABLE.has(s.kind))
    .map(([readerName, s]) => ({ readerName, uid: s.uid }));
}

// The inventory spool a chip belongs to (by its own UID or as a twin).
function spoolOf(uid) {
  return (ctx.state.rows || []).find(r => !r.deleted && !r.isFriend
    && (norm(r.uid) === uid || norm(r.twinUid) === uid)) || null;
}

function render() {
  const el = $("chipEraserPanel");
  if (!el?.classList.contains("open")) return;
  const { t } = ctx;
  const readers = [...ctx.state.nfcReaders];
  // The numbered dot shows with ONE reader too, coloured by state like a pair's.
  const showNums = readers.length > 0;
  $("chipEraserChips").innerHTML = (readers.length ? readers : ["__none__"]).map((name, i) => {
    const s = slots.get(name);
    const st = !s ? "waiting" : s.result === "ok" ? "ok" : s.result === "fail" ? "fail"
      : s.kind === "reading" || writing.has(name) ? "writing" : s.autoSkip || !ERASABLE.has(s.kind) ? "mismatch" : "ready";
    // The plate's colour says it all (waiting · reading · ready · done · failed ·
    // red for a chip it cannot write); what the chip holds is not shown.
    return `<div class="cer-slot">
      <div class="cem-chip cem-chip--${st}">
        ${showNums ? `<span class="cem-chip-num">${i + 1}</span>` : ""}
        <div class="cem-chip-logo"></div>
      </div>
    </div>`;
  }).join("");

  // One short line under the readers, only after a write (or with no reader).
  const hint = $("chipEraserHint");
  const failed = [...slots.values()].some(s => s.result === "fail");
  const erased = [...slots.values()].some(s => s.result === "ok");
  const ndefAuto = autoMode === "ndef" && ndefOpen;
  const skipped = !!autoMode && [...slots.values()].some(s => s.autoSkip);
  const problem = ndefAuto ? ndefProblem() : null;
  hint.textContent = readers.length === 0 ? t("encNoReader")
    : failed ? t("chipEraserFailed")
    : problem ? problem
    : skipped ? t("nfcAutoSkipSpool")
    : autoMode ? ""
    : erased ? t(lastMode === "ndef" ? "nfcNdefDone" : "chipEraserDone")
    : "";
  hint.classList.toggle("cer-hint--fail", failed || !!problem || skipped);
  paintCounter();
  // Each Auto count sits under its own banner.
  const nCount = $("nfcAutoCount"), fCount = $("fmtAutoCount");
  if (nCount) nCount.textContent = ndefAuto ? t("nfcAutoCount", { n: autoCount }) : "";
  if (fCount) fCount.textContent = autoMode === "format" ? t("nfcAutoCount", { n: autoCount }) : "";
}


// The actions: the shining chip banners of the spool cards (_chipBannerHTML,
// held 1.5 s like the burn), so every button that writes through the TigerPOD
// looks and works the same — orange to format, green to write NDEF content, red
// to reset to NDEF. Built
// on each open, in the current language. With nothing writable on the readers a
// press shows the red TigerPOD bubble instead of starting the hold
// (_wireChipBanner); `ready` may also return the message saying what is missing.
function renderActions() {
  const { t } = ctx;
  const box = $("chipEraserActions");
  if (!box) return;
  box.innerHTML =
    ctx.chipBanner("chipEraserInit", t("chipEraserToInit"), t("chipEraserToInitTip"), { update: true, holdTip: "chipEraserToInitTip" }) +
    // Click-only: unfolds the NDEF form below; it stops shining while open.
    ctx.chipBanner("nfcNdefBanner", t("nfcWriteNdef"), t("nfcWriteNdefTip"), { hold: false, logo: "nfc", active: ndefOpen });
  const chipsReady = () => !busy && targetsFor().length > 0 && ![...slots.values()].some(s => s.kind === "reading");
  ctx.wireChipBanner($("chipEraserInit"), () => run("format"), chipsReady);
  addAutoSwitch($("chipEraserInit"), "format");
  $("nfcNdefBanner").addEventListener("click", e => {
    if (e.target.closest(".tool-info")) return;
    ndefOpen = !ndefOpen;
    if (ndefOpen) ndefType = "url";   // the form always opens on a link
    $("nfcNdefBanner").classList.toggle("is-active", ndefOpen);
    renderForm();
  });
  wireInfo(box);
  renderForm();
}

// ⓘ: the shared hover bubble, as everywhere.
function wireInfo(root) {
  for (const i of root.querySelectorAll(".tool-info")) {
    i.addEventListener("mouseenter", () => ctx.showTip?.(i));
    i.addEventListener("mouseleave", () => ctx.hideTip?.());
  }
}

// ── NDEF content (services/ndef.js encodes it in main) ──────────────────────
// Each type: its icon and fields [name, placeholder key, input kind]. The first
// field is the one that must be filled.
const NDEF_TYPES = [
  { type: "url",     icon: "link",       label: "nfcTypeUrl",     fields: [["url", "nfcPhUrl", "url"]] },
  { type: "wifi",    icon: "wifi",       label: "nfcTypeWifi",    fields: [["ssid", "nfcPhSsid"], ["password", "nfcPhPassword", "password"], ["auth", null, "auth"]] },
  { type: "contact", icon: "user",       label: "nfcTypeContact", fields: [["name", "nfcPhName"], ["phone", "nfcPhPhone", "tel"], ["email", "nfcPhEmail", "email"], ["org", "nfcPhOrg"], ["url", "nfcPhWebsite", "url"]] },
  { type: "email",   icon: "mail",       label: "nfcTypeEmail",   fields: [["to", "nfcPhEmail", "email"], ["subject", "nfcPhSubject"], ["body", "nfcPhMessage", "textarea"]] },
  { type: "phone",   icon: "mobile-app", label: "nfcTypePhone",   fields: [["number", "nfcPhPhone", "tel"]] },
  { type: "sms",     icon: "chat",       label: "nfcTypeSms",     fields: [["number", "nfcPhPhone", "tel"], ["body", "nfcPhMessage", "textarea"]] },
  // Not content: the chip back to a blank NDEF tag (rfid:erase) — written by the
  // red "Recycle to NDEF" banner instead of the green one.
  { type: "blank",   icon: "eraser",     label: "nfcTypeBlank",   fields: [] },
];
let ndefOpen = false;
let ndefType = "url";
const ndefValues = {};       // `${type}.${field}` → text, cleared when the card closes
let ndefSize = null;         // bytes the content takes, as typed
// The last link written to a chip, offered again next time (this computer only;
// only the link — never a Wi-Fi password or a contact).
const LAST_URL_KEY = "tigertag.nfc.lastUrl";
const lastUrl = () => { try { return localStorage.getItem(LAST_URL_KEY) || ""; } catch (_) { return ""; } };
// The contact card as last typed, kept on this computer so it is there next time.
const CONTACT_KEY = "tigertag.nfc.contact";
const CONTACT_FIELDS = ["name", "phone", "email", "org", "url"];
function loadContact() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(CONTACT_KEY) || "{}") || {}; } catch (_) {}
  for (const f of CONTACT_FIELDS) if (ndefValues[`contact.${f}`] == null) ndefValues[`contact.${f}`] = String(saved[f] || "");
}
function saveContact() {
  const c = Object.fromEntries(CONTACT_FIELDS.map(f => [f, ndefValues[`contact.${f}`] || ""]));
  try { localStorage.setItem(CONTACT_KEY, JSON.stringify(c)); } catch (_) {}
}

// Links (the Link type, a contact's website) — any scheme, not only the web: a
// camera or data stream (rtsp://, rtmp://, ws://, mqtt://…), a share (smb://,
// ftp://), an app link (spotify:…). Without a scheme, "tigersystem.io" is taken
// as https://tigersystem.io and a bare local address (192.168.0.1, localhost) as
// http://. A "scheme://" link needs a real host — a domain (a dot, a 2+ letter
// TLD), an IPv4 / IPv6 address, localhost or a .local name — checked as TYPED
// (the browser's parser would complete "1.2.3" into the IP 1.2.0.3); a login,
// a port and a path are fine. No space anywhere, and never a scheme that runs
// or reads something on the phone (javascript:, data:, file:, vbscript:).
const LOCAL_HOST = /^(localhost|(\d{1,3}\.){3}\d{1,3}|\[[0-9a-f:.]+\])(:\d+)?([/?#]|$)/i;
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const BLOCKED_SCHEMES = new Set(["javascript", "data", "file", "vbscript", "about", "blob"]);
const normUrl = v => {
  v = String(v || "").trim();
  if (!v || /^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return v;
  // "scheme:rest" (spotify:track:…) is a link already; "host:port" is not.
  const m = v.match(SCHEME);
  if (m && !/^\d+([/?#]|$)/.test(v.slice(m[0].length)) && !LOCAL_HOST.test(v)) return v;
  return `${LOCAL_HOST.test(v) ? "http" : "https"}://${v}`;
};
function validHost(h) {
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(h)) return h.split(".").every(n => Number(n) <= 255);
  if (/^\[[0-9a-f:.]+\]$/i.test(h) || h === "localhost") return true;
  const labels = h.split(".");
  if (labels.some(l => !/^[\p{L}\p{N}-]+$/u.test(l) || l.startsWith("-") || l.endsWith("-"))) return false;
  if (labels.every(l => /^\d+$/.test(l))) return false;   // "1.2.3": not a full IPv4
  const tld = labels.at(-1);
  return labels.length > 1 && (/^\p{L}{2,}$/u.test(tld) || /^xn--[a-z0-9-]+$/.test(tld) || tld === "local");
}
function validUrl(v) {
  const n = normUrl(v);
  if (!n || /\s/.test(n)) return false;
  const scheme = (n.match(SCHEME) || [])[1]?.toLowerCase();
  if (!scheme || BLOCKED_SCHEMES.has(scheme)) return false;
  const rest = n.slice(scheme.length + 1);
  if (!rest.startsWith("//")) return rest.length > 0;          // spotify:track:…
  // The host as typed: after "//" and any login, before the path, without the port.
  const authority = rest.slice(2).split(/[/?#]/)[0].split("@").pop();
  const host = authority.startsWith("[") ? authority.replace(/\](:\d+)?$/, "]") : authority.replace(/:\d+$/, "");
  const port = authority.match(/:(\d+)$/)?.[1];
  if (port && Number(port) > 65535) return false;
  return validHost(host.toLowerCase());
}
// The fields holding a link, per type.
const URL_FIELDS = { url: ["url"], contact: ["url"] };

function ndefMessage() {
  const def = NDEF_TYPES.find(d => d.type === ndefType);
  const m = { type: ndefType };
  for (const [name] of def.fields) m[name] = ndefValues[`${ndefType}.${name}`] ?? (name === "auth" ? "wpa2" : "");
  for (const f of URL_FIELDS[ndefType] || []) m[f] = normUrl(m[f]);
  return m;
}

// What keeps the content from being written, as the message to show; null if none.
function ndefProblem() {
  const { t } = ctx;
  const def = NDEF_TYPES.find(d => d.type === ndefType);
  const m = ndefMessage();
  if (!def.fields.length) return null;
  if (!String(m[def.fields[0][0]] || "").trim()) return t("nfcNdefEmpty");
  if (ndefType === "wifi" && m.auth !== "open" && !m.password) return t("nfcNdefEmpty");
  if ((URL_FIELDS[ndefType] || []).some(f => m[f] && !validUrl(m[f]))) return t("nfcNdefBadUrl");
  if (ndefSize != null && ndefSize > ndefRoom()) return t("nfcNdefTooLong", { size: ndefSize, max: ndefRoom() });
  return null;
}

function renderForm() {
  const { t, esc } = ctx;
  const box = $("nfcNdefForm");
  if (!box) return;
  box.hidden = !ndefOpen;
  if (!ndefOpen) { box.innerHTML = ""; return; }
  const def = NDEF_TYPES.find(d => d.type === ndefType);
  const blank = ndefType === "blank";
  if (ndefValues["url.url"] == null) ndefValues["url.url"] = lastUrl();
  loadContact();
  const field = ([name, ph, kind]) => {
    const key = `${ndefType}.${name}`;
    const v = esc(ndefValues[key] ?? "");
    if (kind === "auth") {
      const cur = ndefValues[key] || "wpa2";
      return `<div class="nfc-auth" role="radiogroup">${[["wpa2", "WPA2"], ["wpa", "WPA"], ["open", t("nfcAuthOpen")]].map(([id, lbl]) =>
        `<button type="button" class="nfc-auth-opt${cur === id ? " is-selected" : ""}" data-nfc-auth="${id}" role="radio" aria-checked="${cur === id}">${esc(lbl)}</button>`).join("")}</div>`;
    }
    if (kind === "textarea") return `<textarea class="nfc-input" data-nfc-field="${name}" rows="2" placeholder="${esc(t(ph))}">${v}</textarea>`;
    return `<input class="nfc-input" data-nfc-field="${name}" type="${kind || "text"}" placeholder="${esc(t(ph))}" value="${v}" autocomplete="off" spellcheck="false">`;
  };
  box.innerHTML = `
    <div class="nfc-types" role="tablist">${NDEF_TYPES.map(d =>
      `<button type="button" class="nfc-type${d.type === ndefType ? " is-selected" : ""}" data-nfc-type="${d.type}" role="tab" aria-selected="${d.type === ndefType}" aria-label="${esc(t(d.label))}" data-tip="${esc(t(d.label))}">
        <span class="icon icon-${d.icon} icon-24" aria-hidden="true"></span></button>`).join("")}</div>
    ${def.fields.length ? `<div class="nfc-fields">${def.fields.map(field).join("")}</div>` : ""}
    ${def.fields.length ? `<div class="nfc-size" id="nfcNdefSize"></div>` : ""}
    ${blank
      ? ctx.chipBanner("nfcNdefWrite", t("chipEraserToNdef"), t("chipEraserToNdefTip"), { danger: true, holdTip: "chipEraserToNdefTip", logo: "nfc" })
      : ctx.chipBanner("nfcNdefWrite", t("nfcWriteToChip"), t("nfcWriteToChipTip"), { holdTip: "nfcWriteToChipTip", logo: "nfc" })}
    <div class="nfc-auto-count" id="nfcAutoCount"></div>`;
  box.querySelectorAll("[data-nfc-type]").forEach(b => {
    b.addEventListener("click", () => { ndefType = b.dataset.nfcType; ctx.hideTip?.(); renderForm(); });
    b.addEventListener("mouseenter", () => ctx.showTip?.(b));
    b.addEventListener("mouseleave", () => ctx.hideTip?.());
  });
  box.querySelectorAll("[data-nfc-auth]").forEach(b => b.addEventListener("click", () => {
    ndefValues[`${ndefType}.auth`] = b.dataset.nfcAuth;
    renderForm();
  }));
  box.querySelectorAll("[data-nfc-field]").forEach(inp => inp.addEventListener("input", () => {
    ndefValues[`${ndefType}.${inp.dataset.nfcField}`] = inp.value;
    if (ndefType === "contact") saveContact();
    markUrl(inp);
    measure();
  }));
  addAutoSwitch($("nfcNdefWrite"), "ndef");
  // Chips first (the red TigerPOD bubble), then what the form is missing.
  ctx.wireChipBanner($("nfcNdefWrite"), () => run(blank ? "recycle" : "ndef"), () => {
    if (busy || !targetsFor().length || [...slots.values()].some(s => s.kind === "reading")) return false;
    return ndefProblem() || true;
  });
  box.querySelectorAll("[data-nfc-field]").forEach(markUrl);
  wireInfo(box);
  if (!blank) measure();
  render();   // the Auto count, in the freshly built form
}

// A link field framed red while what is typed is not a valid link.
function markUrl(inp) {
  if (!(URL_FIELDS[ndefType] || []).includes(inp.dataset.nfcField)) return;
  const bad = !!inp.value.trim() && !validUrl(inp.value);
  inp.classList.toggle("is-invalid", bad);
  inp.setAttribute("aria-invalid", String(bad));
}

// Live "bytes used / room on the chip", red when it does not fit.
let measureSeq = 0;
async function measure() {
  const seq = ++measureSeq;
  let r = null;
  try { r = await window.electronAPI.ndefSize(ndefMessage()); } catch (_) {}
  if (seq !== measureSeq) return;
  ndefSize = r?.ok ? r.size : null;
  if (autoMode) render(); else paintCounter();
}
// "bytes / room", red when it does not fit — the room follows the chips placed.
function paintCounter() {
  const el = $("nfcNdefSize");
  if (!el) return;
  const room = ndefRoom();
  el.textContent = ndefSize != null ? `${ndefSize} / ${room}` : "";
  el.classList.toggle("is-over", ndefSize != null && ndefSize > room);
}

async function run(mode, only = null) {
  const targets = only || targetsFor();
  if (busy || !targets.length) return;
  busy = true;
  lastMode = mode;
  targets.forEach(x => writing.add(x.readerName));
  // Auto mode: the write banner burns on its own for each chip, as if held.
  const fx = only ? burnFx($(mode === "format" ? "chipEraserInit" : "nfcNdefWrite")) : null;
  targets.forEach(x => { const s = slots.get(x.readerName); if (s) delete s.result; });
  render();
  // The spools these chips belong to, looked up before the chips change.
  const spools = new Map();
  for (const x of targets) { const r = spoolOf(x.uid); if (r) spools.set(r.spoolId, r); }
  let res;
  try {
    res = mode === "format" ? await window.electronAPI.formatRfidTag({ targets })
      : mode === "ndef" ? await window.electronAPI.writeNdefTag({ targets, message: ndefMessage() })
      : await window.electronAPI.eraseRfidTag({ targets });
  } catch (_) { res = { results: [] }; }
  const byReader = new Map((res?.results || []).map(x => [x.readerName, x]));
  const done = [];
  for (const x of targets) {
    const r = byReader.get(x.readerName);
    const ok = !!(r && r.ok && r.verified);
    const s = slots.get(x.readerName);
    if (s) { s.result = ok ? "ok" : "fail"; if (ok) s.kind = mode === "format" ? "init" : mode === "ndef" ? "other" : "blank"; }
    if (ok) done.push(x.uid);
  }
  busy = false;
  targets.forEach(x => writing.delete(x.readerName));
  fx?.(done.length === targets.length);
  if (only) {
    // Auto mode: each placement is written once (a failure waits for the chip
    // to be placed again).
    for (const x of targets) { const s = slots.get(x.readerName); if (s) s.autoDone = true; }
    autoCount += done.length;
  }
  render();
  if (done.length) {
    if (mode !== "ndef") ctx.onErased?.(mode, done);
    if (mode === "ndef" && ndefType === "url") {
      try { localStorage.setItem(LAST_URL_KEY, String(ndefValues["url.url"] || "").trim()); } catch (_) {}
    }
    // A spool goes only once every chip of it that was on the readers is erased.
    for (const r of spools.values()) {
      const own = [r.uid, r.twinUid].filter(Boolean).map(norm);
      const onReaders = own.filter(u => targets.some(x => x.uid === u));
      if (onReaders.every(u => done.includes(u))) {
        try { await ctx.removeSpool(r.spoolId); } catch (e) { ctx.reportError?.("chipEraser.removeSpool", e); }
      }
    }
    if (!only) ctx.toast?.(ctx.t(mode === "ndef" ? "nfcNdefDone" : "chipEraserDone"));
  }
  ctx.beep?.(done.length === targets.length);
  autoWrite();   // a chip placed on the other reader meanwhile
}

// The held banner's burn, played without a hold: the fill runs while the chip
// is written, then flashes full (or drains on a failure). Returns the finisher.
function burnFx(el) {
  const fill = el?.querySelector(".hold-progress");
  if (!el || !fill) return null;
  el.classList.remove("is-confirming");
  el.classList.add("is-holding");
  fill.style.transition = "width 0s"; fill.style.width = "0%";
  void fill.offsetWidth;
  fill.style.transition = "width 1.2s cubic-bezier(.2,.6,.4,1)"; fill.style.width = "90%";
  return ok => {
    el.classList.remove("is-holding");
    fill.style.transition = ok ? "width .15s ease-out" : "width .3s ease-in";
    fill.style.width = ok ? "100%" : "0%";
    if (ok) el.classList.add("is-confirming");
    setTimeout(() => {
      el.classList.remove("is-confirming");
      fill.style.transition = "width .25s ease-out"; fill.style.width = "0%";
    }, 650);
  };
}

// Auto mode: write every chip on the readers not yet written in this placement,
// with the form's content (or the NDEF reset). A spool of the inventory is
// never written by Auto — its chip goes red and waits for the held banner.
function autoWrite() {
  const off = !autoMode || busy || !chipEraserOpen()
    || (autoMode === "ndef" && (!ndefOpen || ndefProblem()));
  if (off) { render(); return; }
  const todo = [];
  for (const [readerName, s] of slots) {
    if (!ERASABLE.has(s.kind) || s.autoDone || s.autoSkip) continue;
    if (spoolOf(s.uid)) { s.autoSkip = true; continue; }
    todo.push({ readerName, uid: s.uid });
  }
  render();
  if (todo.length) run(autoMode === "format" ? "format" : ndefType === "blank" ? "recycle" : "ndef", todo);
}

// The Auto switch, inside a held banner before its ⓘ. Pressing it never starts
// the hold (data-no-hold, and the press stops at the switch). Turning one on
// turns the other off.
function addAutoSwitch(banner, mode) {
  const { t, esc } = ctx;
  if (!banner) return;
  banner.querySelector(".tool-info")?.insertAdjacentHTML("beforebegin", `
    <label class="nfc-auto" data-no-hold data-tip="${esc(t(mode === "format" ? "fmtAutoTip" : "nfcAutoTip"))}">
      <span class="nfc-auto-label">${esc(t("nfcAuto"))}</span>
      <span class="eac-toggle"><input type="checkbox" data-auto-mode="${mode}"${autoMode === mode ? " checked" : ""}><span class="eac-toggle-track"><span class="eac-toggle-thumb"></span></span></span>
    </label>`);
  const lbl = banner.querySelector(".nfc-auto");
  lbl.addEventListener("pointerdown", e => e.stopPropagation());
  lbl.addEventListener("mouseenter", () => ctx.showTip?.(lbl));
  lbl.addEventListener("mouseleave", () => ctx.hideTip?.());
  banner.classList.toggle("is-auto", autoMode === mode);
  lbl.querySelector("input").addEventListener("change", e => {
    autoMode = e.target.checked ? mode : null;
    autoCount = 0;
    document.querySelectorAll("#chipEraserPanel [data-auto-mode]").forEach(i => {
      i.checked = i.dataset.autoMode === autoMode;
      i.closest(".cloud-encode-banner")?.classList.toggle("is-auto", i.checked);
    });
    for (const sl of slots.values()) { delete sl.autoDone; delete sl.autoSkip; }
    autoWrite();
  });
}
