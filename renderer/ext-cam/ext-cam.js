/**
 * ext-cam/ext-cam.js — External IP cameras. A camera here is NOT a printer: it
 * has no connection, no job, no model — it only shows its picture.
 *
 *   • Storage  — Firestore `users/{uid}/cameras/{id}` (owner-only, like the rest
 *                of `users/{uid}/**`): { name, protocol, url, username, password }.
 *   • Add/edit — one side card (`#xcOverlay`), opened from the brand picker's
 *                "External cameras" row or from a camera's gear on the wall.
 *   • Display  — a section under the camera wall (`mountExtCamSection`).
 *   • Streams  — three readers, picked by `protocol`:
 *       mjpeg  → the shared mux (`cam_manager.js`); with a login → ffmpeg in main
 *       rtsp   → ffmpeg in main (`extcam:*` IPC, JPEG frames back)
 *       webrtc → WHEP in the renderer (POST an SDP offer, read the SDP answer)
 *
 * The login is stored in the camera's document and read back only to start the
 * stream; it is never rendered into the page, a title or a log line.
 *
 * Entry points (called by inventory.js): initExtCam, extCamSubscribe,
 * extCamUnsubscribe, openExtCamAddFlow, mountExtCamSection.
 */
import { ctx } from "../printers/context.js";
import { camStart, camStop, camSubscribe, camUnsubscribe } from "../printers/cam_manager.js";

const PROTOCOLS = ["rtsp", "mjpeg", "webrtc"];
const PLACEHOLDER = {
  rtsp:   "rtsp://192.168.1.50:554/stream1",
  mjpeg:  "http://192.168.1.50:8080/video",
  webrtc: "http://192.168.1.50:1984/api/webrtc?src=camera",
};
const SCHEMES = { rtsp: /^rtsps?:$/, mjpeg: /^https?:$/, webrtc: /^https?:$/ };

let _api = { db: null, uid: () => null, onChange: () => {} };
let _cams = [];
let _unsub = null;

export function initExtCam(api) { _api = { ..._api, ...api }; }

// ── Storage ──────────────────────────────────────────────────────────────────
const colRef = () => {
  const uid = _api.uid();
  return uid ? _api.db(uid).collection("users").doc(uid).collection("cameras") : null;
};

export function extCamSubscribe(uid) {
  extCamUnsubscribe();
  const col = colRef();
  if (!col) return;
  _unsub = col.onSnapshot(snap => {
    if (uid !== _api.uid()) return;
    _cams = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    _api.onChange();
  }, err => console.warn("[ext-cam]", err.code, err.message));
}

export function extCamUnsubscribe() {
  if (_unsub) { try { _unsub(); } catch (_) {} _unsub = null; }
  releaseAll();
  _cams = [];
}

// ── Readers ──────────────────────────────────────────────────────────────────
// key → { kind: "mux" | "ff" | "rtc", els: Set<HTMLElement>, pc?, last?, retry? }
const _run = new Map();
let _sweeper = 0;
const camKey = id => `ext:${id}`;

function setState(el, state) {
  const card = el.closest(".xc-card");
  if (card) card.dataset.state = state;
}

function ensureSweeper() {
  if (_sweeper) return;
  // A card that left the page (view change, rebuild) takes its stream with it.
  _sweeper = setInterval(() => {
    for (const [key, r] of _run) {
      r.els.forEach(el => { if (!el.isConnected) r.els.delete(el); });
      if (!r.els.size) stopKey(key);
    }
    if (!_run.size) { clearInterval(_sweeper); _sweeper = 0; }
  }, 4000);
}

function stopKey(key) {
  const r = _run.get(key);
  if (!r) return;
  _run.delete(key);
  clearTimeout(r.retry);
  if (r.kind === "mux") { r.els.forEach(el => camUnsubscribe(key, el)); camStop(key); }
  if (r.kind === "ff")  { try { window.extCam?.stop(key); } catch (_) {} if (r.last) URL.revokeObjectURL(r.last); if (r.next) URL.revokeObjectURL(r.next); }
  if (r.kind === "rtc") { try { r.pc?.close(); } catch (_) {} r.els.forEach(el => { el.srcObject = null; }); }
}

