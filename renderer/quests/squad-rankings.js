/**
 * quests/squad-rankings.js — the TigerSquad → Rankings view (main area).
 *
 * Display only. The host (inventory.js `_openSquadBoard`, inline mode) owns the
 * data and calls these with it:
 *   members  — [{ uid, name, profile, tier, xp, country }] from userProfiles.tigerSquad
 *              (the order and the ties are the host's: XP, highest first, stable)
 *   pulse    — publicStats/community (xpTotal, accounts, spools {…}, printers {total, byBrand}, updatedAt)
 *   history  — publicStats/community/history/{day}, oldest first ({ day, xpTotal, spools, printers })
 * Nothing here writes, counts XP or ranks differently from the existing board.
 *
 *   squadHeroHtml(ctx, members)       — banner + the account's rank card (every tab)
 *   squadRankingsHtml(ctx, data)      — Community pulse strip, the three leagues
 *   (the account's rank lives in the hero card only)
 *   ctx = { uid, t, esc, fmt, cname, flagOf, avatar(member) → html, tierLabel(tier),
 *           brandLabel(id), lang, squadXp (number|null), myCountry }
 */
const MEDAL = n => `<img class="sqr-medal" src="../assets/img/tigersquad/rank-medal-${n}.webp" alt="#${n}">`;
const PREVIEW = 5;                // fewest rows shown before "View all"
// Rows per league column — at least PREVIEW, more when the view has room
// (set by the host after measuring, see setLeagueRows).
let _rows = PREVIEW;
export function leagueRows() { return _rows; }
export function setLeagueRows(n) {
  const v = Math.max(PREVIEW, Math.min(40, n | 0));
  if (v === _rows) return false;
  _rows = v;
  return true;
}
const _expanded = new Set();      // league columns opened with "View all" (kept across renders)

export function toggleLeague(key) {
  if (_expanded.has(key)) _expanded.delete(key); else _expanded.add(key);
}

// Ranked world list and the derived ranks the panels share.
function ranks(ctx, members) {
  const world = [...members].sort((a, b) => b.xp - a.xp);
  const me = world.find(m => m.uid === ctx.uid) || null;
  const cc = me?.country || ctx.myCountry || null;
  const nat = cc ? world.filter(m => m.country === cc) : [];
  const by = new Map();
  for (const m of members) if (m.country) { const c = by.get(m.country) || { cc: m.country, xp: 0, n: 0 }; c.xp += m.xp; c.n++; by.set(m.country, c); }
  const countries = [...by.values()].sort((a, b) => b.xp - a.xp || b.n - a.n);
  return { world, me, cc, nat, countries,
    worldRank: me ? world.indexOf(me) + 1 : 0,
    natRank: me && cc ? nat.indexOf(me) + 1 : 0 };
}

// Rank movement since the start of the day: the server writes the leagues'
// ranks at the first minute of each Paris day (squadRanks/current, see the
// backend's communityStats), the host passes it as ctx.rankBase, and each row
// shows the difference with its live rank. No baseline → no arrows.
function rankMoves(base, ids) {
  const now = {};
  ids.forEach((id, i) => { now[id] = i + 1; });
  return id => (base && base[id] && now[id] ? base[id] - now[id] : 0);
}
const ARROW = up => `<svg viewBox="0 0 10 8" aria-hidden="true"><path d="${up ? "M5 0 10 8H0z" : "M5 8 0 0h10z"}"/></svg>`;
const moveHtml = d => d ? `<small class="sqr-move ${d > 0 ? "is-up" : "is-down"}">${ARROW(d > 0)}${Math.abs(d)}</small>` : "";

// A country shown like a member: a round "avatar" with its flag inside
// (assets/svg/flags, flag-icons 1x1), instead of an emoji.
// `podium` (1-3) rings it gold / silver / bronze, like the medal next to it.
const flagAv = (cc, size, podium = 0) => /^[a-z]{2}$/i.test(cc || "")
  ? `<span class="sqr-flagav${podium >= 1 && podium <= 3 ? ` sqr-flagav--p${podium}` : ""}" style="--s:${size}px"><img src="../assets/svg/flags/${cc.toLowerCase()}.svg" alt="" loading="lazy" decoding="async"></span>`
  : "";

