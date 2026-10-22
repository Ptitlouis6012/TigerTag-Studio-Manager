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
 *      table from the check-in answer — in the sidebar and view-bar chips and
 *      the Quests views (main area), and celebrates every mission, full set
 *      and level won.
 *
 *   initQuests({ t, esc, uid() → active uid | null, db(uid) → firestore,
 *                token() → Promise<ID token>, brandName(id), materialName(id),
 *                playTones(notes, opts), onChange(), openView(tab) })
 *   questsSignIn(uid) / questsSignOut()
 *   questBump(key, n = 1)   — a counter (FieldValue.increment)
 *   questGauge(key, value)  — a gauge (set when it changed)
 *   questPillLabel() / questDailyProgress() / questCurrentLevel()
 *   openQuests(tab) → ctx.openView(tab); renderQuestsView(host, tab)
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
  // The daily screen celebrates in place (rows, chest jackpot): no toast or
  // sound on top of it while it is on screen.
  const inPlace = !!document.querySelector(".qd-chest")?.offsetParent;
  if (prev && d && prev.day === d.day && !inPlace) {
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

// ── Today's progress (view-bar chip, sidebar badge) ─────────────────────────
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

// ── Quests view (the main area, like the stock and printer views) ────────────
// The host shows it for the view modes "questsToday" / "questsJourney" and calls
// renderQuestsView(host, tab) on every render.
// Look: the Tiger Quests presentation page — a dark game world, cut-corner
// panels, diamond check boxes, skewed segmented bars (quests.css "Game world").
let _viewRank = null;   // rank picked in the Journey view (null = current rank)
let _carRank = null;    // rank whose carousel position is being kept across renders
export function openQuests(tab = "today") { _ctx.openView?.(tab); }
// Jackpot: the full set completing while the daily screen is shown plays a ~2 s
// sequence (bar sweep → chest lights up → particle burst → XP count-up). Data
// refreshes landing meanwhile (the server rewrites the journey right after)
// wait for its end instead of rebuilding the panel mid-animation.
const JACKPOT_MS = 2100;
let _jackpotUntil = 0, _jackpotWait = null, _jackpotReplay = false;
// Clicking the open chest plays the jackpot again — display only, no XP.
function replayJackpot() {
  if (reducedMotion() || Date.now() < _jackpotUntil) return;
  _jackpotReplay = true;
  refresh();
}
export function renderQuestsView(host, tab = "today") {
  if (!host) return;
  if (tab === "today" && Date.now() < _jackpotUntil && host.querySelector(".qd-chest.is-jackpot")) {
    clearTimeout(_jackpotWait);
    _jackpotWait = setTimeout(refresh, _jackpotUntil - Date.now() + 30);
    return;
  }
  if (!host.dataset.wired) {
    host.dataset.wired = "1";
    host.addEventListener("keydown", e => {
      if ((e.key === "Enter" || e.key === " ") && e.target.closest?.(".qd-chest.is-earned")) { e.preventDefault(); replayJackpot(); }
    });
    host.addEventListener("click", e => {
      const r = e.target.closest("[data-rank]");
      if (r && !r.disabled) { _viewRank = Number(r.dataset.rank); refresh(); return; }
      if (e.target.closest(".qd-chest.is-earned")) { replayJackpot(); return; }
      const step = e.target.closest("[data-car]");
      if (step) {
        const track = host.querySelector(".qw-car-track"), card = track?.querySelector(".qw-lcard");
        if (track && card) track.scrollBy({ left: (card.offsetWidth + 14) * Number(step.dataset.car), behavior: reducedMotion() ? "auto" : "smooth" });
      }
    });
  }
  const rank = _viewRank || currentRank();
  const prevScroll = host.querySelector(".qw-car-track")?.scrollLeft;
  host.innerHTML = `<div class="qw">${tab === "today" ? todayHtml() : journeyHtml(rank)}</div>`;
  const xpEl = host.querySelector(".qd-chest.is-jackpot .qd-chest-xp");
  if (xpEl) countUp(xpEl, Number(xpEl.dataset.xp) || 0);
  const track = host.querySelector(".qw-car-track");
  if (track) {
    if (_carRank === rank && prevScroll != null) track.scrollTo({ left: prevScroll, behavior: "instant" });
    else {
      // Land on the next level to finish — once the journey has loaded (before
      // that every level looks unfinished) and the view is on screen — then
      // keep the user's position.
      // A render while the view is still hidden (launch) measures nothing: retry on the next one.
      if (_journey && track.clientWidth) _carRank = rank;
      const next = track.querySelector(".qw-lcard:not(.is-won)");
      if (next) track.scrollTo({ left: next.getBoundingClientRect().left - track.getBoundingClientRect().left, behavior: "instant" });
    }
  }
  if (Date.now() - _lastCheckIn > 60e3) checkIn();
}

// The rank the user is in: the first one with a level whose bonus is not paid.
function currentRank() {
  if (!_levels) return 1;
  const paid = new Set(_journey?.bonusesPaid || []);
  const open = _levels.find(l => !paid.has(l.id));
  return open ? RANK_IDS[open.rank] || 1 : RANK_IDS[_levels[_levels.length - 1].rank] || 1;
}
const pct = (n, of) => Math.max(0, Math.min(100, Math.round((n / Math.max(1, of)) * 100)));
const sbar = (n, of) => `<span class="qw-sbar" aria-hidden="true"><i style="width:${pct(n, of)}%"></i></span>`;
function task({ label, done, xp }) {
  const { esc } = _ctx;
  return `<li class="qw-task${done ? " is-done" : ""}"><span class="qw-box" aria-hidden="true"></span>
    <span class="qw-task-label">${esc(label)}</span>${xp ? `<span class="qw-xp">+${xp} XP</span>` : ""}</li>`;
}

// ── Today: the daily quests screen ───────────────────────────────────────────
// Banner, today's progress + the full-set chest, one row per quest, and a side
// column (streak, next draw, rewards, stats). Every value comes from the daily
// doc and the server's reward table; nothing here grants XP.
// Presentation only (no rule behind it): an icon and a category per mission.
const MISSION_LOOK = {
  open: ["tigerstudio", "quick"], findBrand: ["search", "exploration"], filterMaterial: ["filter", "exploration"],
  visitFriend: ["community", "exploration"], camera: ["camera", "exploration"], demoPrinter: ["printer", "exploration"],
  shareFriendLink: ["link", "exploration"], favorite: ["heart", "quick"], lightMode: ["bulb", "quick"],
  whatsNew: ["sparkle", "quick"], sortTable: ["list", "quick"], weightMove: ["scale", "challenge"],
  rackSpool: ["rack-grid", "challenge"], note: ["edit", "challenge"], minStock: ["bars", "challenge"], wishlist: ["cart", "challenge"],
};
const CALENDAR_SVG = `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="6" y="10" width="36" height="32" rx="6" fill="none" stroke="currentColor" stroke-width="3.5"/>
  <path d="M6 19h36M16 6v8M32 6v8" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>
  <g fill="currentColor"><rect x="13" y="25" width="6" height="5" rx="1.2"/><rect x="21" y="25" width="6" height="5" rx="1.2"/><rect x="29" y="25" width="6" height="5" rx="1.2"/><rect x="13" y="33" width="6" height="5" rx="1.2"/><rect x="21" y="33" width="6" height="5" rx="1.2"/></g></svg>`;
const localDayOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
// The streak still counts when the last full set was today or yesterday; older, it is broken.
function liveStreak() {
  const last = _daily?.lastFullDay; if (!last) return 0;
  const y = new Date(); y.setDate(y.getDate() - 1);
  return last === localDay() || last === localDayOf(y) ? _daily.streak || 0 : 0;
}
function ago(ms) {
  if (!ms) return "";
  const m = Math.round((Date.now() - ms) / 60e3);
  const rtf = new Intl.RelativeTimeFormat(_ctx.lang?.() || undefined, { numeric: "auto" });
  return m < 60 ? rtf.format(-Math.max(0, m), "minute") : rtf.format(-Math.round(m / 60), "hour");
}

// The jackpot's XP counts up from 0 (from 1 s in, over 0.5 s) to the value the
// server paid — display only.
function countUp(el, to) {
  const t0 = performance.now() + 1000;
  const step = now => {
    if (!el.isConnected) return;
    const k = Math.max(0, Math.min(1, (now - t0) / 500));
    el.textContent = `+${Math.round(to * k)} XP`;
    if (k < 1) requestAnimationFrame(step);
  };
  el.textContent = "+0 XP";
  requestAnimationFrame(step);
}
// Particles of the burst: 16 around the chest — gold dots, stars and orange / gold confetti.
const BURST = Array.from({ length: 16 }, (_, i) => {
  const a = (i / 16) * Math.PI * 2 + (i % 2 ? .18 : 0), d = 62 + (i * 37) % 58;
  const kind = ["dot", "star", "conf", "dot"][i % 4];
  return `<i class="qd-p qd-p--${kind}" style="--dx:${Math.round(Math.cos(a) * d)}px;--dy:${Math.round(Math.sin(a) * d * .8)}px;--r:${(i * 47) % 360}deg;--dl:${(i % 5) * 30}ms"></i>`;
}).join("");

// What the screen has already shown as done, per day: a part completing while
// the app is open plays its little animation once ("is-new"); re-renders and
// the first view of a day show the state without replaying anything.
let _shownDay = null;
const _shownDone = new Set();
function freshlyDone(key, done) {
  if (!done) return false;
  if (_shownDone.has(key)) return false;
  _shownDone.add(key);
  return _shownDay !== null;   // the first render of a day only records
}
function questRow({ look, title, desc, done, xp, at, fresh }) {
  const { t, esc } = _ctx;
  const [icon, cat] = look;
  const ic = icon === "tigerstudio"
    ? `<span class="qd-mask" style="--ico:url('../../assets/svg/icons/icon_tigerstudio.svg')"></span>`
    : `<span class="icon icon-${icon} icon-20"></span>`;
  return `
    <li class="qd-row qd-cat-${cat}${done ? " is-done" : ""}${fresh ? " is-new" : ""}">
      <span class="qd-ic" aria-hidden="true">${ic}</span>
      <span class="qd-title"><b>${esc(title)}</b><small>${esc(desc)}</small></span>
      <span class="qd-badge">${esc(t(`questsCat_${cat}`))}</span>
      <span class="qd-count">${done ? 1 : 0}/1</span>
      <span class="qd-bar" aria-hidden="true"><i style="width:${done ? 100 : 0}%"></i></span>
      <span class="qd-xp">+${xp} XP</span>
      <span class="qd-status"><span class="qd-check" aria-hidden="true">${done ? `<span class="icon icon-check icon-14"></span>` : ""}</span>
        <span><b>${esc(t(done ? "questsDoneLabel" : "questsTodoLabel"))}</b>${done && at ? `<small>${esc(ago(at))}</small>` : ""}</span></span>
    </li>`;
}

function todayHtml() {
  const { t, esc } = _ctx;
  const p = questDailyProgress();
  if (!p) return `<p class="qw-empty">${esc(t("questsLoading"))}</p>`;
  const r = { open: 10, mission: 5, fullSet: 30, streakBonus: 0, streakEvery: 5, ...(_rewards?.daily || {}) };
  const items = [{ look: MISSION_LOOK.open, title: t("questsOpenApp"), desc: t("questDesc_open"), done: _daily.open, xp: r.open, at: _daily.openAt }]
    .concat((_daily.missions || []).map((id, k) => {
      const base = String(id).split(":")[0];
      return { look: MISSION_LOOK[base] || ["star-fill", "quick"], title: missionLabel(id), desc: t(`questDesc_${base}`),
        done: _daily.done?.[k] === true, xp: r.mission, at: _daily.doneAt?.[k] };
    }));
  // First render of the day records what is already done; later ones flag new completions.
  if (_shownDay !== _daily.day) { _shownDone.clear(); _shownDay = null; }
  items.forEach((x, k) => { x.fresh = freshlyDone(`${k}`, x.done); });
  const freshSet = freshlyDone("set", p.complete);
  const jackpot = (freshSet || (_jackpotReplay && p.complete)) && !reducedMotion();
  _jackpotReplay = false;
  if (jackpot) _jackpotUntil = Date.now() + JACKPOT_MS;
  _shownDay = _daily.day;
  const max = items.reduce((a, x) => a + x.xp, 0) + r.fullSet;
  const earned = items.reduce((a, x) => a + (x.done ? x.xp : 0), 0) + (p.complete ? r.fullSet : 0);
  const rows = items.map(questRow).join("");
  const streak = liveStreak(), every = r.streakEvery || 5;
  const lit = streak ? ((streak - 1) % every) + 1 : 0;
  const nextBonusDay = streak - (streak % every) + every;   // the next multiple of `every` after today
  const chestState = p.complete ? "earned" : p.done === p.total - 1 ? "near" : "locked";
  const now = new Date(), midnight = new Date(now); midnight.setHours(24, 0, 0, 0);
  const dayPct = 100 - pct(midnight - now, 86400e3);   // the ring charges up to the next draw
  const reset = new Intl.DateTimeFormat(_ctx.lang?.() || undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(2000, 0, 1, 0, 0));
  const stat = (icon, label, value) => value == null ? "" : `<li><span class="icon icon-${icon} icon-14" aria-hidden="true"></span><span>${esc(label)}</span><b>${esc(String(value))}</b></li>`;
  return `
  <div class="qd">
    <section class="qd-banner">
      <span class="qd-cal" aria-hidden="true">${CALENDAR_SVG}</span>
      <div class="qd-head"><h2>${esc(t("questsDailyHeading"))}</h2><p>${esc(t("questsDailySub"))}</p></div>
      <span class="qd-caption">${esc(t("questsCaption"))}</span>
    </section>
    <div class="qd-grid">
      <div class="qd-main">
        <div class="qd-top">
          <section class="qd-card qd-progress${jackpot ? " is-jackpot" : ""}">
            <div class="qd-progress-head"><h3>${esc(t("questsTodayProgress"))}</h3><span class="qd-progress-n"><b>${p.done}</b> / ${p.total}</span></div>
            <div class="qd-progress-row">
              <span class="qd-seg" aria-hidden="true">${items.map((x, k) => `<i class="${k < p.done ? "on" : ""}${k < p.done && k >= p.done - items.filter(y => y.fresh).length ? " is-new" : ""}"></i>`).join("")}</span>
              <span class="qd-progress-xp"><b>${earned}</b> / ${max} XP</span>
            </div>
          </section>
          <section class="qd-card qd-chest is-${chestState}${jackpot ? " is-jackpot" : ""}"${p.complete ? ` role="button" tabindex="0" aria-label="${esc(t("questsReplayJackpot"))}"` : ""}>
            ${jackpot ? `<span class="qd-burst" aria-hidden="true"><span class="qd-rays"></span>${BURST}</span>` : ""}
            <span class="qd-chest-art"><img class="qd-chest-img" src="../assets/img/quests/full-set-chest${p.complete ? "" : "-closed"}.webp" alt="">
              ${jackpot ? `<img class="qd-chest-img qd-chest-closed" src="../assets/img/quests/full-set-chest-closed.webp" alt="">` : ""}
              ${p.complete ? "" : `<span class="qd-chest-lock" aria-hidden="true"><span class="icon icon-lock icon-10"></span></span>`}</span>
            <div class="qd-chest-txt"><span class="qd-chest-label">${esc(t("questsFullSet"))}</span><b class="qd-chest-xp" data-xp="${r.fullSet}">+${r.fullSet} XP</b>
              <small>${esc(t(p.complete ? "questsChestEarned" : "questsChestLocked"))} · ${p.done}/${p.total}</small></div>
            ${p.complete ? `<span class="qd-chest-check" aria-hidden="true"><span class="icon icon-check icon-20"></span></span>` : ""}
          </section>
        </div>
        <ol class="qd-list">${rows}</ol>
      </div>
      <aside class="qd-side">
        <section class="qd-card qd-streak">
          <span class="qd-flame" aria-hidden="true"><span class="icon icon-flame icon-24"></span></span>
          <div><span class="qd-side-label">${esc(t("questsStreakTitle"))}</span><b class="qd-side-big">${esc(t("questsDays", { n: streak }))}</b>
            ${r.streakBonus ? `<small>${esc(t("questsStreakNext", { xp: r.streakBonus, day: nextBonusDay }))}</small>` : ""}</div>
          <span class="qd-pips" aria-hidden="true">${Array.from({ length: every }, (_, i) => `<i class="${i < lit ? "on" : ""}"></i>`).join("")}</span>
        </section>
        <section class="qd-card qd-next">
          <span class="icon icon-clock icon-24" aria-hidden="true"></span>
          <div><span class="qd-side-label">${esc(t("questsNextIn"))}</span><b class="qd-side-big">${esc(untilMidnight())}</b></div>
          <svg class="qd-ring" viewBox="0 0 44 44" aria-hidden="true"><circle class="qd-ring-track" cx="22" cy="22" r="18"/>
            <circle class="qd-ring-fill" cx="22" cy="22" r="18" pathLength="100" stroke-dasharray="${dayPct} 100"/></svg>
          <small class="qd-reset">${esc(t("questsResetAt", { time: reset }))}</small>
        </section>
        <section class="qd-card qd-rewards">
          <h3>${esc(t("questsRewardsTitle"))}</h3>
          <ul>
            <li><span class="qd-gem qd-gem--open" aria-hidden="true"></span><span>${esc(t("questsRewardOpen"))}</span><b>+${r.open} XP</b></li>
            <li><span class="qd-gem" aria-hidden="true"></span><span>${esc(t("questsRewardPer"))}</span><b>+${r.mission} XP</b></li>
            <li><span class="qd-gem qd-gem--gold" aria-hidden="true"></span><span>${esc(t("questsFullSet"))}</span><b>+${r.fullSet} XP</b></li>
            ${r.streakBonus ? `<li><span class="icon icon-flame icon-14" aria-hidden="true"></span><span>${esc(t("questsRewardStreak", { n: every }))}</span><b>+${r.streakBonus} XP</b></li>` : ""}
          </ul>
        </section>
        <section class="qd-card qd-stats">
          <h3>${esc(t("questsStatsTitle"))}</h3>
          <ul>
            ${stat("list-check", t("questsStatMissions"), _daily.missionsDone)}
            ${stat("clock", t("questsStatDays"), _daily.days)}
            ${stat("flame", t("questsStatStreak"), t("questsDays", { n: streak }))}
            ${stat("star-fill", t("questsStatBest"), t("questsDays", { n: _daily.bestStreak || 0 }))}
            ${stat("bars", t("questsStatXp"), `${(_daily.xp || 0).toLocaleString(_ctx.lang?.() || undefined)} XP`)}
          </ul>
        </section>
      </aside>
    </div>
  </div>`;
}
function untilMidnight() {
  const now = new Date(), next = new Date(now); next.setHours(24, 0, 0, 0);
  const m = Math.max(1, Math.round((next - now) / 60e3)), h = Math.floor(m / 60);
  return h ? `${h} h ${String(m % 60).padStart(2, "0")}` : `${m} min`;
}

// One level as a card: its 5 actions with their bars, its state and bonus.
function levelCard(l) {
  const { t, esc } = _ctx;
  const a = _journey?.actions || {}, paid = new Set(_journey?.bonusesPaid || []);
  const waiting = new Set(_journey?.waiting || []), locked = new Set(_journey?.locked || []);
  const name = levelName(l.id);
  const acts = l.actions;
  const done = l.actions.filter(x => (a[x.id] || 0) >= x.target).length;
  const state = paid.has(l.id) ? "won" : waiting.has(l.id) ? "wait" : locked.has(l.id) ? "lock" : "open";
  const chip = state === "won" ? t("questsWon") : state === "wait" ? t("questsWaiting")
      : state === "lock" ? t("questsLocked", { xp: l.enter.toLocaleString() }) : t("questsProgress", { n: done, total: l.actions.length });
  const [title, theme] = name.split(" · ");
  return `
      <section class="qw-panel qw-lcard is-${state}">
        <header class="qw-lchead">
          <div><b>${esc(title)}</b><span class="qw-ltheme">${esc(theme || "")}</span></div>
          <div class="qw-lcmeta"><span class="qw-tstate">${state === "lock" ? `<span class="icon icon-lock icon-10" aria-hidden="true"></span>` : ""}${esc(chip)}</span>
            <span class="qw-bonus">+${l.bonus} XP</span></div>
        </header>
        ${sbar(done, l.actions.length)}
        <ul class="qw-acts">${acts.map(x => {
          const c = Math.min(a[x.id] || 0, x.target), full = c >= x.target;
          return `<li class="qw-act${full ? " is-full" : ""}"><span class="qw-box" aria-hidden="true"></span><span class="qw-act-label">${esc(actionLabel(x.id))}</span>
            ${sbar(c, x.target)}<span class="qw-slab">${x.target > 1 ? `${c}/${x.target}` : ""}${x.xp ? ` +${x.xp}` : ""}</span></li>`;
        }).join("")}</ul>
      </section>`;
}

// Loot: every XP item the account can own, by rarity — legendary on top
// (Tiger devices). Owned items glow; the rest show what they are worth.
// ctx.loot() → [{ id, label, hint, xp, per, n, got, img?, icon?, rarity?, value? }] from the host
// (rarity forces the rung, value replaces the "+XP" text);
// `img` is a file of assets/svg/icons/ drawn as a mask — the url() sits in a CSS
// variable, so it resolves from quests.css (renderer/quests/), hence ../../.
const RARITIES = [["legendary", 800], ["epic", 300], ["rare", 100], ["uncommon", 20], ["common", 0]];
export function questLootHtml() { return lootHtml(); }
function lootHtml() {
  const { t, esc } = _ctx;
  const items = _ctx.loot?.() || [];
  if (!items.length) return "";
  const tiers = RARITIES.map(([id, min], i) => {
    const max = i ? RARITIES[i - 1][1] : Infinity;
    const own = items.filter(x => x.rarity ? x.rarity === id : (x.per || x.xp) >= min && (x.per || x.xp) < max);
    if (!own.length) return "";
    return `
      <div class="qw-rung qw-rung--${id}">
        <div class="qw-rung-name">${esc(t(`questsRarity_${id}`))}</div>
        <div class="qw-loot">${own.map(x => `
          <div class="qw-item${x.got ? " is-got" : ""}">
            <span class="qw-item-ic" aria-hidden="true">${x.img ? `<span class="qw-item-mask" style="--ico:url('../../assets/svg/icons/${x.img}')"></span>` : `<span class="icon icon-${x.icon || "star-fill"} icon-20"></span>`}</span>
            <span class="qw-item-txt"><b>${esc(x.label)}${x.per && x.n ? ` · ${x.n}` : ""}</b><small>${esc(x.hint || "")}</small>
              <span class="qw-item-xp">${x.got ? `<span class="icon icon-check icon-12" aria-hidden="true"></span>` : ""}${esc(x.value || (x.per ? t("xpPerItem", { xp: x.per }) : `+${x.xp} XP`))}</span></span>
          </div>`).join("")}</div>
      </div>`;
  }).join("");
  return `
    <section class="qw-panel qw-ladder">
      <div class="qw-quest-head"><div><span class="qw-eyebrow">${esc(t("questsLoot"))}</span><h2>${esc(t("questsLootTitle"))}</h2></div></div>
      ${tiers}
    </section>`;
}

// Rank nodes (every rank, 5 pips = its levels), then the picked rank's level
// cards, in a carousel.
function journeyHtml(rank) {
  const { t, esc } = _ctx;
  if (!_levels) return `<p class="qw-empty">${esc(t("questsLoading"))}</p>`;
  const paid = new Set(_journey?.bonusesPaid || []);
  const cur = currentRank();
  const nodes = Array.from({ length: RANKS }, (_, i) => {
    const n = i + 1, lv = _levels.filter(l => RANK_IDS[l.rank] === n), ready = lv.length > 0;
    const pips = ready ? lv.map(l => `<i class="${paid.has(l.id) ? "on" : "open"}"></i>`).join("") : "<i></i>".repeat(5);
    const cls = n === rank ? " is-on" : "", st = !ready ? " is-soon" : n < cur ? " is-reached" : n === cur ? " is-here" : "";
    return `<button type="button" class="qw-node${cls}${st}" data-rank="${n}"${ready ? "" : " disabled"}>
      <span class="qw-nicon" aria-hidden="true">${RANK_ICONS[i]}</span><span class="qw-nnum">#${n}</span>
      <span class="qw-nrole">${esc(t(`questRank_${n}`))}</span><span class="qw-nworld">${esc(ready ? t(`questWorld_${n}`) : t("questsComingSoon"))}</span>
      <span class="qw-pips" aria-hidden="true">${pips}</span></button>`;
  }).join("");
  const cards = _levels.filter(l => RANK_IDS[l.rank] === rank).map(l => levelCard(l)).join("");
  return `
    <section class="qw-panel qw-map">
      <div class="qw-quest-head"><div><span class="qw-eyebrow">${esc(t("questsTitle"))}</span><h2>${esc(t("questsJourney"))}</h2></div>
        <span class="qw-where">${RANK_ICONS[cur - 1]} ${esc(t(`questRank_${cur}`))} · ${esc(t(`questWorld_${cur}`))}</span></div>
      <div class="qw-nodes" role="group" aria-label="${esc(t("questsJourney"))}">${nodes}</div>
    </section>
    <div class="qw-carousel">
      <button type="button" class="qw-car-btn" data-car="-1" aria-label="${esc(t("questsPrevLevel"))}"><span class="icon icon-chevron-l icon-14" aria-hidden="true"></span></button>
      <div class="qw-car-track">${cards}</div>
      <button type="button" class="qw-car-btn" data-car="1" aria-label="${esc(t("questsNextLevel"))}"><span class="icon icon-chevron-r icon-14" aria-hidden="true"></span></button>
    </div>
    `;
}