export function releaseAll() { [..._run.keys()].forEach(stopKey); }

let _ffWired = false;
function wireFfmpegFeed() {
  if (_ffWired || !window.extCam) return;
  _ffWired = true;
  window.extCam.onFrame((key, buf) => {
    const r = _run.get(key);
    if (!r || r.kind !== "ff") return;
    const url = URL.createObjectURL(new Blob([buf], { type: "image/jpeg" }));
    // A frame still waiting is already out of date: the newest one replaces it.
    if (r.next) URL.revokeObjectURL(r.next);
    r.next = url;
    if (!r.decoding) paintNext(key, r);
  });
  window.extCam.onStatus((key, status) => {
    const r = _run.get(key);
    if (r) r.els.forEach(el => setState(el, status === "live" ? "live" : "error"));
  });
}

/* ONE DECODE AT A TIME. Pointing the <img> at each frame the moment it arrives
   cancels the decode of the one before it, and a network burst (several frames
   within a few ms) then shows only the last — a camera sending 10 pictures a
   second was drawn at 7. The frame is decoded off to the side first, then put on
   screen already decoded; the one waiting behind it is always the newest. */
function paintNext(key, r) {
  const url = r.next;
  r.next = null;
  r.decoding = true;
  const probe = new Image();
  probe.src = url;
  const done = () => {
    r.decoding = false;
    if (_run.get(key) !== r) { URL.revokeObjectURL(url); return; }   // stopped meanwhile
    r.els.forEach(el => { if (el.isConnected) el.src = url; else r.els.delete(el); });
    if (r.last) URL.revokeObjectURL(r.last);
    r.last = url;
    if (r.next) paintNext(key, r);
  };
  probe.decode().then(done, done);
}

const basicAuth = cam => cam.username
  ? { Authorization: "Basic " + btoa(unescape(encodeURIComponent(`${cam.username}:${cam.password || ""}`))) } : {};

/** WHEP: one offer, one answer. Resolves once the browser has the answer set. */
async function whepConnect(cam, video) {
  const pc = new RTCPeerConnection();
  pc.addTransceiver("video", { direction: "recvonly" });
  pc.ontrack = e => { video.srcObject = e.streams[0]; video.play().catch(() => {}); };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  // The offer is sent whole: wait for local candidates, but never for long.
  await new Promise(res => {
    if (pc.iceGatheringState === "complete") return res();
    const done = () => { if (pc.iceGatheringState === "complete") { pc.removeEventListener("icegatheringstatechange", done); res(); } };
    pc.addEventListener("icegatheringstatechange", done);
    setTimeout(res, 1500);
  });
  const resp = await fetch(cam.url, {
    method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/sdp", ...basicAuth(cam) },
    body: pc.localDescription.sdp,
  });
  if (!resp.ok) { pc.close(); throw new Error(resp.status === 401 || resp.status === 403 ? "auth" : "http"); }
  await pc.setRemoteDescription({ type: "answer", sdp: await resp.text() });
  return pc;
}

function startRtc(cam, video) {
  const key = camKey(cam.id);
  const r = { kind: "rtc", els: new Set([video]), pc: null, retry: 0 };
  _run.set(key, r);
  const attempt = async () => {
    if (_run.get(key) !== r) return;
    setState(video, "connecting");
    try {
      r.pc = await whepConnect(cam, video);
      r.pc.addEventListener("connectionstatechange", () => {
        const s = r.pc?.connectionState;
        if (s === "failed" || s === "disconnected" || s === "closed") {
          if (_run.get(key) !== r) return;
          setState(video, "error");
          r.retry = setTimeout(attempt, 4000);
        }
      });
    } catch (_) {
      if (_run.get(key) !== r) return;
      setState(video, "error");
      r.retry = setTimeout(attempt, 6000);
    }
  };
  attempt();
}

/** Starts the right reader for `cam` on the card's picture element. */
function startStream(cam, el) {
  const key = camKey(cam.id);
  ensureSweeper();
  if (cam.protocol === "webrtc") { startRtc(cam, el); return; }
  if (cam.protocol === "mjpeg" && !cam.username) {
    _run.set(key, { kind: "mux", els: new Set([el]) });
    camStart(key, cam.url);
    camSubscribe(key, el);
    return;
  }
  if (!window.extCam) { setState(el, "error"); return; }
  wireFfmpegFeed();
  _run.set(key, { kind: "ff", els: new Set([el]), last: null });
  window.extCam.start({ key, url: cam.url, username: cam.username || "", password: cam.password || "" });
}

