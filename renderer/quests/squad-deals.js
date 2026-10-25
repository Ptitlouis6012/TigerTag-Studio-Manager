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

import { revealPulls } from './coin-pull.js';
import { ambientStart, ambientStop } from './coin-sound.js';

// A text field is a plain string or a { lang: text } map (en as fallback).
const pick = (v, lang) => (v && typeof v === "object" ? v[lang] || v.en || Object.values(v)[0] || "" : v || "");
const ms = v => (v?.toMillis ? v.toMillis() : typeof v === "number" ? v : v ? Date.parse(v) || null : null);
// When the member's claimed code stops being usable: claims/{uid}.expiresAt
// (set by the squadDeal function from the deal's claimDays); a claim made
// before expiresAt existed gets claim time + claimDays. null = no limit.
// A badge that just says "free" in TigerHub: the app writes "Free" in the reader's language.
const FREE_BADGE = /^(free|offert|offerts|gratuit|gratis)$/i;
// The last 3 days of a claimed code: its countdown turns red and pulses — use it now.
const SOON_MS = 3 * 864e5;
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
    // An announcement is information: shown while active, in its window and
    // its countries, among the live deals (by order) — never history or ended.
    if (d.kind === "announcement") {
      const cc = Array.isArray(d.countries) ? d.countries : [], from = ms(d.startAt);
      if (!over && (!from || now >= from) && (!cc.length || (country && cc.includes(country)))) live.push(d);
      continue;
    }
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

// A limited deal (codeMode "unique": a pool of `stock` codes, `claimed` handed
// out) shows its stock as a gauge — how many are gone, how many are left, and
// "Only N left!" once a tenth or fewer remain.
function stockGauge(t, esc, d, lang, big) {
  const total = d.stock || 0, taken = Math.min(total, d.claimed || 0), left = total - taken;
  if (!total) return "";
  const pct = Math.round(taken / total * 100), low = left > 0 && left <= Math.max(3, Math.ceil(total / 10));
  const n = v => v.toLocaleString(lang);
  return `<div class="sqd-stock${low ? " is-low" : ""}${left ? "" : " is-out"}${big ? " is-big" : ""}">
          ${big ? `<span class="sqd-stock-head"><b>${esc(t("squadDealsClaimedOf", { n: n(taken), total: n(total) }))}</b></span>` : ""}
          <span class="sqd-stock-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${taken}"><i style="width:${pct}%"></i></span>
          <span class="sqd-stock-txt">${esc(low ? t("squadDealsLastOnes", { n: n(left) }) : t("squadDealsStock", { left: n(left), total: n(total) }))}</span>
        </div>`;
}

// The badge already shows the discount on the illustration: a title ending
// with it ("Polo TigerTag -10 %") drops that ending ("Polo TigerTag").
const stripDiscount = s => s.replace(/\s*[-−–]\s*\d+(?:[.,]\d+)?\s*%\s*$/, "") || s;

// Everything a deal shows, computed once for its grid card and its side card.
function dealParts(ctx, d, section) {
  const { t, esc, lang, xp = 0 } = ctx;
  const claim = d.claim, used = claim?.used === true;
  const exp = claimExpiry(d), expired = !used && !!exp && Date.now() > exp;
  const code = expired ? "" : claim?.code || "";   // an expired code disappears
  // codeMode "link": no code — claiming unlocks the link, with the same countdown.
  const linkOnly = d.codeMode === "link";
  const got = !!claim && !expired && (linkOnly || !!code);   // claimed and still usable
  const locked = section === "live" && !claim && (d.minXp || 0) > xp;
  const unique = d.codeMode === "unique", left = Math.max(0, (d.stock || 0) - (d.claimed || 0));
  const link = d.secret?.link || "", safeLink = /^https:\/\//i.test(link) ? link : "";
  const safeImg = /^https:\/\//i.test(d.image || "") ? d.image : "";
  const tag = used ? ["is-used", "check", "squadDealsUsed"] : expired ? ["is-ended", "clock", "squadDealsExpired"]
    : section !== "live" ? ["is-ended", "clock", "squadDealsEnded"] : null;
  const timer = got && exp && !used && section === "live"
    ? `<div class="sqd-timer${exp - Date.now() < SOON_MS ? " is-soon" : ""}" data-exp="${exp}"><span class="icon icon-clock icon-12" aria-hidden="true"></span><span>${esc(t("squadDealsTimeLeft", { time: countdown(t, exp - Date.now()) }))}</span></div>` : "";
  // A deal paid in TigerCoins with no badge of its own reads "Free" (never "0 €"),
  // and so does a badge set to "free" in TigerHub (a gift: "5 € on us" is free,
  // not "-5 €") — shown in the reader's language.
  // hideBadge (set in TigerHub): the picture already says it, no badge at all.
  const freeBadge = FREE_BADGE.test(String(pick(d.badge, lang) || "").trim());
  const free = freeBadge || (!d.badge && d.costCoins > 0);
  const badge = d.hideBadge ? "" : free ? t("squadDealsFree") : d.badge ? pick(d.badge, lang) : "";
  const art = `${safeImg ? `<img src="${esc(safeImg)}" alt="" loading="lazy">` : `<span class="icon icon-percent" aria-hidden="true"></span>`}
        ${badge ? `<span class="sqd-card-badge ${badgeKind(badge, free)}">${esc(badge)}</span>` : ""}${timer}`;
  const partner = d.partner || tag ? `<span class="sqd-card-partner">${esc(d.partner || "")}${tag ? `<span class="sqd-used-tag"><span class="icon icon-${tag[1]} icon-11" aria-hidden="true"></span>${esc(t(tag[2]))}</span>` : ""}</span>` : "";
  // costCoins: the deal is paid in TigerCoins (functions/tigerCoins.js, squadDeals.js).
  const cost = Math.max(0, Number(d.costCoins) || 0), coins = ctx.coins?.balance ?? 0, afford = !cost || coins >= cost;
  return { claim, used, exp, code, got, linkOnly, locked, unique, left, safeLink, tag, art, partner, cost, afford, coinsShort: Math.max(0, cost - coins),
    title: d.badge && !d.hideBadge && !freeBadge ? stripDiscount(pick(d.title, lang)) : pick(d.title, lang), desc: pick(d.description, lang), to: ms(d.endAt) };
}

