// Tiger Squad — Deals view (view bar "%"): partner offers for Squad members.
// Nothing about the offers lives in the app: they are the `squadDeals`
// Firestore collection, written only by the TigerHub admin (Admin SDK) and
// readable by Squad members (firestore.rules). No deal → "coming soon".
//
// A deal's status is set in the admin: "active" (claimable) or "archived"
// (over; drafts are never read). "Get my code" = accepting the deal: the
// backend's squadDeal function records squadDeals/{id}/claims/{uid}
// (d.claim, the member's own) and returns the code — the shared one, or for
// codeMode "unique" one code of the deal's pool, the member's for good. Three
// sections:
//   live     — active, inside its window, in the member's league country (or
//              worldwide); accepted and not used yet stays here too
//   history  — "Archived": accepted, then marked used, archived or past its
//              end date — whatever its countries
//   ended    — archived or past its end date and never accepted
// The link is in secret/main, which the rules give only to a member whose XP
// reaches the deal's minXp: below it a live card is locked with the XP to go.

// A text field is a plain string or a { lang: text } map (en as fallback).
const pick = (v, lang) => (v && typeof v === "object" ? v[lang] || v.en || Object.values(v)[0] || "" : v || "");
const ms = v => (v?.toMillis ? v.toMillis() : typeof v === "number" ? v : v ? Date.parse(v) || null : null);
// When the member's claimed code stops being usable: claims/{uid}.expiresAt
// (set by the squadDeal function from the deal's claimDays); a claim made
// before expiresAt existed gets claim time + claimDays. null = no limit.
export function claimExpiry(d) {
  const c = d.claim; if (!c) return null;
  if (c.expiresAt) return ms(c.expiresAt);
  return d.claimDays && ms(c.at) ? ms(c.at) + d.claimDays * 864e5 : null;
}
const isExpired = (d, now) => { const e = claimExpiry(d); return !!e && now > e && !d.claim?.used; };
const byOrder = (a, b) => (a.order ?? 999) - (b.order ?? 999) || (ms(a.endAt) || Infinity) - (ms(b.endAt) || Infinity);

/** The member's deals in their three sections. */
export function sortDeals(docs, country, now = Date.now()) {
  const live = [], history = [], ended = [];
  for (const d of docs) {
    if (d.status !== "active" && d.status !== "archived") continue;
    const to = ms(d.endAt), over = d.status === "archived" || (to && now > to);
    if (d.claim) { (d.claim.used || over || isExpired(d, now) ? history : live).push(d); continue; }
    const cc = Array.isArray(d.countries) ? d.countries : [];
    if (cc.length && !(country && cc.includes(country))) continue;
    const from = ms(d.startAt);
    if (over) ended.push(d);
    else if (!from || now >= from) live.push(d);
  }
  return { live: live.sort(byOrder), history: history.sort(byOrder), ended: ended.sort(byOrder) };
}

// "4 d 23:12:05" — the time left on a claimed code.
function countdown(t, left) {
  const sec = Math.max(0, Math.floor(left / 1000)), p = n => String(n).padStart(2, "0");
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return d ? t("squadDealsDHMS", { d, h: p(h), m: p(m), s: p(s) }) : `${p(h)}:${p(m)}:${p(s)}`;
}

