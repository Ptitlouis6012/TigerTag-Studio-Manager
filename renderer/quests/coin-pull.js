// TigerCoins pulls — opening surprise envelopes gacha style (functions/tigerCoins.js).
//
// openPullStage: the pile's big sealed envelope; HOLD it (or "Open ×1" /
//   "Open ×10", held too) to pull — the backend draws 1 to 10 chips' envelopes
//   per pull, never the whole pile.
// revealPulls: what a pull, a chest or a gift gave, one envelope at a time —
//   the glow climbs the rarity ladder (grey → green → blue → purple → gold) and
//   stops on the one drawn, the flap opens on the coins, particles as rare as
//   the envelope; a tap goes to the next one, "Skip" to the summary, then the
//   summary grid and the total.
// Both live in one overlay appended to <body> (.tc-reveal: the Tiger Squad
// tokens); every call resolves when the member leaves it.

const ORDER = ["common", "uncommon", "rare", "epic", "legendary"];
const PARTICLES = [0, 10, 16, 26, 44];
const HOLD_MS = 650;

const wait = ms => new Promise(r => setTimeout(r, ms));
const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function overlay(cls) {
  const el = document.createElement("div");
  el.className = `tc-reveal tp ${cls || ""}`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("is-open"));
  return el;
}
function closeOverlay(el) {
  el.classList.remove("is-open");
  setTimeout(() => el.remove(), 200);
}