// The grid card: illustration, partner, title and one state line — the
// description and every action are in the side card it opens.
function dealCard(ctx, d, section) {
  if (d.kind === "announcement") return annCard(ctx, d);
  const { t, esc, lang, xp = 0 } = ctx;
  const p = dealParts(ctx, d, section);
  // One state line: locked (XP to go), code claimed, sold out, or available.
  const line = (cls, icon, text) => `<span class="sqd-card-state ${cls}">${icon ? `<span class="icon icon-${icon} icon-12" aria-hidden="true"></span>` : "<i></i>"}${esc(text)}</span>`;
  const state = section !== "live" || p.used ? ""
    : p.locked ? line("is-locked", "lock", t("squadDealsToGo", { xp: Math.max(0, (d.minXp || 0) - xp).toLocaleString(lang) }))
    : p.got ? line("is-code", "check", t(p.linkOnly ? "squadDealsUnlocked" : "squadDealsGotIt"))
    : p.unique && !p.left ? line("is-out", "", t("squadDealsSoldOut"))
    : p.cost ? `<span class="sqd-card-state is-cost${p.afford ? "" : " is-short"}"><span class="tcoin" aria-hidden="true"></span>${esc(t("coinsBalance", { n: p.cost.toLocaleString(lang) }))}</span>`
    : line("is-free", "", t(p.linkOnly ? "squadDealsOfferAvailable" : "squadDealsAvailable"));
  // For the filter bar: "My codes" and the search read these.
  const mine = p.got && !p.used && section === "live";
  const q = [p.title, d.partner, p.desc].filter(Boolean).join(" ").toLowerCase();
  return `
    <article class="sqd-card${p.locked ? " is-locked" : ""}${p.tag ? " " + p.tag[0] : ""}${ctx.openId === d.id ? " is-selected" : ""}" data-open="${esc(d.id)}" data-mine="${mine ? 1 : 0}" data-coins="${p.cost ? 1 : 0}" data-q="${esc(q)}" tabindex="0" role="button" aria-label="${esc(p.title)}">
      <div class="sqd-card-art">${p.art}</div>
      <div class="sqd-card-body">
        ${p.partner}
        <h3>${esc(p.title)}</h3>
        ${state}
        ${p.unique && section === "live" && !p.used ? stockGauge(t, esc, d, lang, false) : ""}
      </div>
    </article>`;
}

// The side card (right, like a spool's detail panel): the whole deal and its
// actions. One per deal in the page; the open one carries `is-open` (kept
// across repaints through ctx.openId). Closed by the app's » tab on its left
// edge (.pp-close-tab, one for the view), the grid card again, or Esc.
function dealSide(ctx, d, section) {
  if (d.kind === "announcement") return annSide(ctx, d);
  const { t, esc, lang, xp = 0 } = ctx;
  const p = dealParts(ctx, d, section);
  // Two steps: get the code, then use it ("I used it", held).
  const steps = section === "live" && !p.locked ? `
        <ol class="sqd-steps">
          <li class="${p.got || p.used ? "is-done" : "is-current"}"><span>${p.got || p.used ? `<span class="icon icon-check icon-11" aria-hidden="true"></span>` : "1"}</span>${esc(t(p.linkOnly ? "squadDealsUnlock" : "squadDealsStepGet"))}</li>
          <li class="${p.used ? "is-done" : p.got ? "is-current" : ""}"><span>${p.used ? `<span class="icon icon-check icon-11" aria-hidden="true"></span>` : "2"}</span>${esc(t("squadDealsStepUse"))}</li>
        </ol>` : "";
  let actions = "";
  if (p.locked) actions = `
        <div class="sqd-lock">
          <span class="sqd-lock-head"><span class="icon icon-lock icon-13" aria-hidden="true"></span><b>${esc(t("squadDealsLocked", { xp: (d.minXp || 0).toLocaleString(lang) }))}</b></span>
          <span class="sqd-lock-bar" style="--p:${Math.min(100, Math.round(xp / Math.max(1, d.minXp || 1) * 100))}%"></span>
          <small>${esc(t("squadDealsToGo", { xp: Math.max(0, (d.minXp || 0) - xp).toLocaleString(lang) }))}</small>
        </div>`;
  else if (section !== "ended") actions = `
        <div class="sqd-side-actions">
          ${!p.got ? (p.unique && !p.left ? `<span class="sqd-left">${esc(t("squadDealsSoldOut"))}</span>` : (p.cost ? `<button type="button" class="sqd-open sqd-wide sqd-get sqd-spend" data-deal="${esc(d.id)}"${p.afford ? "" : " disabled"}><span class="tcoin" aria-hidden="true"></span>${esc(t("coinsSpend", { n: p.cost.toLocaleString(lang) }))}</button>
            ${p.afford ? "" : `<small class="sqd-coins-short">${esc(t("coinsToGo", { n: p.coinsShort.toLocaleString(lang) }))}</small>`}`
            : `<button type="button" class="sqd-open sqd-wide sqd-get" data-deal="${esc(d.id)}">${esc(t(p.linkOnly ? "squadDealsUnlock" : "squadDealsGet"))}</button>`)) : ""}
          ${/* Used or archived: the code is spent — stars in its place, nothing to copy,
               and no link (the shop link carries the code to apply it). */""}
          ${p.code ? (p.used || section !== "live" ? `<div class="sqd-code-row is-spent"><code aria-hidden="true">********</code></div>`
            : `<div class="sqd-code-row"><code>${esc(p.code)}</code><button type="button" class="sqd-code" data-code="${esc(p.code)}"><span class="icon icon-copy icon-13" aria-hidden="true"></span><span class="sqd-code-lbl">${esc(t("squadDealsCopyBtn"))}</span></button></div>`) : ""}
          ${p.got && p.safeLink && !p.used && section === "live" ? `<a class="sqd-open sqd-wide" href="${esc(p.safeLink)}" target="_blank" rel="noopener">${esc(t("squadDealsOpen"))}<span class="icon icon-arrow-up-right icon-12" aria-hidden="true"></span></a>` : ""}
          ${p.got && !p.used && section === "live" ? `<button type="button" class="sqd-mark sqd-wide" data-deal="${esc(d.id)}"><span class="hold-progress" aria-hidden="true"></span><span class="icon icon-check icon-12" aria-hidden="true"></span><span>${esc(t("squadDealsMarkUsed"))}</span></button>` : ""}
        </div>`;
  const foot = section === "live" && !p.used && d.claimDays ? `<small class="sqd-side-foot"><span class="icon icon-clock icon-12" aria-hidden="true"></span>${esc(t("squadDealsClaimDays", { n: d.claimDays }))}</small>` : "";
  return `
    <aside class="sqd-side${ctx.openId === d.id ? " is-open" : ""}${p.locked ? " is-locked" : ""}" data-side="${esc(d.id)}" aria-label="${esc(p.title)}">
      <header class="sqd-side-head">${esc(t("squadDealsDetail"))}</header>
      <div class="sqd-side-art"><div class="sqd-card-art">${p.art}</div></div>
      <div class="sqd-side-body">
        ${p.partner}
        <h2>${esc(p.title)}</h2>
        ${p.desc ? `<p>${esc(p.desc)}</p>` : ""}
        <div class="sqd-card-meta">
          ${!(d.countries || []).length ? `<span><span class="icon icon-globe icon-12" aria-hidden="true"></span>${esc(t("squadDealsWorld"))}</span>` : ""}
          <span><span class="icon icon-tag icon-12" aria-hidden="true"></span>${esc(t("squadDealsOnePer"))}</span>
          ${p.to && section === "live" ? `<span><span class="icon icon-clock icon-12" aria-hidden="true"></span>${esc(t("squadDealsUntil", { date: new Date(p.to).toLocaleDateString(lang) }))}</span>` : ""}
        </div>${p.unique && section === "live" ? stockGauge(t, esc, d, lang, true) : ""}${steps}${actions}${foot}
      </div>
    </aside>`;
}

/** The whole view: hero banner, then the live deals ("coming soon" when there
 *  is none), the member's Archived history and the ended deals. */
// ── Announcements ───────────────────────────────────────────────────────────
// kind "announcement": an information card managed in the TigerHub admin like
// the deals (status, dates, countries, order) — no code. Its texts are per
// language; its side card holds `body` in light markdown and one button
// (`ctaUrl`, https or mailto). Its picture is a transparent illustration on
// the card's warm gradient — or, with `imageOnWhite` ("deal of the moment"),
// a product photo filling the square on white like a deal's.