function dealCard(ctx, d, section) {
  const { t, esc, lang, xp = 0 } = ctx;
  const claim = d.claim, used = claim?.used === true;
  const exp = claimExpiry(d), expired = !used && !!exp && Date.now() > exp;
  const code = expired ? "" : claim?.code || "";   // an expired code disappears
  const locked = section === "live" && !claim && (d.minXp || 0) > xp;
  const unique = d.codeMode === "unique", left = Math.max(0, (d.stock || 0) - (d.claimed || 0));
  const title = pick(d.title, lang), desc = pick(d.description, lang);
  const to = ms(d.endAt);
  const link = d.secret?.link || "", safeLink = /^https:\/\//i.test(link) ? link : "";
  const safeImg = /^https:\/\//i.test(d.image || "") ? d.image : "";
  const tag = used ? ["is-used", "check", "squadDealsUsed"] : expired ? ["is-ended", "clock", "squadDealsExpired"]
    : section !== "live" ? ["is-ended", "clock", "squadDealsEnded"] : null;
  let actions = "";
  if (locked) actions = `
        <div class="sqd-lock">
          <span class="sqd-lock-head"><span class="icon icon-lock icon-13" aria-hidden="true"></span><b>${esc(t("squadDealsLocked", { xp: (d.minXp || 0).toLocaleString(lang) }))}</b></span>
          <span class="sqd-lock-bar" style="--p:${Math.min(100, Math.round(xp / Math.max(1, d.minXp || 1) * 100))}%"></span>
          <small>${esc(t("squadDealsToGo", { xp: Math.max(0, (d.minXp || 0) - xp).toLocaleString(lang) }))}</small>
        </div>`;
  else if (section !== "ended") actions = `
        <div class="sqd-card-actions">
          ${!code ? (unique && !left ? `<span class="sqd-left">${esc(t("squadDealsSoldOut"))}</span>` : `<button type="button" class="sqd-open sqd-get" data-deal="${esc(d.id)}">${esc(t("squadDealsGet"))}</button>
            ${unique ? `<span class="sqd-left">${esc(t("squadDealsLeft", { n: left.toLocaleString(lang) }))}</span>` : ""}`) : ""}
          ${code ? `<button type="button" class="sqd-code" data-code="${esc(code)}" aria-label="${esc(t("squadDealsCopy"))}"><b>${esc(code)}</b><span class="icon icon-copy icon-13" aria-hidden="true"></span></button>` : ""}
          ${code && safeLink ? `<a class="sqd-open" href="${esc(safeLink)}" target="_blank" rel="noopener">${esc(t("squadDealsOpen"))}<span class="icon icon-arrow-up-right icon-12" aria-hidden="true"></span></a>` : ""}
          ${code && !used && section === "live" ? `<button type="button" class="sqd-mark" data-deal="${esc(d.id)}"><span class="icon icon-check icon-12" aria-hidden="true"></span>${esc(t("squadDealsMarkUsed"))}</button>` : ""}
        </div>
        ${code && exp && !used && section === "live" ? `<div class="sqd-timer" data-exp="${exp}"><span class="icon icon-clock icon-12" aria-hidden="true"></span><span>${esc(t("squadDealsTimeLeft", { time: countdown(t, exp - Date.now()) }))}</span></div>` : ""}
        ${!claim && d.claimDays && section === "live" && !locked ? `<small class="sqd-claimdays">${esc(t("squadDealsClaimDays", { n: d.claimDays }))}</small>` : ""}`;
  return `
    <article class="sqd-card${locked ? " is-locked" : ""}${tag ? " " + tag[0] : ""}">
      <div class="sqd-card-art">${safeImg ? `<img src="${esc(safeImg)}" alt="" loading="lazy">` : `<span class="icon icon-percent" aria-hidden="true"></span>`}
        ${d.badge ? `<span class="sqd-card-badge">${esc(pick(d.badge, lang))}</span>` : ""}</div>
      <div class="sqd-card-body">
        ${d.partner || tag ? `<span class="sqd-card-partner">${esc(d.partner || "")}${tag ? `<span class="sqd-used-tag"><span class="icon icon-${tag[1]} icon-11" aria-hidden="true"></span>${esc(t(tag[2]))}</span>` : ""}</span>` : ""}
        <h3>${esc(title)}</h3>
        ${desc ? `<p>${esc(desc)}</p>` : ""}
        <div class="sqd-card-meta">
          ${to && section === "live" ? `<span><span class="icon icon-clock icon-12" aria-hidden="true"></span>${esc(t("squadDealsUntil", { date: new Date(to).toLocaleDateString(lang) }))}</span>` : ""}
          ${!(d.countries || []).length ? `<span><span class="icon icon-globe icon-12" aria-hidden="true"></span>${esc(t("squadDealsWorld"))}</span>` : ""}
        </div>${actions}
      </div>
    </article>`;
}

