/**
 * rfid_protocol/linked — linked chips (spec: docs/LINKED-CHIPS.md).
 *
 * A third-party RFID chip (Bambu Lab, Creality… MIFARE Classic) that is not a
 * TigerTag is mapped to one spool of the inventory through
 * users/{uid}/rfidAliases/{UID_HEX} { spoolId, chip, vendor, linkedAt }. Scanning
 * it then opens that spool. Phase 1: Studio only.
 *
 *   initLinkedChips({ t, esc, state, fbDb, thumbHTML, openDetail, setupHoldToConfirm,
 *                     toast, reportError, onChange, openCatalogue, openManual })
 *   linkedChipsSignIn(uid) / linkedChipsSignOut()   — follow the account's aliases
 *   onForeignChip({ readerName, uid, chip })        — a scan (buffered 1.5 s)
 *   linkPendingTo(spoolId) / clearPendingLink()     — after a creation started from the window
 *   openBlankChipWindow(n) / closeChipChoice()      — a blank NTAG: catalogue or manual (side card)
 *   linkedChipsHtml(row) / wireLinkedChips(root)    — the detail panel's section
 */

let ctx = null;
let accountUid = null;
let unsub = null;
const aliases = new Map();   // UID_HEX → { spoolId, chip, vendor }
const buffer = new Map();    // readerName → { uid, chip }
let bufferTimer = null;
let pending = null;          // { chips, until } — chips waiting for a spool being created

const UID_RE = /^[0-9A-F]{8,20}$/;
const norm = u => String(u || "").replace(/[^0-9a-f]/gi, "").toUpperCase();

export function initLinkedChips(c) { ctx = c; }

export function linkedChipsSignIn(uid) {
  linkedChipsSignOut();
  accountUid = uid;
  unsub = ctx.fbDb(uid).collection("users").doc(uid).collection("rfidAliases").onSnapshot(snap => {
    aliases.clear();
    snap.forEach(d => aliases.set(d.id, d.data()));
    ctx.onChange?.();
  }, e => ctx.reportError?.("linkedChips.subscribe", e));
}
export function linkedChipsSignOut() {
  try { unsub?.(); } catch (_) {}
  unsub = null; accountUid = null; aliases.clear(); buffer.clear(); pending = null;
}

const ref = u => ctx.fbDb(accountUid).collection("users").doc(accountUid).collection("rfidAliases").doc(u);
const rowById = id => (ctx.state.rows || []).find(r => r.spoolId === id || r.uid === id) || null;
const twinOf = r => r?.twinUid ? rowById(String(r.twinUid)) : null;

// The doc a spool's chips point to (spec: "Which spool doc is the target").
function targetOf(row) {
  const twin = twinOf(row);
  if (!twin || twin.deleted) return row;
  if (row.tagIndex && twin.tagIndex && row.tagIndex !== twin.tagIndex) return row.tagIndex < twin.tagIndex ? row : twin;
  try { return BigInt(row.spoolId) <= BigInt(twin.spoolId) ? row : twin; } catch (_) { return row.spoolId <= twin.spoolId ? row : twin; }
}

// The live spool a chip leads to; a deleted target hands over to its twin (and
// the alias is rewritten), else the alias goes.
async function resolve(uid) {
  const a = aliases.get(uid);
  if (!a) return null;
  const row = rowById(a.spoolId);
  if (row && !row.deleted) return row;
  const twin = row ? twinOf(row) : null;
  try {
    if (twin && !twin.deleted) { await ref(uid).set({ ...a, spoolId: twin.spoolId }); return twin; }
    await ref(uid).delete();
  } catch (e) { ctx.reportError?.("linkedChips.resolve", e); }
  return null;
}

/** Every chip linked to this spool (its own doc and its twin's). */
export function linkedChipsOf(row) {
  if (!row) return [];
  const ids = new Set([row.spoolId, twinOf(row)?.spoolId].filter(Boolean));
  return [...aliases].filter(([, a]) => ids.has(a.spoolId)).map(([uid, a]) => ({ uid, ...a }));
}

export function onForeignChip({ readerName, uid, chip }) {
  const u = norm(uid);
  if (!accountUid || !UID_RE.test(u)) return;
  buffer.set(readerName || "reader", { uid: u, chip: chip || "unknown" });
  clearTimeout(bufferTimer);
  bufferTimer = setTimeout(flush, 1500);   // the TigerPOD's two readers see both flanges' chips together
}

async function flush() {
  const chips = [...new Map([...buffer.values()].map(c => [c.uid, c])).values()];
  buffer.clear();
  if (!chips.length) return;
  for (const c of chips) {
    const row = await resolve(c.uid);
    if (row) { ctx.openDetail(row.spoolId, { animateSwap: true }); return; }
  }
  openLinkWindow(chips);
}