// Press and hold `btn` for `ms` to fire `done` (a click alone does nothing);
// the fill runs in --hold (0 → 1).
function holdToFire(btn, ms, done) {
  let t0 = 0, raf = 0;
  const stop = () => { cancelAnimationFrame(raf); raf = 0; btn.style.setProperty("--hold", 0); btn.classList.remove("is-holding"); };
  const tick = now => {
    const k = Math.min(1, (now - t0) / ms);
    btn.style.setProperty("--hold", k);
    if (k >= 1) { stop(); done(); return; }
    raf = requestAnimationFrame(tick);
  };
  btn.addEventListener("pointerdown", e => {
    if (btn.disabled || e.button > 0) return;
    t0 = performance.now();
    btn.classList.add("is-holding");
    raf = requestAnimationFrame(tick);
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach(ev => btn.addEventListener(ev, () => { if (raf) stop(); }));
  // Keyboard: Enter / Space held the same way.
  btn.addEventListener("keydown", e => {
    if ((e.key === "Enter" || e.key === " ") && !e.repeat && !raf && !btn.disabled) {
      e.preventDefault(); t0 = performance.now(); btn.classList.add("is-holding"); raf = requestAnimationFrame(tick);
    }
  });
  btn.addEventListener("keyup", e => { if ((e.key === "Enter" || e.key === " ") && raf) stop(); });
}

const sealedEnvelope = () => `
  <div class="tp-env" aria-hidden="true">
    <span class="tc-env-back"></span>
    <span class="tc-env-note"><b class="tc-env-amount"></b><small class="tc-env-unit"></small></span>
    <span class="tc-env-front"></span>
    <span class="tc-env-flap"></span>
    <span class="tc-env-seal"><span class="tcoin tcoin--big"></span></span>
  </div>`;

function burst(host, rarity) {
  const n = reduced() ? 0 : PARTICLES[ORDER.indexOf(rarity)];
  for (let i = 0; i < n; i++) {
    const p = document.createElement("i");
    p.className = "tp-spark";
    const a = Math.random() * Math.PI * 2, d = 90 + Math.random() * 150;
    p.style.cssText = `--x:${Math.cos(a) * d}px;--y:${Math.sin(a) * d}px;--s:${0.6 + Math.random()};--dl:${Math.random() * 120}ms`;
    host.appendChild(p);
    setTimeout(() => p.remove(), 1400);
  }
}

// One envelope: the glow climbs to its rarity, then it opens. Resolves when
// shown; `skipRef.now` set → jumps to the end at once.
async function playOne(stage, item, ctx, skipRef) {
  const { t, lang } = ctx;
  const r = Math.max(0, ORDER.indexOf(item.rarity));
  stage.innerHTML = `<div class="tp-card" data-r="0">${sealedEnvelope()}<p class="tp-label"></p></div>`;
  const card = stage.firstElementChild;
  card.querySelector(".tc-env-amount").textContent = `+${(item.coins || 0).toLocaleString(lang)}`;
  card.querySelector(".tc-env-unit").textContent = "TigerCoins";
  const quick = reduced() || skipRef.now;
  // The glow climbs the ladder, one step at a time, up to the rarity drawn.
  for (let k = 0; k <= r; k++) {
    card.dataset.r = k;
    card.classList.remove("is-step"); void card.offsetWidth; card.classList.add("is-step");
    if (!quick && !skipRef.now) await wait(k === r && r >= 3 ? 520 : 280);
  }
  if (r === 4 && !quick) { stage.classList.add("is-legend"); await wait(350); }
  card.classList.add("is-opened");
  const label = card.querySelector(".tp-label");
  label.textContent = t("questsRarity_" + ORDER[r]);
  burst(card, ORDER[r]);
  if (!quick && !skipRef.now) await wait(650);
}

/** The opened envelopes, one at a time, then the summary. `opened` = [{
 *  rarity, coins }]. `actions` = extra summary buttons [{ id, label, hold }]
 *  (e.g. "Again ×1"); resolves with the id picked, or "done". */
export async function revealPulls(ctx, opened, { actions = [], el: reuse = null } = {}) {
  const { t, esc, lang } = ctx;
  const el = reuse || overlay();
  const list = opened || [];
  const skipRef = { now: false };
  el.innerHTML = `
    <div class="tp-box">
      <div class="tp-top"><span class="tp-count"></span>${list.length > 1 ? `<button type="button" class="tc-code-cancel tp-skip">${esc(t("pullSkip"))}</button>` : ""}</div>
      <div class="tp-stage"></div>
      <p class="tp-hint">${esc(t("pullTapNext"))}</p>
    </div>`;
  const stage = el.querySelector(".tp-stage"), count = el.querySelector(".tp-count");
  el.querySelector(".tp-skip")?.addEventListener("click", e => { e.stopPropagation(); skipRef.now = true; skipRef.next?.(); });
  for (let i = 0; i < list.length && !skipRef.now; i++) {
    count.textContent = list.length > 1 ? `${i + 1} / ${list.length}` : "";
    stage.classList.remove("is-legend");
    await playOne(stage, list[i], ctx, skipRef);
    if (skipRef.now) break;
    // A tap (anywhere) moves on.
    await new Promise(res => {
      skipRef.next = res;
      const go = () => { el.removeEventListener("click", go); res(); };
      el.addEventListener("click", go);
    });
  }
  // The summary: every envelope of this round, rarest first, and the total.
  const sorted = [...list].sort((a, b) => ORDER.indexOf(b.rarity) - ORDER.indexOf(a.rarity) || b.coins - a.coins);
  const total = list.reduce((n, x) => n + (x.coins || 0), 0);
  el.innerHTML = `
    <div class="tc-reveal-card tp-sum" role="dialog" aria-modal="true" aria-label="${esc(t("coinsRevealTitle"))}">
      <h3>${esc(t("coinsRevealTitle"))}</h3>
      <div class="tc-reveal-grid">${sorted.map((x, i) => `
        <div class="tc-sur tc-sur--${x.rarity}" style="--d:${Math.min(i, 30) * 45}ms">
          <span class="tcoin" aria-hidden="true"></span><b>+${x.coins}</b><small>${esc(t("questsRarity_" + x.rarity))}</small>
        </div>`).join("")}</div>
      <p class="tc-reveal-total">${esc(t("coinsRevealTotal", { n: total.toLocaleString(lang) }))}</p>
      <div class="tc-reveal-actions">
        ${actions.map(a => `<button type="button" class="sqd-open tp-hold" data-act="${esc(a.id)}"${a.disabled ? " disabled" : ""}><span class="tp-fill" aria-hidden="true"></span><span>${esc(a.label)}</span></button>`).join("")}
        <button type="button" class="tc-code-cancel" data-act="done">${esc(t("coinsCollect"))}</button>
      </div>
    </div>`;
  return new Promise(resolve => {
    const finish = id => { if (!reuse || id === "done") closeOverlay(el); resolve(id); };
    el.querySelectorAll(".tp-hold[data-act]").forEach(b => holdToFire(b, HOLD_MS, () => finish(b.dataset.act)));
    el.querySelector('[data-act="done"]').addEventListener("click", () => finish("done"));
  });
}

/** The pile, gacha style: a big sealed envelope and "N envelopes left"; hold
 *  the envelope or "Open ×1" for one, "Open ×10" for ten. `pull(n)` asks the
 *  backend ({ opened, unopened }). Loops until the member closes it or the
 *  pile is empty. */
export async function openPullStage(ctx, { left, pull }) {
  const { t, esc } = ctx;
  const el = overlay("tp-stagewrap");
  let remaining = left, pending = 0;
  for (;;) {
    if (remaining <= 0) { closeOverlay(el); return; }
    // "Again ×N" from the summary pulls straight away; otherwise the stage.
    let picked = pending;
    pending = 0;
    if (!picked) {
      const ten = Math.min(10, remaining);
      el.innerHTML = `
        <div class="tp-box">
          <div class="tp-top"><span class="tp-count">${esc(t("pullLeft", { n: remaining }))}</span>
            <button type="button" class="tc-code-cancel tp-close">${esc(t("squadDealsClose"))}</button></div>
          <div class="tp-stage"><button type="button" class="tp-card tp-pile" data-n="1" aria-label="${esc(t("pullOne"))}">${sealedEnvelope()}<span class="tp-ring" aria-hidden="true"></span></button></div>
          <p class="tp-hint">${esc(t("pullHold"))}</p>
          <div class="tc-reveal-actions">
            <button type="button" class="sqd-open tp-hold" data-n="1"><span class="tp-fill" aria-hidden="true"></span><span>${esc(t("pullOne"))}</span></button>
            ${ten > 1 ? `<button type="button" class="sqd-open tp-hold tp-ten" data-n="${ten}"><span class="tp-fill" aria-hidden="true"></span><span>${esc(t("pullMany", { n: ten }))}</span></button>` : ""}
          </div>
        </div>`;
      picked = await new Promise(resolve => {
        el.querySelector(".tp-close").addEventListener("click", () => resolve(0));
        el.querySelectorAll("[data-n]").forEach(b => holdToFire(b, HOLD_MS, () => resolve(Number(b.dataset.n))));
      });
      if (!picked) { closeOverlay(el); return; }
      el.querySelectorAll("button").forEach(b => { b.disabled = true; });
    }
    let r;
    try { r = await pull(picked); }
    catch (_) { ctx.toast?.(t("squadDealsErr")); continue; }
    remaining = r.unopened ?? Math.max(0, remaining - (r.opened?.length || 0));
    const next = Math.min(10, remaining);
    const how = await revealPulls(ctx, r.opened, { el, actions: remaining ? [
      { id: "1", label: t("pullAgain", { n: 1 }) },
      ...(next > 1 ? [{ id: String(next), label: t("pullAgain", { n: next }) }] : []),
    ] : [] });
    if (how === "done") return;
    pending = Number(how) || 0;
  }
}