// ── Hero ─────────────────────────────────────────────────────────────────────
export function squadHeroHtml(ctx, members) {
  const { t, esc, fmt } = ctx;
  const r = ranks(ctx, members);
  // The account's rank card (the one place the page shows it): who, league, XP,
  // national + world rank, and the next rival with the real XP gap.
  const above = r.me ? r.world.slice(0, r.worldRank - 1).reverse().find(m => m.xp > r.me.xp) || null : null;
  const tied = r.me ? r.world.find(m => m !== r.me && m.xp === r.me.xp) : null;
  const card = r.me ? `
      <div class="sqr-card sq-${r.me.tier}">
        <div class="sqr-card-me">
          <span class="sqr-card-av">${ctx.avatar(r.me)}</span>
          <span class="sqr-card-head"><b class="sqr-card-name">${esc(r.me.name)}</b>
            <span class="sqr-card-league"><img src="../assets/img/tigersquad/tigersquad-${r.me.tier}.webp" alt="">${esc(t("squadLeagueName", { tier: ctx.tierLabel(r.me.tier) }))}</span>
            <b class="sqr-card-xp">${esc(fmt(r.me.xp))} XP</b></span>
        </div>
        <div class="sqr-card-ranks">
          ${r.natRank ? `<span class="sqr-card-ic" aria-hidden="true">${flagAv(r.cc, 20)}</span>
            <span class="sqr-card-rank"><b>#${r.natRank}</b> ${esc(t("squadInCountry", { country: ctx.cname(r.cc) }))}</span>` : ""}
          <span class="sqr-card-ic" aria-hidden="true"><span class="icon icon-globe icon-20"></span></span>
          <span class="sqr-card-rank"><b>#${r.worldRank}</b> ${esc(t("squadWorldwide"))}</span>
        </div>
        <div class="sqr-card-rival">
          <span class="sqr-me-label">${esc(t("squadNextRival"))}</span>
          ${above ? `<div class="sqr-rival-who">${ctx.avatar(above)}<span class="sqr-rival-txt"><b>${esc(above.name)}</b>
              <small>${esc(t("squadXpToGo", { xp: fmt(above.xp - r.me.xp) }))}</small></span>
              <span class="icon icon-chevron-r icon-14" aria-hidden="true"></span></div>
            <span class="sqr-bar" aria-hidden="true"><i style="width:${Math.max(2, Math.min(100, Math.round(r.me.xp / Math.max(1, above.xp) * 100)))}%"></i></span>`
            : `<b class="sqr-top">${esc(t("squadTopSpot"))}</b>`}
          ${tied ? `<small class="sqr-muted">${esc(t("squadTiedWith", { name: tied.name }))}</small>` : ""}
        </div>
      </div>`
    : `
      <div class="sqr-card sqr-card--out">
        <div class="sqr-card-me"><b class="sqr-card-name">${esc(t("squadNotRanked"))}</b>
          ${typeof ctx.squadXp === "number" ? `<b class="sqr-card-xp">${esc(fmt(ctx.squadXp))} XP</b>` : ""}
          <p class="sqr-muted">${esc(t("squadNotRankedHow"))}</p>
          <button type="button" class="sqr-join" data-next="join">${esc(t("squadJoin"))}</button></div>
      </div>`;
  return `
    <section class="sqr-hero">
      <div class="sqr-hero-txt">
        <h2><span>TIGER</span><span class="sqr-hero-orange">SQUAD</span></h2>
        <p class="sqr-hero-sub">${esc(t("squadHeroSub"))}</p>
        <p class="sqr-hero-tag"><span class="icon icon-star-fill icon-14" aria-hidden="true"></span>${esc(t("squadHeroTagline"))}</p>
      </div>
      <div class="hero-scene" aria-hidden="true"></div>
      ${members.length ? card : ""}
    </section>`;
}

// ── Rankings tab ─────────────────────────────────────────────────────────────
export function squadRankingsHtml(ctx, { members, loading, pulse, history }) {
  return `${pulseHtml(ctx, pulse, history)}${leaguesHtml(ctx, members, loading)}`;
}

// ── Community pulse ──────────────────────────────────────────────────────────
// Sparkline from the daily history (real points only; none → no line).
function spark(values) {
  const v = values.filter(x => Number.isFinite(x));
  if (v.length < 2) return "";
  const min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
  const pts = v.map((y, i) => [i / (v.length - 1) * 100, 34 - (y - min) / span * 30]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  return `<svg class="sqr-spark" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true">
    <path class="sqr-spark-area" d="${line} L100 36 L0 36 Z"/><path class="sqr-spark-line" d="${line}"/></svg>`;
}
// One compact strip: what it is, then three stats (icon, label, value, a line
// of context, a small sparkline over the real daily history when there is one).
export function pulseHtml(ctx, pulse, history) {
  const { t, esc, fmt } = ctx;
  // The intro carries the context: what it is, how many accounts, when it was updated.
  const intro = `<div class="sqr-pulse-intro"><span class="icon icon-globe icon-24" aria-hidden="true"></span>
    <div><h3>${esc(t("squadPulse"))}</h3><p>${esc(t("squadPulseSub"))}</p>
      ${pulse ? `<p class="sqr-pulse-meta">${esc(t("squadPulseXpSub", { n: fmt(pulse.accounts) }))}${pulse.updatedAt ? ` · <span class="sqr-updated">${esc(t("squadPulseUpdated", { ago: ctx.ago(pulse.updatedAt) }))}</span>` : ""}</p>` : ""}</div></div>`;
  if (!pulse) return `<section class="sqr-pulse">${intro}<p class="sqr-muted sqr-unavail">${esc(t(pulse === null ? "squadPulseUnavailable" : "questsLoading"))}</p></section>`;
  const h = history || [];
  // The XP curve starts with the TigerSquad (older days carry no XP).
  const xpH = h.filter(d => Number.isFinite(d.xpTotal) && d.xpTotal > 0).map(d => d.xpTotal);
  const spools = h.map(d => d.spools?.total), printers = h.map(d => typeof d.printers === "number" ? d.printers : d.printers?.total);
  // data-roll / data-v: the host rolls each number to its value and pops the
  // gain ("+40 XP") when it goes up — see _rollPulse in inventory.js.
  const stat = (cls, icon, label, value, sub, series, unit = "") => `
    <article class="sqr-stat sqr-stat--${cls}">
      <span class="icon icon-${icon} icon-24" aria-hidden="true"></span>
      <div class="sqr-stat-txt"><span class="sqr-stat-label">${esc(label)}</span><b class="sqr-stat-n" data-roll="${cls}" data-v="${Number(value) || 0}" data-unit="${unit}">${esc(fmt(value))}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</div>
      ${spark(series)}
    </article>`;
  return `
    <section class="sqr-pulse">${intro}
      ${stat("xp", "bolt", t("squadPulseXp"), pulse.xpTotal, "", xpH, "XP")}
      ${stat("spools", "package", t("squadPulseSpools"), pulse.spools?.total, "", spools)}
      ${stat("printers", "printer", t("squadPulsePrinters"), pulse.printers?.total, "", printers)}
    </section>`;
}

// ── Leagues ──────────────────────────────────────────────────────────────────
// Each column shows its top rows, plus the account's own row when it ranks
// lower; "View all" opens the full list in place.
// The column icon already shows the flag: drop the {{flag}} slot's leftover space.
const noFlag = text => text.replace(/\s+/g, " ").trim();
function rankCell(i) { return i < 3 ? MEDAL(i + 1) : `<span class="sqr-rank">#${i + 1}</span>`; }
// No subtitle: the account's own ranks are in the hero card.
function column(ctx, key, title, icon, rows, isMe, rowHtml) {
  const { t, esc } = ctx;
  const open = _expanded.has(key);
  const meAt = rows.findIndex(isMe);
  // When the account ranks below the cut, its row takes the last slot, so all
  // three columns keep the same number of rows (and the same height).
  const far = !open && meAt >= _rows;
  const shown = open ? rows.map((r, i) => [r, i]) : rows.slice(0, far ? _rows - 1 : _rows).map((r, i) => [r, i]);
  const tail = far ? rowHtml(rows[meAt], meAt).replace('class="sqr-row', 'class="sqr-row sqr-row--far') : "";
  return `
    <section class="sqr-board">
      <header class="sqr-board-head"><span class="sqr-board-ic" aria-hidden="true">${icon}</span>
        <div><h3>${esc(title)}</h3></div>
        ${rows.length > _rows ? `<button type="button" class="sqr-all" data-sqr-all="${key}" aria-expanded="${open}">${esc(t(open ? "squadShowLess" : "squadViewAll"))}</button>` : ""}
      </header>
      <ol class="sqr-rows">${shown.map(([r, i]) => rowHtml(r, i)).join("")}${tail}</ol>
    </section>`;
}
function leaguesHtml(ctx, members, loading) {
  const { t, fmt, esc } = ctx;
  if (loading) return `<div class="sqr-boards">${[0, 1, 2].map(() => `<section class="sqr-board"><div class="sqr-skel sqr-skel--board"></div></section>`).join("")}</div>`;
  const r = ranks(ctx, members);
  const base = ctx.rankBase || {};
  const mvW = rankMoves(base.world, r.world.map(m => m.uid));
  const mvN = r.cc ? rankMoves(base.national?.[r.cc], r.nat.map(m => m.uid)) : () => 0;
  const mvC = rankMoves(base.countries, r.countries.map(c => c.cc));
  const memberRow = (withFlag, mv) => (m, i) => `
    <li class="sqr-row${m.uid === ctx.uid ? " is-me" : ""}">${rankCell(i)}
      <span class="sqr-av">${ctx.avatar(m)}</span>
      <span class="sqr-name"><b>${esc(m.name)}${withFlag && m.country ? ` <span class="sqr-mini">${flagAv(m.country, 14)}<small>#${r.world.filter(x => x.country === m.country).indexOf(m) + 1}</small></span>` : ""}</b>
        <small class="sq-${m.tier}">${esc(ctx.tierLabel(m.tier))}</small></span>
      <span class="sqr-xp">${esc(fmt(m.xp))} XP${moveHtml(mv(m.uid))}</span></li>`;
  const countryRow = (c, i) => `
    <li class="sqr-row${c.cc === r.cc ? " is-me" : ""}">${rankCell(i)}
      <span class="sqr-av" aria-hidden="true">${flagAv(c.cc, 34, i + 1)}</span>
      <span class="sqr-name"><b>${esc(ctx.cname(c.cc))}</b><small>${esc(t("squadMembers", { n: c.n }))}</small></span>
      <span class="sqr-xp">${esc(fmt(c.xp))} XP${moveHtml(mvC(c.cc))}</span></li>`;
  const globe = `<span class="icon icon-globe icon-24"></span>`;
  return `
    <div class="sqr-boards">
      ${column(ctx, "countries", t("squadCountryLabel"), globe, r.countries, c => c.cc === r.cc, countryRow)}
      ${r.cc ? column(ctx, "national", noFlag(t("squadColNational", { flag: "", country: ctx.cname(r.cc) })),
        flagAv(r.cc, 36), r.nat, m => m.uid === ctx.uid, memberRow(false, mvN)) : ""}
      ${column(ctx, "world", t("squadColWorld"), globe, r.world, m => m.uid === ctx.uid, memberRow(true, mvW))}
    </div>`;
}
