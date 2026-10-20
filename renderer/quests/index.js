/**
 * quests/index.js — Tiger Quests in Studio (spec: docs/QUESTS.md).
 *
 * The SERVER decides everything (TigerTag_Firebase_Backend functions/quests.js):
 * this module only
 *   1. reports what the user did — counters and gauges in
 *      users/{uid}/telemetry/studio.quest (questBump / questGauge, batched);
 *   2. checks in with dailyQuest on launch, on window focus and at local
 *      midnight (the call that starts a day and pays "open the app");
 *   3. shows the result — users/{uid}/quests/{daily,journey} live, the level
 *      table from the check-in answer — in the sidebar pill and the Quests
 *      window, and celebrates every mission, full set and level won.
 *
 *   initQuests({ t, esc, uid() → active uid | null, db(uid) → firestore,
 *                token() → Promise<ID token>, brandName(id), materialName(id),
 *                playTones(notes, opts), onChange() })
 *   questsSignIn(uid) / questsSignOut()
 *   questBump(key, n = 1)   — a counter (FieldValue.increment)
 *   questGauge(key, value)  — a gauge (set when it changed)
 *   questPillHtml() / questDailyProgress() / openQuests(tab)
 */
const DAILY_QUEST_URL = "https://us-central1-tigertag-connect.cloudfunctions.net/dailyQuest";
const FLUSH_MS = 1500;                 // bumps within this window land in one write
const FOCUS_CHECKIN_MS = 10 * 60e3;    // a window focus re-checks in at most every 10 min
const RANKS = 20;                      // ranks announced in the app; the server ships 1 and 2
const RANK_ICONS = ["🏕️", "🌄", "🏔️", "🏜️", "🛶", "⛵", "🌊", "🧊", "🛩️", "🎈", "🛰️", "🌙", "🌍", "☄️", "🪐", "🧭", "⭐", "✨", "🌌", "♾️"];
const RANK_IDS = { discovery: 1, explorer: 2 };

let _ctx = null;
let _uid = null;
let _unsubs = [];
let _daily = null, _journey = null, _levels = null, _rewards = null;
let _lastCheckIn = 0, _midnightTimer = null, _flushTimer = null;
const _bumps = new Map(), _gauges = new Map(), _gaugeSent = new Map();
let _board = null;   // { card, render } while the window is open

export function initQuests(ctx) {
  _ctx = ctx;
  window.addEventListener("focus", () => { if (_uid && Date.now() - _lastCheckIn > FOCUS_CHECKIN_MS) checkIn(); });
}

// ── 1. Counters ──────────────────────────────────────────────────────────────
export function questBump(key, n = 1) {
  if (!_uid || !key) return;
  _bumps.set(key, (_bumps.get(key) || 0) + n);
  scheduleFlush();
}
export function questGauge(key, value) {
  if (!_uid || !key || !Number.isFinite(value)) return;
  if (_gaugeSent.get(key) === value) return;
  _gauges.set(key, value);
  scheduleFlush();
}
function scheduleFlush() {
  clearTimeout(_flushTimer);
  _flushTimer = setTimeout(flush, FLUSH_MS);
}
function flush() {
  const uid = _uid;
  if (!uid || (!_bumps.size && !_gauges.size)) return;
  const FV = window.firebase.firestore.FieldValue;
  const quest = {};
  for (const [k, n] of _bumps) quest[k] = FV.increment(n);
  for (const [k, v] of _gauges) quest[k] = v;
  const gauges = new Map(_gauges);
  _bumps.clear(); _gauges.clear();
  _ctx.db(uid).collection("users").doc(uid).collection("telemetry").doc("studio")
    .set({ quest }, { merge: true })
    .then(() => { for (const [k, v] of gauges) _gaugeSent.set(k, v); })
    .catch(e => console.warn("[quests] counter write failed:", e.code || e.message));
}