// ── Wall section ─────────────────────────────────────────────────────────────
const protoLabel = p => (p === "rtsp" ? "RTSP" : p === "mjpeg" ? "MJPEG" : "WebRTC");
const signature = () => _cams.map(c => [c.id, c.name, c.protocol, c.url, c.username, c.password].join("|")).join("\n");

function cardHtml(c) {
  const { esc, t } = ctx;
  const media = c.protocol === "webrtc"
    ? `<video class="xc-media" muted playsinline autoplay></video>`
    : `<img class="xc-media" alt="" draggable="false"/>`;
  return `
    <div class="xc-card" data-id="${esc(c.id)}" data-state="connecting">
      <div class="xc-head">
        <span class="xc-name">${esc(c.name || "")}</span>
        <span class="xc-proto">${esc(protoLabel(c.protocol))}</span>
        <button type="button" class="xc-gear" data-xc-edit="${esc(c.id)}" aria-label="${esc(t("extCamEditTitle"))}">
          <span class="icon icon-settings icon-14"></span>
        </button>
      </div>
      <div class="xc-view">
        ${media}
        <div class="xc-overlay xc-overlay--connecting">${esc(t("extCamConnecting"))}</div>
        <div class="xc-overlay xc-overlay--error"><span class="icon icon-eye-off icon-24"></span>${esc(t("extCamNoSignal"))}</div>
      </div>
    </div>`;
}

/**
 * Puts the "External cameras" section under the camera wall (or alone when no
 * printer camera is online). Signature guard: the same cameras leave the live
 * streams untouched; only a change rebuilds the section.
 */
export function mountExtCamSection(host) {
  let sec = host.querySelector(".ext-cam-section");
  if (!_cams.length) { if (sec) { releaseAll(); sec.remove(); } return; }
  const sig = signature();
  if (sec && sec.dataset.sig === sig) return;
  host.querySelector(":scope > .printers-empty-card")?.remove();
  releaseAll();
  sec?.remove();
  let scroll = host.querySelector(".cam-scroll");
  if (!scroll) { scroll = document.createElement("div"); scroll.className = "printers-scroll cam-scroll"; host.appendChild(scroll); }
  sec = document.createElement("section");
  sec.className = "ext-cam-section";
  sec.dataset.sig = sig;
  sec.innerHTML = `
    <div class="ext-cam-head">${ctx.esc(ctx.t("extCamTitle"))}</div>
    <div class="ext-cam-grid">${_cams.map(cardHtml).join("")}</div>`;
  scroll.appendChild(sec);
  sec.querySelectorAll("[data-xc-edit]").forEach(b =>
    b.addEventListener("click", () => openExtCamEditor(_cams.find(c => c.id === b.dataset.xcEdit))));
  sec.querySelectorAll(".xc-card").forEach(card => {
    const cam = _cams.find(c => c.id === card.dataset.id);
    const el = card.querySelector(".xc-media");
    if (!cam || !el) return;
    // The picture arriving is what turns "connecting" into "live".
    el.addEventListener(el.tagName === "VIDEO" ? "playing" : "load", () => setState(el, "live"));
    startStream(cam, el);
  });
}

// ── Add / edit card ──────────────────────────────────────────────────────────
let _domReady = false;
let _editId = null;
let _protocol = "rtsp";
const $ = id => document.getElementById(id);