/** The whole view: hero banner, then the live deals ("coming soon" when there
 *  is none), the member's Archived history and the ended deals. */
export function dealsViewHtml(ctx, { live, history, ended }) {
  const { t, esc } = ctx;
  const group = (list, section, key) => list.length ? `
    ${key ? `<h3 class="sqd-arch-h">${esc(t(key))} <span>${list.length}</span></h3>` : ""}
    <div class="sqd-grid${key ? " sqd-grid--arch" : ""}">${list.map(d => dealCard(ctx, d, section)).join("")}</div>` : "";
  const body = live.length || history.length || ended.length ? `
    ${live.length ? group(live, "live") : `<section class="sqd-soon sqd-soon--slim"><h3>${esc(t("squadDealsSoon"))}</h3><p>${esc(t("squadDealsSoonBody"))}</p></section>`}
    ${group(history, "history", "squadDealsArchived")}
    ${group(ended, "ended", "squadDealsEndedTitle")}` : `
    <section class="sqd-soon">
      <span class="sqd-soon-ic" aria-hidden="true"><span class="icon icon-percent"></span></span>
      <h3>${esc(t("squadDealsSoon"))}</h3>
      <p>${esc(t("squadDealsSoonBody"))}</p>
    </section>`;
  return `
    <section class="sqr-hero sqd-hero">
      <div class="sqr-hero-txt">
        <h2><span>TIGER</span><span class="sqr-hero-orange">SQUAD</span></h2>
        <p class="sqr-hero-sub">${esc(t("squadDeals"))}</p>
        <p class="sqr-hero-tag"><span class="icon icon-percent icon-14" aria-hidden="true"></span>${esc(t("squadDealsSub"))}</p>
      </div>
      <div class="sqd-scene" aria-hidden="true">
        <span class="sqd-coin sqd-coin--a">%</span>
        <span class="sqi-tiger">
          <img class="sqi-tiger-back" src="../assets/img/tigersquad/legendary/tiger.webp" alt="">
          <img class="sqi-tiger-front" src="../assets/img/tigersquad/legendary/tiger-front.webp" alt="">
        </span>
        <span class="sqd-coin sqd-coin--b">%</span>
      </div>
    </section>
    ${body}`;
}

/** Copy-code, "Get my code" and "I used it": one delegated listener on the
 *  view host; the two server actions go through ctx.onAction(action, dealId). */
export function wireDeals(host, ctx) {
  host._sqdCtx = ctx;
  if (host._sqdWired) return;
  host._sqdWired = true;
  // The countdowns tick every second while the view is shown; one that
  // reaches zero repaints the view (the code goes, the deal moves to Archived).
  setInterval(() => {
    if (!host.isConnected || host.classList.contains("hidden")) return;
    const c = host._sqdCtx;
    for (const el of host.querySelectorAll(".sqd-timer[data-exp]")) {
      const left = Number(el.dataset.exp) - Date.now();
      if (left <= 0) { c.onExpire?.(); return; }
      el.lastElementChild.textContent = c.t("squadDealsTimeLeft", { time: countdown(c.t, left) });
    }
  }, 1000);
  host.addEventListener("click", async e => {
    const act = e.target.closest(".sqd-get, .sqd-mark");
    if (act) {
      if (act.disabled) return;
      act.disabled = true;
      try { await ctx.onAction(act.classList.contains("sqd-get") ? "claim" : "used", act.dataset.deal); }
      catch (_) { act.disabled = false; ctx.toast?.(ctx.t("squadDealsErr")); }
      return;
    }
    const b = e.target.closest(".sqd-code"); if (!b) return;
    navigator.clipboard?.writeText(b.dataset.code).then(() => {
      b.classList.add("is-copied");
      b.setAttribute("aria-label", ctx.t("squadDealsCopied"));
      setTimeout(() => { b.classList.remove("is-copied"); b.setAttribute("aria-label", ctx.t("squadDealsCopy")); }, 1600);
    }).catch(() => {});
  });
}