// ── 2. Check-in ──────────────────────────────────────────────────────────────
export function questsSignIn(uid) {
  if (_uid === uid) return;
  questsSignOut();
  _uid = uid;
  const ref = _ctx.db(uid).collection("users").doc(uid).collection("quests");
  _unsubs.push(ref.doc("daily").onSnapshot(s => onDaily(s.data() || null), () => {}));
  _unsubs.push(ref.doc("journey").onSnapshot(s => onJourney(s.data() || null), () => {}));
  checkIn();
}
export function questsSignOut() {
  if (_uid) flush();
  _unsubs.forEach(u => { try { u(); } catch (_) {} });
  _unsubs = []; _uid = null; _daily = _journey = null;
  _bumps.clear(); _gauges.clear(); _gaugeSent.clear();
  clearTimeout(_midnightTimer);
}
async function checkIn() {
  const uid = _uid; if (!uid) return;
  _lastCheckIn = Date.now();
  let tz = "UTC";
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (_) {}
  try {
    const token = await _ctx.token();
    if (!token || uid !== _uid) return;
    const r = await fetch(DAILY_QUEST_URL, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Firebase-Id-Token": token },
      body: JSON.stringify({ tz }),
    });
    if (!r.ok || uid !== _uid) return;
    const j = await r.json();
    _levels = j.levels || _levels;
    _rewards = j.rewards || _rewards;
    refresh();
  } catch (e) { console.warn("[quests] check-in failed:", e.message); }
  armMidnight();
}
// The next local midnight (+5 s): a window left open starts the new day by itself.
function armMidnight() {
  clearTimeout(_midnightTimer);
  const now = new Date(), next = new Date(now);
  next.setHours(24, 0, 5, 0);
  _midnightTimer = setTimeout(checkIn, Math.min(next - now, 2 ** 31 - 1));
}

// ── 3. Live state + celebrations ─────────────────────────────────────────────
function onDaily(d) {
  const prev = _daily;
  _daily = d;
  if (prev && d && prev.day === d.day) {
    (d.missions || []).forEach((id, k) => {
      if (d.done?.[k] && !prev.done?.[k]) celebrate("mission", { label: missionLabel(id), xp: _rewards?.daily?.mission ?? 5 });
    });
    if (d.bonusPaid && !prev.bonusPaid) celebrate("fullSet", { xp: _rewards?.daily?.fullSet ?? 30 });
  }
  refresh();
}
function onJourney(j) {
  const prev = _journey;
  _journey = j;
  if (prev && j) {
    for (const id of j.bonusesPaid || []) {
      if (!(prev.bonusesPaid || []).includes(id)) {
        const lv = _levels?.find(l => l.id === id);
        celebrate("level", { label: levelName(id), xp: lv?.bonus || 0 });
      }
    }
  }
  refresh();
}
function refresh() {
  _ctx?.onChange?.();
  _board?.render();
}

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
function celebrate(kind, { label = "", xp = 0 } = {}) {
  const { t, esc } = _ctx;
  const title = kind === "mission" ? t("questsMissionDone") : kind === "fullSet" ? t("questsFullSetDone") : t("questsLevelDone");
  const el = document.createElement("div");
  el.className = `qst-cel qst-cel--${kind}`;
  el.setAttribute("role", "status");
  el.innerHTML = `
    <span class="qst-cel-burst" aria-hidden="true">${"<i></i>".repeat(10)}</span>
    <span class="qst-cel-xp">+${xp} XP</span>
    <span class="qst-cel-txt"><b>${esc(title)}</b>${label ? `<small>${esc(label)}</small>` : ""}</span>`;
  document.body.appendChild(el);
  const tones = kind === "mission"
    ? [{ f: 880, d: 0.10 }, { f: 1318.5, t: 0.08, d: 0.18 }]
    : [{ f: 784, d: 0.12 }, { f: 988, t: 0.1, d: 0.12 }, { f: 1175, t: 0.2, d: 0.14 }, { f: 1568, t: 0.32, d: 0.36 }];
  try { _ctx.playTones?.(tones, { type: "triangle", gain: 0.07 }); } catch (_) {}
  const life = kind === "mission" ? 2600 : 4200;
  setTimeout(() => {
    if (reducedMotion()) { el.remove(); return; }
    el.classList.add("is-out");
    el.addEventListener("animationend", () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 600);
  }, life);
}

// ── Labels ───────────────────────────────────────────────────────────────────
function missionLabel(id) {
  const { t } = _ctx;
  const [base, param] = String(id).split(":");
  if (base === "findBrand") return t("questDaily_findBrand", { brand: _ctx.brandName(Number(param)) || "?" });
  if (base === "filterMaterial") return t("questDaily_filterMaterial", { material: _ctx.materialName(Number(param)) || "?" });
  return t(`questDaily_${base}`);
}
const actionLabel = id => _ctx.t(`questAct_${id.replace(".", "_")}`);
function levelName(id) {
  const { t } = _ctx;
  const lv = _levels?.find(l => l.id === id);
  const n = lv ? RANK_IDS[lv.rank] : null;
  return `${n ? t(`questRank_${n}`) : ""} ${id.slice(1)} · ${t(`questLevel_${id}`)}`.trim();
}