// Light markdown → HTML, escaped: "## " heading, "- " bullet, "1. " step,
// "> " highlighted note, **bold**, blank line = new paragraph.
function mdLite(escRaw, src) {
  // **bold** inside a line, after escaping (so nothing else turns into HTML).
  const esc = x => escRaw(x).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  const out = [], para = [];
  let list = null;   // { tag, items }
  const flushPara = () => { if (para.length) out.push(`<p>${para.map(esc).join(" ")}</p>`); para.length = 0; };
  const flushList = () => {
    if (!list) return;
    out.push(list.tag === "ol"
      ? `<ol class="sqd-steps sqd-steps--how">${list.items.map((x, n) => `<li><span>${n + 1}</span>${esc(x)}</li>`).join("")}</ol>`
      : `<ul class="sqd-md-list">${list.items.map(x => `<li>${esc(x)}</li>`).join("")}</ul>`);
    list = null;
  };
  for (const raw of String(src || "").split(/\r?\n/)) {
    const line = raw.trim();
    let m;
    if (!line) { flushPara(); flushList(); }
    else if ((m = /^#{1,3}\s+(.*)$/.exec(line))) { flushPara(); flushList(); out.push(`<h4>${esc(m[1])}</h4>`); }
    else if ((m = /^[-*]\s+(.*)$/.exec(line))) { flushPara(); if (list?.tag !== "ul") { flushList(); list = { tag: "ul", items: [] }; } list.items.push(m[1]); }
    else if ((m = /^\d+[.)]\s+(.*)$/.exec(line))) { flushPara(); if (list?.tag !== "ol") { flushList(); list = { tag: "ol", items: [] }; } list.items.push(m[1]); }
    else if ((m = /^>\s*(.*)$/.exec(line))) { flushPara(); flushList(); out.push(`<p class="sqd-md-note">${esc(m[1])}</p>`); }
    else { flushList(); para.push(line); }
  }
  flushPara(); flushList();
  return out.join("");
}

// A badge's colour says what kind of perk it is, read from its text: XP
// (green), free (black and gold), an amount off "−5 €" (red), a percentage
// (orange, the default).
function badgeKind(text, free = false) {
  const s = String(text || "");
  if (free) return "is-free";
  if (/\bXP\b/i.test(s)) return "is-xp";
  if (/[€$£¥]/.test(s)) return "is-amount";
  return "is-pct";
}

// An announcement's picture with its badge and, when it has an end date, the
// countdown to it (the same ticking pill as a claimed code's; at zero the view
// repaints and the announcement is gone).
function annArt(ctx, d) {
  const { t, esc, lang } = ctx;
  const img = /^https:\/\//i.test(d.image || "") ? d.image : "", end = ms(d.endAt);
  return `${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : `<span class="icon icon-info icon-20" aria-hidden="true"></span>`}
        ${d.badge && !d.hideBadge ? `<span class="sqd-card-badge ${badgeKind(pick(d.badge, lang))}">${esc(pick(d.badge, lang))}</span>` : ""}
        ${end && end > Date.now() ? `<div class="sqd-timer" data-exp="${end}"><span class="icon icon-clock icon-12" aria-hidden="true"></span><span>${esc(t("squadDealsTimeLeft", { time: countdown(t, end - Date.now()) }))}</span></div>` : ""}`;
}

function annCard(ctx, d) {
  const { t, esc, lang } = ctx;
  const title = pick(d.title, lang);
  const q = [title, pick(d.kicker, lang), pick(d.description, lang)].filter(Boolean).join(" ").toLowerCase();
  return `
    <article class="sqd-card sqd-ann${d.imageOnWhite ? " is-photo" : ""}${ctx.openId === d.id ? " is-selected" : ""}" data-open="${esc(d.id)}" data-mine="0" data-ann="1" data-q="${esc(q)}" tabindex="0" role="button" aria-label="${esc(title)}">
      <div class="sqd-card-art">${annArt(ctx, d)}</div>
      <div class="sqd-card-body">
        ${pick(d.kicker, lang) ? `<span class="sqd-card-partner">${esc(pick(d.kicker, lang))}</span>` : ""}
        <h3>${esc(title)}</h3>
        <div class="sqd-card-actions"><span class="sqd-open">${esc(pick(d.cardLabel, lang) || t("squadAnnMore"))}</span></div>
      </div>
    </article>`;
}

// An announcement for an app (d.appLinks { ios, android, iosBeta, androidBeta }):
// a QR code per platform to scan with the phone, beta first (the new features)
// with a switch to the stable release; each QR is also a link. QR images come
// from ctx.qr(url) (the app's local generator).
function appsBlock(ctx, links) {
  const { t, esc } = ctx;
  const https = u => (/^https:\/\//i.test(u || "") ? u : "");
  const chans = [["beta", https(links.iosBeta), https(links.androidBeta)], ["stable", https(links.ios), https(links.android)]].filter(c => c[1] || c[2]);
  if (!chans.length || !ctx.qr) return "";
  const qr = (url, os) => url ? `
        <a class="sqd-app-qr" href="${esc(url)}" target="_blank" rel="noopener">
          <img src="${ctx.qr(url)}" alt="" width="132" height="132">
          <span><span class="icon icon-${os} icon-13" aria-hidden="true"></span>${esc(t(os === "apple" ? "appIphone" : "appAndroid"))}</span>
        </a>` : "";
  return `
      <div class="sqd-apps" data-ch="${chans[0][0]}">
        ${chans.length > 1 ? `<div class="sqd-apps-tabs" role="tablist">
          <button type="button" role="tab" data-app-ch="beta"><b>${esc(t("appBeta"))}</b><small>${esc(t("appBetaHint"))}</small></button>
          <button type="button" role="tab" data-app-ch="stable"><b>${esc(t("appStable"))}</b><small>${esc(t("appStableHint"))}</small></button>
        </div>` : ""}
        <p class="sqd-apps-scan"><span class="icon icon-mobile-app icon-14" aria-hidden="true"></span>${esc(t("appScan"))}</p>
        ${chans.map(([ch, ios, android]) => `<div class="sqd-apps-qrs" data-for="${ch}">${qr(ios, "apple")}${qr(android, "android")}</div>`).join("")}
      </div>`;
}

function annSide(ctx, d) {
  const { esc, lang } = ctx;
  const title = pick(d.title, lang), img = /^https:\/\//i.test(d.image || "") ? d.image : "";
  const url = /^(https:\/\/|mailto:)/i.test(d.ctaUrl || "") ? d.ctaUrl : "";
  const label = pick(d.ctaLabel, lang);
  return `
    <aside class="sqd-side sqd-side--ann${d.imageOnWhite ? " is-photo" : ""}${ctx.openId === d.id ? " is-open" : ""}" data-side="${esc(d.id)}" aria-label="${esc(title)}">
      <header class="sqd-side-head">${esc(pick(d.kicker, lang) || title)}</header>
      ${img ? `<div class="sqd-side-art"><div class="sqd-card-art">${annArt(ctx, d)}</div></div>` : ""}
      <div class="sqd-side-body">
        <h2>${esc(title)}</h2>
        ${mdLite(esc, pick(d.body, lang) || pick(d.description, lang))}
        ${d.appLinks ? appsBlock(ctx, d.appLinks) : ""}
        ${url && label ? `<div class="sqd-side-actions"><a class="sqd-open sqd-wide" href="${esc(url)}"${url.startsWith("https") ? ` target="_blank" rel="noopener"` : ""}>${esc(label)}<span class="icon icon-${url.startsWith("mailto") ? "mail" : "arrow-up-right"} icon-12" aria-hidden="true"></span></a></div>` : ""}
      </div>
    </aside>`;
}

// ── TigerCoins ──────────────────────────────────────────────────────────────
// The balance and the envelopes still to open (functions/tigerCoins.js
// status), over the deals: one pile — the gift envelopes, the chests, then the
// surprise envelope of each TigerTag+ Certified chip. ctx.coins = { balance,
// unopened (chips), envelopes (gifts), chests } | null (not loaded / no
// function): no bar.
function coinsBar(ctx) {
  const { t, esc, lang } = ctx, c = ctx.coins;
  if (!c) return "";
  const pile = (c.unopened || 0) + (c.envelopes?.length || 0) + (c.chests?.length || 0);
  // On the banner's right: a minimal card holding only the balance, like the
  // other Tiger Squad heroes' cards; under it, the envelope with how many wait
  // (opens them) and a plain gift icon (a code). Full texts in the accessible names.
  return `
    <div class="sqd-coins-wrap" role="group" aria-label="${esc(t("coinsHint"))}">
      <div class="sqr-card sqd-coins">
        <b class="sqd-coins-bal" aria-label="${esc(t("coinsBalance", { n: (c.balance || 0).toLocaleString(lang) }))}">${(c.balance || 0).toLocaleString(lang)}<span class="tcoin tcoin--big" aria-hidden="true"></span></b>
      </div>
      <div class="sqd-coins-acts">
        ${/* Always there: with envelopes it opens them (and calls for a click); at 0 it says how to get some. */""}
        ${pile ? `<button type="button" class="sqd-coins-env" data-coins-open aria-label="${esc(t("coinsOpen"))} — ${esc(t("coinsPile", { n: pile }))}"><img src="../assets/img/tigercoins/envelope.webp" alt="" aria-hidden="true">${pile}</button>`
          : `<button type="button" class="sqd-coins-env is-empty" data-coins-help aria-haspopup="dialog" aria-label="${esc(t("envHelpTitle"))}"><img src="../assets/img/tigercoins/envelope.webp" alt="" aria-hidden="true">0</button>`}
        <button type="button" class="sqd-coins-gift" data-coins-code aria-haspopup="dialog" aria-label="${esc(t("coinsHaveCode"))}"><img src="../assets/img/tigercoins/gift-v2.webp" alt="" aria-hidden="true"></button>
      </div>
    </div>`;
}

/** "You got an envelope!": a friend gave one (functions/tigerCoins.js
 *  giveEnvelope). Only says so — who, with their avatar — and closes: the
 *  envelope waits in the pile. Resolves "see" (go to the Deals) or "close". */
export function showEnvelopeGift(ctx, { name, avatar }) {
  const { t, esc } = ctx;
  const el = document.createElement("div");
  el.className = "tc-reveal tc-gotgift";
  el.innerHTML = `
    <div class="tc-reveal-card tc-code-card tcx tcx--help" role="dialog" aria-modal="true" aria-label="${esc(t("envGiftTitle"))}">
      <img class="tch-env" src="../assets/img/tigercoins/envelope.webp" alt="" aria-hidden="true">
      <div class="tcx-main">
        <div class="tcx-plaque"><h3>${esc(t("envGiftTitle"))}</h3></div>
        <p class="tcg-from">${avatar || ""}<span><b>${esc(t("notifEnvelopeGift", { name }))}</b><small>${esc(t("notifEnvelopeGiftText"))}</small></span></p>
        <button type="button" class="tcx-go" data-see>${esc(t("envGiftSee"))}</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("is-open"));
  return new Promise(resolve => {
    const close = how => { el.classList.remove("is-open"); document.removeEventListener("keydown", onKey, true); setTimeout(() => el.remove(), 200); resolve(how); };
    const onKey = e => { if (e.key === "Escape") { e.stopPropagation(); close("close"); } };
    document.addEventListener("keydown", onKey, true);
    el.addEventListener("mousedown", e => { if (e.target === el) close("close"); });   // no × : a click beside it or Esc closes
    el.querySelector("[data-see]").addEventListener("click", () => close("see"));
  });
}

/** "How to get envelopes": opened from the envelope button when there is none.
 *  The gift-code modal's look, narrower: a big envelope rising from behind the
 *  card, a title plaque, the
 *  five ways (TigerTag+ Certified filaments, gift codes, Discord and e-mail,
 *  milestones and events, a shared envelope), and "I have a code", which opens the code modal. */
function openEnvelopeHelp(ctx) {
  const { t, esc } = ctx;
  if (document.querySelector(".tc-help")) return;
  const el = document.createElement("div");
  el.className = "tc-reveal tc-help";
  const row = (art, title, sub) => `<li><span class="tch-ic">${art}</span><span><b>${esc(t(title))}</b><small>${esc(t(sub))}</small></span></li>`;
  el.innerHTML = `
    <div class="tc-reveal-card tc-code-card tcx tcx--help" role="dialog" aria-modal="true" aria-label="${esc(t("envHelpTitle"))}">
      <img class="tch-env" src="../assets/img/tigercoins/envelope.webp" alt="" aria-hidden="true">
      <div class="tcx-main">
        <div class="tcx-plaque"><h3>${esc(t("envHelpTitle"))}</h3></div>
        <ul class="tch-list">
          ${row(`<img src="../assets/svg/logos/tigersystem-icon-framed.svg" alt="">`, "envHelpChip", "envHelpChipSub")}
          ${row(`<img src="../assets/img/tigercoins/gift-v2.webp" alt="">`, "envHelpCode", "envHelpCodeSub")}
          ${row(`<span class="tch-duo"><span class="icon icon-discord" aria-hidden="true"></span><span class="icon icon-mail" aria-hidden="true"></span></span>`, "envHelpMail", "envHelpMailSub")}
          ${row(`<img src="../assets/img/tigercoins/crown.webp" alt="">`, "envHelpBonus", "envHelpBonusSub")}
          ${row(`<img src="../assets/img/tigercoins/envelope.webp" alt="">`, "codeSrcShared", "codeSrcSharedSub")}
        </ul>
        <button type="button" class="tcx-go" data-code>${esc(t("coinsHaveCode"))}</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("is-open"));
  const close = () => { el.classList.remove("is-open"); document.removeEventListener("keydown", onKey, true); setTimeout(() => el.remove(), 200); };
  const onKey = e => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  document.addEventListener("keydown", onKey, true);
  el.addEventListener("mousedown", e => { if (e.target === el) close(); });
  el.querySelector("[data-code]").addEventListener("click", () => { close(); setTimeout(() => openCoinsCodeModal(ctx), 180); });
}

/** The gift-code modal ("Gift code", generic: a code gives coins, envelopes or
 *  chests), drawn from the ChatGPT mockup (assets-src/img/tigercoins/
 *  code-modal-mockup.png): the tiger pointing at the boxes, a chest of coins,
 *  a title plaque, the key in three boxes of four
 *  (XXXX-XXXX-XXXX). Typing moves to the next box, Backspace on an empty box
 *  goes back, a pasted key (dashes, spaces or not) fills the three. The backend
 *  credits it once per account (coins or surprise envelopes); its error stays in the
 *  modal, a success closes it with a toast. */
function openCoinsCodeModal(ctx) {
  const { t, esc } = ctx;
  if (document.querySelector(".tc-code")) return;
  ambientStart();   // the envelope stage's music plays while the code is typed (stopped by close)
  const el = document.createElement("div");
  el.className = "tc-reveal tc-code";
  const box = i => `<input class="tc-code-box" data-i="${i}" maxlength="4" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX" aria-label="${esc(t("giftCodeTitle"))} ${i + 1} / 3">`;
  // Where a code comes from (the strip at the bottom).
  const src = (ic, title, sub) => `<li><span class="tcx-src-ic">${ic}</span><span><b>${esc(t(title))}</b><small>${esc(t(sub))}</small></span></li>`;
  el.innerHTML = `
    <form class="tc-reveal-card tc-code-card tcx" role="dialog" aria-modal="true" aria-label="${esc(t("giftCodeTitle"))}" novalidate>
      <img class="tcx-tiger" src="../assets/img/tigercoins/code-tiger.webp" alt="" aria-hidden="true">
      <img class="tcx-chest" src="../assets/img/tigercoins/code-chest.webp" alt="" aria-hidden="true">
      <span class="tcx-pile" aria-hidden="true"><img src="../assets/img/tigercoins/envelope.webp" alt=""><img src="../assets/img/tigercoins/coin.webp" alt=""><img src="../assets/img/tigercoins/coin.webp" alt=""></span>
      
      <div class="tcx-main">
        <div class="tcx-plaque"><img class="tcx-gift" src="../assets/img/tigercoins/gift-v2.webp" alt="" aria-hidden="true"><h3>${esc(t("giftCodeTitle"))}</h3></div>
        <p class="tc-code-hint">${esc(t("coinsCodeHint"))}</p>
        <div class="tc-code-row">${box(0)}<span class="tc-code-dash" aria-hidden="true">–</span>${box(1)}<span class="tc-code-dash" aria-hidden="true">–</span>${box(2)}
          <p class="tc-code-err" role="alert" hidden></p></div>
        <button type="submit" class="tcx-go" data-redeem disabled>${esc(t("coinsRedeem"))}</button>
      </div>
      <ul class="tcx-srcs">
        ${src(`<span class="icon icon-discord" aria-hidden="true"></span>`, "codeSrcDiscord", "codeSrcDiscordSub")}
        ${src(`<img src="../assets/svg/logos/tigersystem-icon-framed.svg" alt="">`, "codeSrcRfid", "codeSrcRfidSub")}
        ${src(`<span class="icon icon-card" aria-hidden="true"></span>`, "codeSrcCard", "codeSrcCardSub")}
        ${src(`<img src="../assets/img/tigercoins/envelope.webp" alt="" aria-hidden="true">`, "codeSrcShared", "codeSrcSharedSub")}
      </ul>
    </form>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("is-open"));
  const form = el.querySelector("form"), boxes = [...el.querySelectorAll(".tc-code-box")];
  const btn = el.querySelector("[data-redeem]"), err = el.querySelector(".tc-code-err");
  const clean = v => v.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const value = () => boxes.map(b => b.value).join("");
  const sync = () => { btn.disabled = value().length !== 12; err.hidden = true; form.classList.remove("is-wrong"); };
  // Spread a run of characters from box i onwards (typing past 4, or a paste).
  const fill = (i, chars) => {
    for (let k = i; k < 3 && chars; k++) { boxes[k].value = chars.slice(0, 4); chars = chars.slice(4); }
    const next = boxes.find(b => b.value.length < 4) || boxes[2];
    next.focus();
    sync();
  };
  boxes.forEach((b, i) => {
    b.addEventListener("input", () => {
      const v = clean(b.value);
      if (v.length > 4) return fill(i, v);
      b.value = v;
      if (v.length === 4 && i < 2) boxes[i + 1].focus();
      sync();
    });
    b.addEventListener("paste", e => {
      e.preventDefault();
      const v = clean(e.clipboardData?.getData("text") || "");
      if (v.length >= 12) { boxes.forEach(x => { x.value = ""; }); fill(0, v); } else fill(i, v);
    });
    b.addEventListener("keydown", e => {
      if (e.key === "Backspace" && !b.value && i > 0) { e.preventDefault(); boxes[i - 1].focus(); boxes[i - 1].value = boxes[i - 1].value.slice(0, -1); sync(); }
      else if (e.key === "ArrowLeft" && b.selectionStart === 0 && i > 0) boxes[i - 1].focus();
      else if (e.key === "ArrowRight" && b.selectionStart === b.value.length && i < 2) boxes[i + 1].focus();
    });
  });
  const close = () => { ambientStop(); el.classList.remove("is-open"); document.removeEventListener("keydown", onKey, true); setTimeout(() => el.remove(), 200); };
  const onKey = e => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  document.addEventListener("keydown", onKey, true);
  el.addEventListener("mousedown", e => { if (e.target === el) close(); });
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const v = value();
    if (v.length !== 12 || btn.disabled) return;
    btn.disabled = true;
    form.classList.add("is-busy");
    try {
      const r = await ctx.onRedeemCode(`${v.slice(0, 4)}-${v.slice(4, 8)}-${v.slice(8)}`);
      close();
      // A shared red envelope: its share and luck rank, in the envelope reveal;
      // surprise envelopes: their rarities; plain coins: a toast.
      if (r.split) await showEnvelope(ctx, { split: r.split, result: r });
      else if (r.chests?.length) await openChests(ctx, r.chests);
      else if (r.opened?.length) await revealSurprises(ctx, r);
      else ctx.toast?.(t("coinsRedeemed", { n: (r.coins || 0).toLocaleString(ctx.lang) }));
    } catch (er) {
      const key = { CODE_EXPIRED: "coinsCodeExpired", CODE_EXHAUSTED: "coinsCodeExhausted", CODE_USED: "coinsCodeUsed" }[er?.message] || "coinsCodeInvalid";
      err.textContent = t(key);
      err.hidden = false;
      form.classList.remove("is-wrong"); void form.offsetWidth; form.classList.add("is-wrong");
      btn.disabled = false;
    } finally { form.classList.remove("is-busy"); }
  });
  boxes[0].focus();
}

/** The surprise envelopes inside a gift, a chest or a code, revealed one by
 *  one like a pull (coin-pull.js). */
const revealSurprises = (ctx, r) => revealPulls(ctx, r.opened);

const chestName = (ctx, c) => (c?.name && (c.name[ctx.lang] || c.name.en || c.name.fr)) || "";

/** One chest (users/{uid}/chests): a box in its type's colour; "Open the
 *  chest" calls `open()` (the backend draws its envelopes), the lid lifts, then
 *  its envelopes are revealed with their rarities. `chest` = { id, name, color,
 *  envelopes }. Resolves "next" or "done" (`more` = chests still waiting). */
export function showChest(ctx, chest, { open, more = 0 } = {}) {
  const { t, esc } = ctx;
  const name = chestName(ctx, chest);
  const el = document.createElement("div");
  el.className = "tc-reveal tc-chestm";
  el.innerHTML = `
    <div class="tc-reveal-card tc-chest-card" role="dialog" aria-modal="true" aria-label="${esc(name)}" style="--cc:${esc(chest.color || "#ffb21a")}">
      <h3>${esc(name)}</h3>
      <p class="tc-env-msg">${esc(t("chestInside", { n: chest.envelopes || 0 }))}</p>
      <div class="tc-chest" aria-hidden="true">
        <span class="tc-chest-glow"></span>
        <span class="tc-chest-body"><span class="tc-chest-lock"></span></span>
        <span class="tc-chest-lid"></span>
      </div>
      <p class="tc-code-err" role="alert" hidden></p>
      <div class="tc-reveal-actions">
        <button type="button" class="sqd-open" data-chest-go>${esc(t("chestOpen"))}</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("is-open"));
  const card = el.querySelector(".tc-chest-card");
  return new Promise(resolve => {
    el.addEventListener("click", async e => {
      const go = e.target.closest("[data-chest-go]");
      if (!go || go.disabled) return;
      go.disabled = true;
      try {
        const r = await open();
        card.classList.add("is-opened");
        // The lid lifts, the light spills out, then the envelopes come out.
        await new Promise(res => setTimeout(res, 900));
        el.classList.remove("is-open");
        setTimeout(() => el.remove(), 200);
        await revealSurprises(ctx, { ...r, coins: 0 });
        resolve(more ? "next" : "done");
      } catch (_) {
        const er = el.querySelector(".tc-code-err");
        er.textContent = t("squadDealsErr");
        er.hidden = false;
        go.disabled = false;
      }
    });
  });
}