async function link(chips, row) {
  const target = targetOf(row);
  const at = firebase.firestore.FieldValue.serverTimestamp();
  const batch = ctx.fbDb(accountUid).batch();
  for (const c of chips) batch.set(ref(c.uid), { spoolId: target.spoolId, chip: c.chip || "unknown", vendor: "unknown", linkedAt: at });
  await batch.commit();
  for (const c of chips) aliases.set(c.uid, { spoolId: target.spoolId, chip: c.chip, vendor: "unknown" });
}

export async function unlinkChip(uid) {
  await ref(uid).delete();
  aliases.delete(uid);
}

// ── The new-chip window ─────────────────────────────────────────────────────
// Minimal on purpose: no UID, no chip type. One window for every chip that has
// nothing on it yet, opened BEFORE any creation panel:
//   • a maker's chip (MIFARE…): Catalogue / Manually / Link to my inventory —
//     the first two create a TigerData+ / TigerData and the chips are linked to
//     it when it is saved (linkPendingTo), the third picks an existing spool;
//   • a blank NTAG (TigerTag Init, empty NDEF): Catalogue / Manually — the
//     created spool is then offered for burning onto that chip, as before.

/** Called right after a chipless creation: links the waiting chips to it. */
export async function linkPendingTo(spoolId) {
  const p = pending;
  pending = null;
  if (!p || Date.now() > p.until || !accountUid) return false;
  const row = rowById(spoolId);
  if (!row) return false;
  try { await link(p.chips, row); ctx.toast?.(ctx.t("linkedChipDone")); return true; }
  catch (e) { ctx.reportError?.("linkedChips.linkPending", e); return false; }
}
/** A creation started anywhere else must not pick up chips left waiting. */
export function clearPendingLink() { pending = null; }

/** A blank NTAG (TigerTag Init / empty NDEF) was placed: ask what to make of it. */
export function openBlankChipWindow(count = 1) {
  if (!accountUid) return;
  openChipWindow(Array.from({ length: Math.max(1, count) }, () => ({})), "blank");
}

function openLinkWindow(chips) { openChipWindow(chips, "foreign"); }