// ── Sidebar pill ─────────────────────────────────────────────────────────────
// Today's progress: "open the app" + the 4 missions.
export function questDailyProgress() {
  const today = localDay();
  if (!_daily || _daily.day !== today) return null;
  const done = (_daily.open ? 1 : 0) + (_daily.done || []).filter(Boolean).length;
  return { done, total: 1 + (_daily.missions || []).length, complete: _daily.bonusPaid === true };
}
function localDay() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function questPillHtml() {
  const p = questDailyProgress();
  if (!p) return "";
  return `<span class="icon icon-list-check icon-10" aria-hidden="true"></span><span class="sb-quest-n">${p.done}/${p.total}</span>`;
}
export function questPillLabel() {
  const p = questDailyProgress();
  return p ? _ctx.t("questsPillLabel", { n: p.done, total: p.total }) : _ctx.t("questsTitle");
}

// The level the user is working on: the first one whose bonus is not paid yet.
export function questCurrentLevel() {
  if (!_levels) return null;
  const paid = new Set(_journey?.bonusesPaid || []), a = _journey?.actions || {};
  const lv = _levels.find(l => !paid.has(l.id)) || _levels[_levels.length - 1];
  const n = RANK_IDS[lv.rank] || 1;
  return {
    id: lv.id, rank: n, icon: RANK_ICONS[n - 1], name: `${_ctx.t(`questRank_${n}`)} ${lv.id.slice(1)}`,
    done: lv.actions.filter(x => (a[x.id] || 0) >= x.target).length, total: lv.actions.length,
  };
}

// ── Quests window ────────────────────────────────────────────────────────────
export function openQuests(tab = "today") {
  if (!_uid || document.querySelector(".quest-board")) return;
  const { t, esc } = _ctx;
  const opener = document.activeElement;
  const bd = document.createElement("div"); bd.className = "support-backdrop";
  const card = document.createElement("div");
  card.className = "squad-invite quest-board";
  card.setAttribute("role", "dialog"); card.setAttribute("aria-modal", "true"); card.setAttribute("aria-labelledby", "questBoardTitle");
  card.innerHTML = `
    <button type="button" class="squad-invite-x" data-act="close" aria-label="${esc(t("tutoClose"))}"><span class="icon icon-close icon-14"></span></button>
    <div class="tsq-scroll">
      <h2 class="tsq-title" id="questBoardTitle"><span class="tsq-grad">${esc(t("questsTitle"))}</span></h2>
      <p class="qst-where"></p>
      <div class="sqb-tabs" role="tablist">
        <button type="button" role="tab" class="sqb-tab" data-tab="today">${esc(t("questsToday"))}</button>
        <button type="button" role="tab" class="sqb-tab" data-tab="journey">${esc(t("questsJourney"))}</button>
      </div>
      <div class="qst-body" aria-live="polite"></div>
    </div>`;
  let which = tab, rank = currentRank();
  const close = () => {
    _board = null;
    card.classList.add("is-closing");
    setTimeout(() => { card.remove(); bd.remove(); opener?.focus?.(); }, reducedMotion() ? 0 : 160);
    document.removeEventListener("keydown", onKey, true);
  };
  const onKey = e => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  const render = () => {
    card.querySelectorAll(".sqb-tab").forEach(b => { const on = b.dataset.tab === which; b.classList.toggle("is-on", on); b.setAttribute("aria-selected", String(on)); });
    card.querySelector(".qst-where").textContent = whereLine();
    const body = card.querySelector(".qst-body");
    body.innerHTML = which === "today" ? todayHtml() : journeyHtml(rank);
  };
  card.addEventListener("click", e => {
    const tabBtn = e.target.closest(".sqb-tab");
    if (tabBtn) { which = tabBtn.dataset.tab; render(); return; }
    const r = e.target.closest("[data-rank]");
    if (r && !r.disabled) { rank = Number(r.dataset.rank); render(); return; }
    if (e.target.closest("[data-act=close]")) close();
  });
  bd.addEventListener("click", close);
  document.addEventListener("keydown", onKey, true);
  document.body.append(bd, card);
  _board = { card, render };
  render();
  card.querySelector(`.sqb-tab[data-tab="${which}"]`)?.focus();
  if (Date.now() - _lastCheckIn > 60e3) checkIn();
}

// The rank the user is in: the first one with a level whose bonus is not paid.
function currentRank() {
  if (!_levels) return 1;
  const paid = new Set(_journey?.bonusesPaid || []);
  const open = _levels.find(l => !paid.has(l.id));
  return open ? RANK_IDS[open.rank] || 1 : RANK_IDS[_levels[_levels.length - 1].rank] || 1;
}
function whereLine() {
  const { t } = _ctx;
  const n = currentRank();
  return `${RANK_ICONS[n - 1]} ${t(`questRank_${n}`)} · ${t(`questWorld_${n}`)}`;
}