/** Opens chests one after another (the pile, a gift or a code that gave
 *  several); `ctx.openChest(id)` asks the backend. Resolves true when all were opened. */
export async function openChests(ctx, list) {
  for (let i = 0; i < list.length; i++) {
    if ((await showChest(ctx, list[i], { more: list.length - i - 1, open: () => ctx.openChest(list[i].id) })) !== "next") return i === list.length - 1;
  }
  return true;
}

/** One gift envelope (users/{uid}/envelopes, or a shared red envelope just
 *  redeemed): a red envelope with a gold seal; "Open" calls `open()` (the
 *  backend credits it) and the flap lifts on what it held — TigerCoins, N
 *  surprise envelopes revealed next, or N chests opened next. `env` = { kind, message?, coins,
 *  surprises } with `open`, or { split, result } already opened. `more` =
 *  envelopes still waiting after this one. Resolves "next" or "done". */
/* `give` (a gift envelope from the pile, not yet opened): { left, max, tier,
   friends: [{ uid, name, avatar }], send(uid) → status } — "Give to a friend"
   lists the friends with today's allowance (by TigerSquad level), a held
   button confirms (functions/tigerCoins.js giveEnvelope). `giveOnly`: straight
   to the friend picker (from the opening stage); "Back" closes. */
export function showEnvelope(ctx, env, { open = null, more = 0, give = null, giveOnly = false } = {}) {
  const { t, esc, lang } = ctx;
  const msg = env.message ? (env.message[lang] || env.message.en || env.message.fr || "") : "";
  const title = giveOnly ? t("friendGiveEnvelope") : env.split ? t("envSplitTitle") : env.kind === "milestone" ? t("envMilestone")
    : env.kind === "friend" && env.from ? t("envFromFriend", { name: env.from }) : t("envTitle");
  const canGive = !!(give && env.id && !env.result && !env.split);
  const firstActions = `
        <button type="button" class="tcx-go tc-env-go" data-env-go>${esc(t("envOpen"))}</button>
        ${canGive ? `<button type="button" class="tc-code-cancel tc-env-give" data-env-give><img src="../assets/img/tigercoins/gift-v2.webp" alt="" aria-hidden="true">${esc(t("envGive"))}</button>` : ""}`;
  const el = document.createElement("div");
  el.className = "tc-reveal tc-envm";
  // The gift-code modal's frame: the illustrated envelope rising from behind
  // the card, the title plaque, the message; opening sends the envelope off and
  // the prize pops in with the TigerCoin.
  el.innerHTML = `
    <div class="tc-reveal-card tc-code-card tcx tcx--help tc-env-card" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <img class="tch-env tc-env" src="../assets/img/tigercoins/envelope.webp" alt="" aria-hidden="true">
      <div class="tcx-main">
        <div class="tcx-plaque"><h3>${esc(title)}</h3></div>
        <p class="tc-env-msg"${giveOnly ? " hidden" : ""}>${esc(msg || (env.split ? "" : t("envDefaultMsg")))}</p>
        <div class="tc-env-prize" aria-live="polite"><img src="../assets/img/tigercoins/coin.webp" alt="" aria-hidden="true"><span><b class="tc-env-amount"></b><small class="tc-env-unit"></small></span></div>
        <p class="tc-env-rank" hidden></p>
        <p class="tc-code-err" role="alert" hidden></p>
        <div class="tc-reveal-actions">${firstActions}</div>
      </div>
    </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("is-open"));
  const card = el.querySelector(".tc-env-card"), actions = el.querySelector(".tc-reveal-actions");
  return new Promise(resolve => {
    let opened = null;
    const finish = how => { el.classList.remove("is-open"); setTimeout(() => el.remove(), 200); resolve(how); };
    const reveal = r => {
      const coins = r.coins || 0, surprises = r.opened?.length || 0, chests = r.chests?.length || 0;
      el.querySelector(".tc-env-amount").textContent = `+${(chests || surprises || coins).toLocaleString(lang)}`;
      el.querySelector(".tc-env-unit").textContent = chests ? `${t("envGotChests", { n: chests })} ${chestName(ctx, r.chests[0])}`
        : surprises ? t("envGotSurprises", { n: surprises }) : "TigerCoins";
      opened = r;
      if (env.split?.rank) {
        const rk = el.querySelector(".tc-env-rank");
        rk.textContent = t("envSplitRank", { rank: env.split.rank, opened: env.split.opened, parts: env.split.parts });
        rk.hidden = false;
      }
      card.classList.add("is-opened");
      actions.innerHTML = `
        ${chests || surprises ? `<button type="button" class="tcx-go" data-env="surprises">${esc(t("envOpenSurprises"))}</button>`
          : `${more ? `<button type="button" class="tcx-go" data-env="next">${esc(t("envNext", { n: more }))}</button>` : ""}
        <button type="button" class="tc-code-cancel" data-env="done">${esc(t("coinsCollect"))}</button>`}`;
    };
    if (env.result) reveal(env.result);
    // Give to a friend: the friends (today's allowance on top), one picked, a held button sends.
    const showGive = () => {
      const friends = give.friends || [], left = give.left || 0;
      actions.innerHTML = `
        <div class="tc-give">
          ${left ? "" : `<p class="tc-give-left is-none">${esc(t("envGiveNone"))}</p>`}
          ${friends.length > 8 ? `<label class="sqd-search tc-give-search"><span class="icon icon-search icon-13" aria-hidden="true"></span><input type="search" data-give-q placeholder="${esc(t("friendsSearch"))}" autocomplete="off"></label>` : ""}
          ${friends.length ? `<div class="tc-give-list" role="radiogroup" aria-label="${esc(t("envGivePick"))}">${friends.map(f =>
            `<button type="button" role="radio" aria-checked="false" class="tc-give-f" data-give-to="${esc(f.uid)}" data-name="${esc(f.name)}"${left ? "" : " disabled"}><span class="tc-give-av">${f.avatar}<span class="tc-give-check" aria-hidden="true"><span class="icon icon-check icon-11"></span></span></span><span class="tc-give-name">${esc(f.name)}</span></button>`).join("")}</div>`
            : `<p class="tc-give-left">${esc(t("envGiveNoFriends"))}</p>`}
          ${friends.length && left ? `<button type="button" class="sqd-mark sqd-wide tc-give-go" disabled><span class="hold-progress" aria-hidden="true"></span><span class="icon icon-gift icon-12" aria-hidden="true"></span><span class="tc-give-lbl">${esc(t("envGiveShort"))}</span></button>` : ""}
        </div>`;
      // Many friends: the search filters the grid by name, in place.
      actions.querySelector("[data-give-q]")?.addEventListener("input", e => {
        const q = e.target.value.trim().toLowerCase();
        actions.querySelectorAll(".tc-give-f").forEach(b => { b.hidden = !!q && !b.dataset.name.toLowerCase().includes(q); });
      });
      const go = actions.querySelector(".tc-give-go");
      if (!go) return;
      // A friend already chosen (from the friends list): picked, the button armed.
      const pre = give.picked && actions.querySelector(`[data-give-to="${CSS.escape(give.picked)}"]`);
      if (pre && !pre.disabled) { pre.setAttribute("aria-checked", "true"); go.disabled = false; go.querySelector(".tc-give-lbl").textContent = t("envGiveShort"); }
      // The app's hold-to-confirm button (.agents/rules/hold-to-confirm.md): a gift
      // cannot be taken back, so the binding duration (1500 ms).
      ctx.hold?.(go, 1500, async () => {
        const pick = actions.querySelector('.tc-give-f[aria-checked="true"]');
        if (!pick || go.disabled) return;
        go.disabled = true;
        try {
          await give.send(pick.dataset.giveTo);
          el.querySelector(".tc-env-msg").textContent = t("envGiveSent", { name: pick.dataset.name });
          card.classList.add("is-given");
          actions.innerHTML = "";
          setTimeout(() => finish(more ? "next" : "done"), 1500);
        } catch (err) {
          const er = el.querySelector(".tc-code-err");
          er.textContent = t(err?.message === "GIFT_LIMIT" ? "envGiveNone" : "squadDealsErr");
          er.hidden = false;
          go.disabled = false;
        }
      }, { hint: true });
    };
    if (giveOnly && canGive) showGive();
    // No "Back" button: a click beside the card closes it (not while a reveal is running).
    el.addEventListener("mousedown", e => { if (e.target === el && !card.classList.contains("is-given")) finish("back"); });
    el.addEventListener("click", async e => {
      if (e.target.closest("[data-env-give]")) { showGive(); return; }
      const f = e.target.closest("[data-give-to]");
      if (f && !f.disabled) {
        actions.querySelectorAll(".tc-give-f").forEach(x => x.setAttribute("aria-checked", String(x === f)));
        const go = actions.querySelector(".tc-give-go");
        if (go) { go.disabled = false; go.querySelector(".tc-give-lbl").textContent = t("envGiveShort"); }
        return;
      }
      const b = e.target.closest("[data-env]");
      if (b?.dataset.env === "surprises") {
        // The envelope gives way to what it held: its chests, or the rarity reveal.
        el.classList.remove("is-open");
        setTimeout(() => el.remove(), 200);
        if (opened.chests?.length) await openChests(ctx, opened.chests);
        else await revealSurprises(ctx, opened);
        resolve(more ? "next" : "done");
        return;
      }
      if (b) { finish(b.dataset.env); return; }
      const go = e.target.closest("[data-env-go]");
      if (!go || go.disabled || !open) return;
      go.disabled = true;
      try { reveal(await open()); }
      catch (_) {
        const er = el.querySelector(".tc-code-err");
        er.textContent = t("squadDealsErr");
        er.hidden = false;
        go.disabled = false;
      }
    });
  });
}

export function dealsViewHtml(ctx, { live, history, ended }) {
  const { t, esc } = ctx;
  // Filter bar over the live deals: all / my codes (claimed, not used yet) and a
  // search — applied in place by applyDealsFilter (no repaint, the search keeps
  // its focus); the choice lives on the host (ctx.filter = host._sqdFilter).
  const f = ctx.filter || { tab: "all", q: "" };
  const mineN = live.filter(d => { if (d.kind === "announcement") return false; const p = dealParts(ctx, d, "live"); return p.got && !p.used; }).length;
  const coinN = live.filter(d => d.kind !== "announcement" && d.costCoins > 0).length;
  const tab = (id, icon, key, n) => `<button type="button" role="tab" class="sqd-tab${f.tab === id ? " is-on" : ""}" data-sqd-tab="${id}" aria-selected="${f.tab === id}">${icon}${esc(t(key))}${n ? `<b>${n}</b>` : ""}</button>`;
  // While loading, the same bar, greyed and inert (the page keeps its final shape).
  const bar = `
    <div class="sqd-bar${ctx.loading ? " is-skel" : ""}" role="search"${ctx.loading ? " inert" : ""}>
      <div class="sqd-tabs" role="tablist">
        ${tab("all", `<span class="icon icon-grid icon-13" aria-hidden="true"></span>`, "squadDealsFilterAll", 0)}
        ${coinN || ctx.loading ? tab("exchange", `<span class="tcoin" aria-hidden="true"></span>`, "squadDealsExchange", 0) : ""}
        ${tab("mine", `<span class="icon icon-tag icon-13" aria-hidden="true"></span>`, "squadDealsFilterMine", mineN)}
      </div>
      <label class="sqd-search"><span class="icon icon-search icon-13" aria-hidden="true"></span><input type="search" data-sqd-q value="${esc(f.q)}" placeholder="${esc(t("squadDealsSearch"))}"></label>
    </div>
    <p class="sqd-nomatch" hidden>${esc(t("squadDealsNoMatch"))}</p>`;
  const group = (list, section, key) => list.length ? `
    ${section === "live" ? bar : ""}
    ${key ? `<h3 class="sqd-arch-h">${esc(t(key))} <span>${list.length}</span></h3>` : ""}
    <div class="sqd-grid${key ? " sqd-grid--arch" : ""}">${list.map(d => dealCard(ctx, d, section)).join("")}</div>
    ${list.map(d => dealSide(ctx, d, section)).join("")}` : "";
  // No live deal: "coming soon", then the announcements on their own.
  const anns = live.filter(d => d.kind === "announcement");
  const soon = slim => `
    <section class="sqd-soon${slim ? " sqd-soon--slim" : ""}">
      ${slim ? "" : `<span class="sqd-soon-ic" aria-hidden="true"><span class="icon icon-percent"></span></span>`}
      <h3>${esc(t("squadDealsSoon"))}</h3>
      <p>${esc(t("squadDealsSoonBody"))}</p>
    </section>
    ${anns.length ? `<div class="sqd-grid">${anns.map(d => annCard(ctx, d)).join("")}</div>${anns.map(d => annSide(ctx, d)).join("")}` : ""}`;
  // First load for this account: the final page's shape — the filter bar, then
  // shimmering cards laid out like a deal's (picture, partner, title, state,
  // stock bar) — so nothing jumps when the deals land.
  const skelCard = `<div class="sqd-card sqd-card--skel"><span class="sqr-skel sqd-skel-art"></span>
      <span class="sqr-skel sqd-skel-line is-kicker"></span><span class="sqr-skel sqd-skel-line"></span>
      <span class="sqr-skel sqd-skel-line is-short"></span><span class="sqr-skel sqd-skel-line is-bar"></span></div>`;
  const body = ctx.loading ? `${bar}
    <div class="sqd-grid" aria-busy="true">${skelCard.repeat(30)}</div>`
    : live.length > anns.length || history.length || ended.length ? `
    ${live.length > anns.length ? group(live, "live") : soon(true)}
    ${group(history, "history", "squadDealsArchived")}
    ${group(ended, "ended", "squadDealsEndedTitle")}` : soon(false);
  return `
    <section class="sqr-hero sqd-hero">
      <div class="qm-hero-txt"><span class="qw-eyebrow">${esc(t("squadBrand"))}</span>
        <h2>${esc(t("squadDeals"))}</h2><p>${esc(t("squadDealsSub"))}</p></div>
      <div class="hero-scene" aria-hidden="true"></div>
      ${ctx.loading ? `<div class="sqr-card sqd-coins sqd-coins--skel" aria-hidden="true"><span class="sqr-skel"></span></div>` : coinsBar(ctx)}
    </section>
    ${body}
    <button type="button" class="pp-close-tab sqd-close-tab${ctx.openId && ctx.openId === findOpen(ctx, live, history, ended) ? " is-open" : ""}" aria-label="${esc(t("squadDealsClose"))}"><span class="cttab-glyph">»</span></button>`;
}
const findOpen = (ctx, ...lists) => lists.flat().some(d => d.id === ctx.openId) ? ctx.openId : null;

/** Show / hide the live cards for the filter bar (host._sqdFilter), in place:
 *  "all", "exchange" (the deals paid in TigerCoins) or "mine" (codes in hand).
 *  Announcements show under "All deals" only (the search reads them too). Called by the
 *  host after each paint and by the bar itself. */
export function applyDealsFilter(host) {
  const f = host._sqdFilter || { tab: "all", q: "" };
  const q = f.q.trim().toLowerCase();
  const grid = host.querySelector(".sqd-bar ~ .sqd-grid");
  if (!grid) return;
  let shown = 0;
  for (const c of grid.querySelectorAll(".sqd-card")) {
    const partner = c.dataset.ann === "1";   // an announcement: under "All deals" only
    const inTab = f.tab === "mine" ? c.dataset.mine === "1" : f.tab === "exchange" ? c.dataset.coins === "1" : true;
    const ok = (partner ? f.tab !== "mine" && f.tab !== "exchange" : inTab) && (!q || c.dataset.q.includes(q));
    c.hidden = !ok;
    if (ok && !partner) shown++;
  }
  const none = host.querySelector(".sqd-nomatch");
  if (none) none.hidden = shown > 0 || (f.tab === "all" && !q);
  for (const b of host.querySelectorAll("[data-sqd-tab]")) {
    const on = b.dataset.sqdTab === f.tab;
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-selected", on);
  }
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
      el.classList.toggle("is-soon", left < SOON_MS);
      el.lastElementChild.textContent = c.t("squadDealsTimeLeft", { time: countdown(c.t, left) });
    }
  }, 1000);
  // Side card: a grid card opens its deal (again → closes), × or Esc closes.
  // The open id lives on the host (host._sqdOpen) so a repaint keeps it open.
  // Switching deals slides the new card in OVER the open one (kept one z slot
  // under it, .is-under), which then closes without a slide once covered —
  // the same "new opens, old closes" as a spool's detail panel.
  const setOpen = id => {
    const prev = host._sqdOpen;
    host._sqdOpen = id || null;
    const under = prev && id && prev !== id ? host.querySelector(`.sqd-side.is-open[data-side="${CSS.escape(prev)}"]`) : null;
    for (const el of host.querySelectorAll(".sqd-side.is-under")) { el.classList.remove("is-open"); requestAnimationFrame(() => el.classList.remove("is-under")); }
    for (const el of host.querySelectorAll(".sqd-side:not(.is-under)")) el.classList.toggle("is-open", el.dataset.side === id || el === under);
    if (under) {
      under.classList.add("is-under");
      clearTimeout(host._sqdUnderT);
      // Closed while still under (no transition), back to its slot a frame later.
      host._sqdUnderT = setTimeout(() => {
        under.classList.remove("is-open");
        requestAnimationFrame(() => under.classList.remove("is-under"));
      }, 260);
    }
    for (const el of host.querySelectorAll(".sqd-card[data-open]")) el.classList.toggle("is-selected", el.dataset.open === id);
    host.querySelector(".sqd-close-tab")?.classList.toggle("is-open", !!id);
  };
  host._sqdSetOpen = setOpen;   // the app's "close every side card" (long press on a » tab)
  document.addEventListener("keydown", e => {
    if (!host._sqdOpen || host.classList.contains("hidden")) return;
    if (e.key === "Escape") setOpen(null);
  });
  host.addEventListener("keydown", e => {
    const card = (e.key === "Enter" || e.key === " ") && e.target.closest?.(".sqd-card[data-open]");
    if (card) { e.preventDefault(); setOpen(host._sqdOpen === card.dataset.open ? null : card.dataset.open); }
  });
  host._sqdFilter ||= { tab: "all", q: "" };
  host.addEventListener("input", e => {
    if (!e.target.matches?.("[data-sqd-q]")) return;
    host._sqdFilter.q = e.target.value;
    applyDealsFilter(host);
  });
  host.addEventListener("click", async e => {
    if (e.target.closest(".sqd-close-tab")) { setOpen(null); return; }
    if (e.target.closest("[data-coins-code]")) { openCoinsCodeModal(ctx); return; }
    if (e.target.closest("[data-coins-help]")) { openEnvelopeHelp(ctx); return; }
    const ch = e.target.closest("[data-app-ch]");
    if (ch) { ch.closest(".sqd-apps").dataset.ch = ch.dataset.appCh; return; }
    const opener = e.target.closest("[data-coins-open]");
    if (opener) { if (!opener.disabled) { opener.disabled = true; try { await ctx.onOpenEnvelopes(); } finally { opener.disabled = false; } } return; }
    const tab = e.target.closest("[data-sqd-tab]");
    if (tab) { host._sqdFilter.tab = tab.dataset.sqdTab; applyDealsFilter(host); return; }
    const card = e.target.closest(".sqd-card[data-open]");
    if (card) { setOpen(host._sqdOpen === card.dataset.open ? null : card.dataset.open); return; }
    // "I used it" is a hold (the host wires it after each paint), not a click.
    const act = e.target.closest(".sqd-get");
    if (act) {
      if (act.disabled) return;
      act.disabled = true;
      try { await ctx.onAction("claim", act.dataset.deal); }
      catch (err) { act.disabled = false; ctx.toast?.(ctx.t(err?.message === "NOT_ENOUGH_COINS" ? "coinsNotEnough" : "squadDealsErr")); }
      return;
    }
    const b = e.target.closest(".sqd-code"); if (!b) return;
    const lbl = b.querySelector(".sqd-code-lbl");
    navigator.clipboard?.writeText(b.dataset.code).then(() => {
      b.classList.add("is-copied");
      if (lbl) lbl.textContent = ctx.t("squadDealsCopiedBtn");
      setTimeout(() => { b.classList.remove("is-copied"); if (lbl) lbl.textContent = ctx.t("squadDealsCopyBtn"); }, 1600);
    }).catch(() => {});
  });
}