function ensureDOM() {
  if (_domReady) return;
  _domReady = true;
  const root = document.createElement("div");
  root.id = "extCamRoot";
  root.innerHTML = `
<div class="modal-overlay" id="xcOverlay" role="dialog" aria-modal="true">
  <div class="modal-card pba-card">
    <div class="pba-header">
      <div class="pba-header-text">
        <div class="pba-title" id="xcTitle" data-i18n="extCamTitle">External cameras</div>
        <div class="pba-sub" id="xcSub" data-i18n="extCamSub">Add any IP camera: RTSP, MJPEG, WebRTC, not just the printer's built-in one.</div>
      </div>
      <button class="modal-close" id="xcClose">✕</button>
    </div>
    <div class="pba-body">
      <div class="pba-field">
        <span class="pba-field-label" data-i18n="extCamName">Name</span>
        <input type="text" id="xcName" class="pba-input" maxlength="40" autocomplete="off" data-i18n-placeholder="extCamNamePh" placeholder="Workshop"/>
      </div>
      <div class="pba-field">
        <span class="pba-field-label" data-i18n="extCamProtocol">Protocol</span>
        <div class="xc-seg" id="xcProto" role="radiogroup">
          ${PROTOCOLS.map(p => `<button type="button" role="radio" data-proto="${p}">${protoLabel(p)}</button>`).join("")}
        </div>
      </div>
      <div class="pba-field">
        <span class="pba-field-label" data-i18n="extCamUrl">Stream address</span>
        <input type="text" id="xcUrl" class="pba-input pba-input--mono" spellcheck="false" autocomplete="off" autocapitalize="off"/>
      </div>
      <div class="pba-field">
        <span class="pba-field-label" data-i18n="extCamUser">Username (optional)</span>
        <input type="text" id="xcUser" class="pba-input" spellcheck="false" autocomplete="off" autocapitalize="off"/>
      </div>
      <div class="pba-field">
        <span class="pba-field-label" data-i18n="extCamPass">Password (optional)</span>
        <input type="password" id="xcPass" class="pba-input" autocomplete="new-password"/>
      </div>
      <div class="pba-error" id="xcError" hidden></div>
      <div class="xc-test" id="xcTest" hidden></div>
    </div>
    <div class="pba-footer">
      <button class="adf-btn adf-btn--secondary" id="xcBack">
        <span class="icon icon-chevron-l icon-13"></span><span data-i18n="printerAddBack">Back</span>
      </button>
      <button class="adf-btn adf-btn--secondary xc-delete" id="xcDelete" hidden>
        <span class="hold-progress"></span>
        <span class="icon icon-trash icon-13"></span><span data-i18n="extCamDelete">Delete camera</span>
      </button>
      <button class="adf-btn adf-btn--secondary" id="xcTestBtn">
        <span class="icon icon-check icon-13"></span><span class="label" data-i18n="extCamTestBtn">Test</span>
      </button>
      <button class="adf-btn adf-btn--primary" id="xcSave">
        <span class="icon icon-plus icon-13"></span><span class="label" id="xcSaveLabel" data-i18n="extCamAdd">Add camera</span>
      </button>
    </div>
  </div>
</div>`;
  document.body.appendChild(root);
  wireDOM();
  ctx.applyTranslations();
}

function setProtocol(p) {
  _protocol = PROTOCOLS.includes(p) ? p : "rtsp";
  $("xcProto").querySelectorAll("[data-proto]").forEach(b => b.setAttribute("aria-checked", String(b.dataset.proto === _protocol)));
  $("xcUrl").placeholder = PLACEHOLDER[_protocol];
  showTest(null);
}

function showError(msg) { const e = $("xcError"); e.textContent = msg || ""; e.hidden = !msg; }
function showTest(state, msg) {
  const el = $("xcTest");
  el.hidden = !state;
  el.dataset.state = state || "";
  el.textContent = msg || "";
}