function openChipWindow(chips, kind) {
  const { t, esc } = ctx;
  const foreign = kind === "foreign";
  // A side card (#chipChoicePanel, inventory.html), in the cascade like the
  // "+ Material" source picker.
  const el = document.getElementById("chipChoicePanel");
  if (!el) return;
  el.querySelector("#chipChoiceTitle").textContent = t(foreign ? "linkedChipTitle" : "linkedChipBlankTitle");
  el.querySelector("#chipChoiceSub").textContent = chips.length > 1 ? t("linkedChipFoundMany", { n: chips.length }) : t("linkedChipFound");
  const body = el.querySelector("#chipChoiceBody");
  const back = el.querySelector("#chipChoiceBack");
  back.setAttribute("aria-label", t("linkedChipBack"));
  const close = () => { closeChipChoice(); };
  el._lcClick && el.removeEventListener("click", el._lcClick);
  const tile = (id, icon, label) => `
    <button type="button" class="lc-choice" data-lc-go="${id}">
      <span class="lc-choice-ic"><span class="icon icon-${icon} icon-18" aria-hidden="true"></span></span>
      <b>${esc(label)}</b>
      <span class="icon icon-chevron-r icon-13" aria-hidden="true"></span>
    </button>`;
  const create = `${tile("catalogue", "search", t("linkedChipAddCatalogue"))}${tile("manual", "edit", t("linkedChipAddManual"))}`;
  const steps = {
    start: () => `<div class="lc-choices">${create}${foreign ? tile("pick", "link", t("linkedChipExisting")) : ""}</div>`,
    create: () => `<div class="lc-choices">${create}</div>`,
    pick: () => `<label class="lc-search"><span class="icon icon-search icon-13" aria-hidden="true"></span><input type="search" data-lc-q placeholder="${esc(t("linkedChipSearch"))}"></label>
      <div class="lc-grid" data-lc-list></div>`,
  };
  const trail = [];
  const go = (step, push = true) => {
    if (push && body.dataset.step) trail.push(body.dataset.step);
    body.dataset.step = step;
    body.innerHTML = steps[step]();
    back.hidden = step === "start";
    el.classList.toggle("lc-panel--wide", step === "pick");
    ctx.syncPanels?.();
    body.classList.remove("lc-in"); void body.offsetWidth; body.classList.add("lc-in");
    if (step === "pick") wirePicker();
  };

  el._lcClick = e => {
    if (e.target.closest("#chipChoiceBack")) return go(trail.pop() || "start", false);
    const b = e.target.closest("[data-lc-go]");
    if (!b) return;
    const to = b.dataset.lcGo;
    if (to === "pick" || to === "create") return go(to);
    close();
    // Opening a creation panel clears any waiting chips, so set them after.
    if (to === "catalogue") ctx.openCatalogue(); else ctx.openManual();
    pending = foreign ? { chips, until: Date.now() + 15 * 60e3 } : null;
  };
  el.addEventListener("click", el._lcClick);

  function wirePicker() {
    // One entry per physical spool: a twin pair shows once.
    const seen = new Set();
    // Spools that already carry a linked chip are left out (a chip points to one spool).
    const spools = (ctx.state.rows || []).filter(r => !r.deleted && !r.isFriend).filter(r => {
      const tw = twinOf(r);
      const key = tw ? [r.spoolId, tw.spoolId].sort().join("|") : r.spoolId;
      if (seen.has(key)) return false;
      seen.add(key); return !linkedChipsOf(r).length;
    });
    const text = r => [r.brand, r.material, r.colorName].filter(s => s && s !== "-").join(" ").toLowerCase();
    const list = body.querySelector("[data-lc-list]");
    const newTile = `
      <button type="button" class="lc-gcard lc-gcard--new" data-lc-go="create">
        <span class="lc-gcard-img"><span class="icon icon-plus icon-24" aria-hidden="true"></span></span>
        <span class="lc-gcard-title">${esc(t("linkedChipNew"))}</span>
      </button>`;
    const paint = q => {
      const words = q.toLowerCase().split(/\s+/).filter(Boolean);
      const rows = spools.filter(r => words.every(w => text(r).includes(w))).slice(0, 120);
      list.innerHTML = newTile + rows.map(r => `
        <button type="button" class="lc-gcard" data-lc-spool="${esc(r.spoolId)}">
          <span class="lc-gcard-img">${ctx.thumbHTML(r, 128, { badges: false })}</span>
          <span class="lc-gcard-title">${esc(r.brand || "—")}</span>
          <span class="lc-gcard-sub">${esc([r.material, r.colorName].filter(s => s && s !== "-").join(" · "))}</span>
        </button>`).join("") + (rows.length ? "" : `<p class="lc-grid-empty">${esc(t("linkedChipNone"))}</p>`);
    };
    paint("");
    body.querySelector("[data-lc-q]").addEventListener("input", e => paint(e.target.value));
    setTimeout(() => body.querySelector("[data-lc-q]")?.focus(), 60);
    list.addEventListener("click", async e => {
      const b = e.target.closest("[data-lc-spool]");
      if (!b || b.classList.contains("is-loading")) return;
      const row = spools.find(r => r.spoolId === b.dataset.lcSpool);
      if (!row) return;
      b.classList.add("is-loading");
      try {
        await link(chips, row);
        close();
        ctx.toast?.(t("linkedChipDone"));
        ctx.openDetail(row.spoolId, { animateSwap: true });
      } catch (err) {
        b.classList.remove("is-loading");
        ctx.reportError?.("linkedChips.link", err);
        ctx.toast?.(t("squadDealsErr"));
      }
    });
  }
  delete body.dataset.step;
  go("start");
  el.classList.add("open");
  ctx.syncPanels?.();
}

export function closeChipChoice() {
  const el = document.getElementById("chipChoicePanel");
  if (!el?.classList.contains("open")) return;
  el.classList.remove("open", "lc-panel--wide");
  ctx.syncPanels?.();
}

// ── Detail panel section ────────────────────────────────────────────────────
export function linkedChipsHtml(row) {
  const { t, esc } = ctx;
  const chips = linkedChipsOf(row);
  if (!chips.length) return "";
  return `
    <div class="lc-section">
      <div class="lc-section-h"><span class="icon icon-nfc icon-13" aria-hidden="true"></span>${esc(t("linkedChipsTitle"))}</div>
      ${chips.map(c => `
        <div class="lc-linked">
          <code>${esc(c.uid)}</code>
          <button type="button" class="lc-unlink" data-lc-unlink="${esc(c.uid)}" data-hold-tip="linkedChipUnlinkTip">
            <span class="hold-progress" aria-hidden="true"></span><span>${esc(t("linkedChipUnlink"))}</span>
          </button>
        </div>`).join("")}
    </div>`;
}

export function wireLinkedChips(root) {
  root?.querySelectorAll("[data-lc-unlink]").forEach(b => {
    if (b._lcWired) return;
    b._lcWired = true;
    ctx.setupHoldToConfirm(b, 1200, async () => {
      try { await unlinkChip(b.dataset.lcUnlink); b.closest(".lc-linked")?.remove(); ctx.onChange?.(); }
      catch (e) { ctx.reportError?.("linkedChips.unlink", e); ctx.toast?.(ctx.t("squadDealsErr")); }
    }, { hint: true });
  });
}