function bar(count, target) {
  const pct = Math.max(0, Math.min(100, Math.round((count / Math.max(1, target)) * 100)));
  return `<span class="qst-bar" aria-hidden="true"><i style="width:${pct}%"></i></span>`;
}
function row({ label, done, xp, count, target }) {
  const { esc } = _ctx;
  const counted = target > 1 ? `<span class="qst-count">${Math.min(count, target)}/${target}</span>` : "";
  return `
    <li class="qst-row${done ? " is-done" : ""}">
      <span class="qst-check" aria-hidden="true">${done ? `<span class="icon icon-check icon-12"></span>` : ""}</span>
      <span class="qst-label">${esc(label)}${target > 1 ? bar(count, target) : ""}</span>
      ${counted}
      <span class="qst-xp">+${xp}</span>
    </li>`;
}

function todayHtml() {
  const { t, esc } = _ctx;
  const p = questDailyProgress();
  if (!p) return `<p class="sqb-empty">${esc(t("questsLoading"))}</p>`;
  const r = _rewards?.daily || { open: 10, mission: 5, fullSet: 30 };
  const rows = [row({ label: t("questsOpenApp"), done: _daily.open, xp: r.open, count: 1, target: 1 })]
    .concat((_daily.missions || []).map((id, k) => row({ label: missionLabel(id), done: _daily.done?.[k] === true, xp: r.mission, count: 0, target: 1 })));
  const streak = _daily.streak || 0;
  return `
    <ol class="qst-list">${rows.join("")}</ol>
    <div class="qst-set${p.complete ? " is-done" : ""}">
      <span class="qst-set-name">${esc(t("questsFullSet"))}</span>
      ${bar(p.done, p.total)}
      <span class="qst-xp">+${r.fullSet}</span>
    </div>
    <p class="qst-foot">${streak > 0 ? `<span>🔥 ${esc(t("questsStreak", { n: streak }))}</span>` : ""}<span>${esc(t("questsResetIn", { time: untilMidnight() }))}</span></p>`;
}
function untilMidnight() {
  const now = new Date(), next = new Date(now); next.setHours(24, 0, 0, 0);
  const m = Math.max(1, Math.round((next - now) / 60e3)), h = Math.floor(m / 60);
  return h ? `${h} h ${String(m % 60).padStart(2, "0")}` : `${m} min`;
}

function journeyHtml(rank) {
  const { t, esc } = _ctx;
  if (!_levels) return `<p class="sqb-empty">${esc(t("questsLoading"))}</p>`;
  const built = new Set(_levels.map(l => RANK_IDS[l.rank]).filter(Boolean));
  const chips = Array.from({ length: RANKS }, (_, i) => {
    const n = i + 1, ready = built.has(n);
    return `<button type="button" class="qst-rank${n === rank ? " is-on" : ""}${ready ? "" : " is-soon"}" data-rank="${n}"${ready ? "" : " disabled"}
      aria-label="${esc(`${t(`questRank_${n}`)} · ${ready ? t(`questWorld_${n}`) : t("questsComingSoon")}`)}"><span aria-hidden="true">${RANK_ICONS[i]}</span></button>`;
  }).join("");
  const a = _journey?.actions || {}, paid = new Set(_journey?.bonusesPaid || []);
  const waiting = new Set(_journey?.waiting || []), locked = new Set(_journey?.locked || []);
  const levels = _levels.filter(l => RANK_IDS[l.rank] === rank).map(l => {
    const done = l.actions.filter(x => (a[x.id] || 0) >= x.target).length;
    const state = paid.has(l.id) ? "won" : waiting.has(l.id) ? "waiting" : locked.has(l.id) ? "locked" : "open";
    const chip = state === "won" ? t("questsWon") : state === "waiting" ? t("questsWaiting")
      : state === "locked" ? t("questsLocked", { xp: l.enter.toLocaleString() }) : t("questsProgress", { n: done, total: l.actions.length });
    return `
      <section class="qst-level qst-level--${state}">
        <header class="qst-level-head">
          <span class="qst-level-name">${esc(levelName(l.id))}</span>
          <span class="qst-state">${state === "locked" ? `<span class="icon icon-lock icon-10" aria-hidden="true"></span>` : ""}${esc(chip)}</span>
          <span class="qst-bonus"><span class="icon icon-gift icon-12" aria-hidden="true"></span>+${l.bonus}</span>
        </header>
        <ol class="qst-list">${l.actions.map(x => row({ label: actionLabel(x.id), done: (a[x.id] || 0) >= x.target, xp: x.xp, count: a[x.id] || 0, target: x.target })).join("")}</ol>
      </section>`;
  }).join("");
  return `
    <div class="qst-ranks" role="group" aria-label="${esc(t("questsJourney"))}">${chips}</div>
    <h3 class="qst-rank-title">${RANK_ICONS[rank - 1]} ${esc(t(`questRank_${rank}`))} <small>${esc(t(`questWorld_${rank}`))}</small></h3>
    ${levels}`;
}