/** The address as typed, with the scheme added when the user left it out. */
function normalisedUrl() {
  let u = $("xcUrl").value.trim();
  if (u && !/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = (_protocol === "rtsp" ? "rtsp://" : "http://") + u;
  return u;
}

function readForm() {
  const url = normalisedUrl();
  let ok = false;
  try { const p = new URL(url); ok = SCHEMES[_protocol].test(p.protocol) && !!p.hostname; } catch (_) {}
  return {
    name: $("xcName").value.trim(), protocol: _protocol, url, urlOk: ok,
    username: $("xcUser").value.trim(), password: $("xcPass").value,
  };
}

const ERR_CODES = ["badUrl", "noFfmpeg", "timeout", "auth", "notFound", "unreachable", "noImage"];
const errText = code => ctx.t("extCamErr_" + (ERR_CODES.includes(code) ? code : "noImage"));

async function testConnection() {
  const f = readForm();
  showError(null);
  if (!f.urlOk) { showError(errText("badUrl")); return; }
  const btn = $("xcTestBtn");
  btn.disabled = true;
  showTest("busy", ctx.t("extCamTesting"));
  try {
    if (f.protocol === "webrtc") {
      const video = document.createElement("video");
      let pc;
      try {
        pc = await whepConnect(f, video);
        await new Promise((res, rej) => {
          const to = setTimeout(() => rej(new Error("noImage")), 8000);
          video.addEventListener("loadeddata", () => { clearTimeout(to); res(); }, { once: true });
        });
        showTest("ok", ctx.t("extCamTestOk"));
      } finally { try { pc?.close(); } catch (_) {} }
    } else {
      const r = await window.extCam.test({ url: f.url, username: f.username, password: f.password });
      if (r.ok) showTest("ok", ctx.t("extCamTestOk"));
      else showTest("fail", errText(r.code));
    }
  } catch (e) {
    showTest("fail", errText(e?.message === "auth" || e?.message === "noImage" ? e.message : "unreachable"));
  } finally { btn.disabled = false; }
}

async function save() {
  const f = readForm();
  showError(null);
  if (!f.name) { showError(ctx.t("extCamErrName")); $("xcName").focus(); return; }
  if (!f.urlOk) { showError(errText("badUrl")); $("xcUrl").focus(); return; }
  const col = colRef();
  if (!col) return;
  const btn = $("xcSave");
  btn.disabled = true;
  try {
    const ref = _editId ? col.doc(_editId) : col.doc();
    const now = firebase.firestore.FieldValue.serverTimestamp();
    await ref.set({
      name: f.name, protocol: f.protocol, url: f.url, username: f.username, password: f.password,
      updatedAt: now, ...(_editId ? {} : { createdAt: now }),
    }, { merge: true });
    closeCard();
  } catch (e) {
    console.warn("[ext-cam] save failed:", e?.code || e?.message);
    showError(ctx.t("extCamErrSave"));
  } finally { btn.disabled = false; }
}

async function remove() {
  const col = colRef();
  if (!col || !_editId) return;
  try { await col.doc(_editId).delete(); closeCard(); }
  catch (e) { console.warn("[ext-cam] delete failed:", e?.code || e?.message); showError(ctx.t("extCamErrSave")); }
}

function closeCard() { $("xcOverlay")?.classList.remove("open"); }

function wireDOM() {
  $("xcOverlay").addEventListener("click", e => { if (e.target.id === "xcOverlay") closeCard(); });
  $("xcClose").addEventListener("click", closeCard);
  $("xcBack").addEventListener("click", () => { closeCard(); if (!_editId) ctx.openBrandPicker(); });
  $("xcProto").addEventListener("click", e => { const b = e.target.closest("[data-proto]"); if (b) setProtocol(b.dataset.proto); });
  $("xcTestBtn").addEventListener("click", testConnection);
  $("xcSave").addEventListener("click", save);
  ["xcName", "xcUrl", "xcUser", "xcPass"].forEach(id =>
    $(id).addEventListener("keydown", e => { if (e.key === "Enter") save(); }));
  $("xcUrl").addEventListener("input", () => showTest(null));
  ctx.setupHoldToConfirm($("xcDelete"), 1500, remove);
}

function open(cam) {
  ensureDOM();
  _editId = cam?.id || null;
  $("xcName").value = cam?.name || "";
  $("xcUrl").value = cam?.url || "";
  $("xcUser").value = cam?.username || "";
  $("xcPass").value = cam?.password || "";
  setProtocol(cam?.protocol || "rtsp");
  showError(null);
  showTest(null);
  $("xcTitle").textContent = ctx.t(cam ? "extCamEditTitle" : "extCamTitle");
  $("xcSub").hidden = !!cam;
  $("xcSaveLabel").textContent = ctx.t(cam ? "extCamSave" : "extCamAdd");
  $("xcDelete").hidden = !cam;
  $("xcBack").hidden = !!cam;
  $("xcOverlay").classList.add("open");
  setTimeout(() => $("xcName").focus(), 80);
}

export function openExtCamAddFlow() { open(null); }
export function openExtCamEditor(cam) { if (cam) open(cam); }
