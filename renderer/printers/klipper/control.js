/**
 * printers/klipper/control.js — Klipper plugin, "Control" card.
 *
 *   [Z pill] [XY pad]  [lights · position · step]
 *   Fan [−] 80% [+]      Speed [−] 100% [+]
 *
 * Uses the host's shared jog-pad classes (elg-jog-*, elg-fan-*) so the card
 * reads like the other brands' control cards. Everything is G-code through
 * core.js (G91/G1/G90, G28, M106/M107, M220, SET_PIN / SET_LED). Moves and
 * homing are locked while a print runs; fan and speed stay live — that is when
 * they matter. Patched in place on every poll (patchControlCard), rebuilt only
 * when its structure changes (controlSig), so a click never lands on a node
 * that is being replaced.
 */
import { ctx } from '../context.js';
import {
  klipperGetConn, klipperJog, klipperHome, klipperSetFan, klipperSetSpeed, klipperSetLight,
} from './core.js';

const STEPS = [0.1, 1, 10, 50];
const fmtPos = v => (typeof v === "number" && isFinite(v) ? v.toFixed(1) : "—");
const locked = d => d.printState === "printing";

/** What the card's markup depends on (beyond the patched values). */
export function controlSig(conn) {
  if (!conn?.ready) return "";
  const d = conn.data;
  return [locked(d) ? 1 : 0, conn._ctrlStep ?? 10, (conn.features.lights || []).map(l => l.obj).join(",")].join("|");
}

function posHtml(d) {
  const p = d.pos || [];
  return `<span>X:<b>${ctx.esc(fmtPos(p[0]))}</b></span><span>Y:<b>${ctx.esc(fmtPos(p[1]))}</b></span><span>Z:<b>${ctx.esc(fmtPos(p[2]))}</b></span>`;
}

export function renderControlCard(p, conn) {
  if (conn?.status !== "connected" || !conn.ready) return "";
  const d = conn.data, step = conn._ctrlStep ?? 10, off = locked(d) ? " disabled" : "";
  const jog = (axis, dist, cls, label) =>
    `<button type="button" class="${cls}" data-klp-jog="${axis}" data-dist="${dist}"${off} aria-label="${ctx.esc(`${axis}${dist > 0 ? "+" : "−"}${Math.abs(dist)} mm`)}">${label}</button>`;
  const home = (axes, inner, extra = "") =>
    `<button type="button" class="elg-jog-home-btn${extra}" data-klp-home="${axes}"${off} aria-label="${ctx.esc(ctx.t("klipperCtrlHome", { axes }))}">${inner}</button>`;
  const homeIcon = `<span class="icon icon-home elg-home-icon" aria-hidden="true"></span>`;
  const lights = (d.lights || []).map((l, i) => `
    <button type="button" class="cre-action-btn cre-action-btn--led elg-ctrl-action${l.on ? " cre-action-btn--led-on" : ""}"
            data-klp-light="${i}" aria-label="${ctx.esc(`${ctx.t("klipperCtrlLight")} ${l.name}`)}" aria-pressed="${l.on}">
      <span class="icon icon-bulb icon-16"></span>
    </button>`).join("");
  const stepper = (kind, icon, label, pct) => `
    <div class="elg-fan-col">
      <div class="elg-fan-col-head">
        ${kind === "fan"
          ? `<button type="button" class="elg-fan-icon-btn${pct > 0 ? " elg-fan-icon-btn--on" : ""}" data-klp-fan-toggle="1" aria-label="${ctx.esc(label)}"><span class="icon icon-${icon} icon-16" aria-hidden="true"></span></button>`
          : `<span class="elg-fan-icon-btn" aria-hidden="true"><span class="icon icon-${icon} icon-16"></span></span>`}
        <span class="elg-fan-col-label">${ctx.esc(label)}</span>
      </div>
      <div class="elg-fan-col-controls">
        <button type="button" class="elg-fan-step-btn" data-klp-step-${kind}="-10" aria-label="−10%">−</button>
        <span class="elg-fan-pct" data-klp-pct="${kind}">${pct}%</span>
        <button type="button" class="elg-fan-step-btn" data-klp-step-${kind}="10" aria-label="+10%">+</button>
      </div>
    </div>`;
  return `
    <section class="snap-block elg-ctrl klipper-ctrl${off ? " klipper-ctrl--locked" : ""}">
      <div class="elg-jog-wrap">
        <div class="elg-jog-z-pill">
          ${jog("Z", step, "elg-jog-z-btn", "Z↑")}
          ${home("Z", homeIcon)}
          ${jog("Z", -step, "elg-jog-z-btn", "Z↓")}
        </div>
        <div class="elg-jog-xy-circle">
          ${jog("Y", step, "elg-jog-xy-btn elg-jog-xy-btn--n", "Y+")}
          ${jog("Y", -step, "elg-jog-xy-btn elg-jog-xy-btn--s", "Y−")}
          ${jog("X", -step, "elg-jog-xy-btn elg-jog-xy-btn--w", "X−")}
          ${jog("X", step, "elg-jog-xy-btn elg-jog-xy-btn--e", "X+")}
          ${home("XY", homeIcon, " elg-jog-home-btn--xy")}
          <div class="elg-jog-sector elg-jog-sector--n" aria-hidden="true"></div>
          <div class="elg-jog-sector elg-jog-sector--s" aria-hidden="true"></div>
          <div class="elg-jog-sector elg-jog-sector--w" aria-hidden="true"></div>
          <div class="elg-jog-sector elg-jog-sector--e" aria-hidden="true"></div>
        </div>
        <div class="elg-jog-right-pill">
          ${home("Y", `<span class="elg-jog-home-axis">Y</span>${homeIcon}`)}
          ${home("X", `<span class="elg-jog-home-axis">X</span>${homeIcon}`)}
        </div>
        <div class="elg-jog-info-col">
          ${lights ? `<div class="elg-ctrl-actions">${lights}</div>` : ""}
          <div class="snap-ctrl-pos" data-klp-pos="1">${posHtml(d)}</div>
          <div class="elg-ctrl-speed-row">
            <span class="elg-ctrl-speed-label" aria-label="${ctx.esc(ctx.t("klipperCtrlStep"))}"><span class="icon icon-step icon-14"></span></span>
            <select class="elg-ctrl-speed-select" data-klp-jogstep="1" aria-label="${ctx.esc(ctx.t("klipperCtrlStep"))}"${off}>
              ${STEPS.map(s => `<option value="${s}"${s === step ? " selected" : ""}>${s} mm</option>`).join("")}
            </select>
          </div>
        </div>
      </div>
      ${off ? `<div class="klipper-ctrl-note">${ctx.esc(ctx.t("klipperCtrlLocked"))}</div>` : ""}
      <div class="elg-fan-section">
        <div class="elg-fan-cols">
          ${stepper("fan", "fan", ctx.t("klipperCtrlFan"), d.fanPct ?? 0)}
          ${stepper("speed", "speed", ctx.t("klipperCtrlSpeed"), d.speedPct ?? 100)}
        </div>
      </div>
    </section>`;
}

/** Values only — no markup rebuilt. */
export function patchControlCard(el, conn) {
  const d = conn.data;
  const fan = el.querySelector('[data-klp-pct="fan"]');
  if (fan) fan.textContent = `${d.fanPct ?? 0}%`;
  el.querySelector("[data-klp-fan-toggle]")?.classList.toggle("elg-fan-icon-btn--on", (d.fanPct ?? 0) > 0);
  const spd = el.querySelector('[data-klp-pct="speed"]');
  if (spd) spd.textContent = `${d.speedPct ?? 100}%`;
  const pos = el.querySelector("[data-klp-pos]");
  if (pos) pos.innerHTML = posHtml(d);
  el.querySelectorAll("[data-klp-light]").forEach(b => {
    const on = !!d.lights?.[Number(b.dataset.klpLight)]?.on;
    b.classList.toggle("cre-action-btn--led-on", on);
    b.setAttribute("aria-pressed", String(on));
  });
}

/** Delegated on the live block root, once per root element. */
export function wireControl(root, getPrinter) {
  if (!root || root.dataset.klpCtrlWired) return;
  root.dataset.klpCtrlWired = "1";
  root.addEventListener("click", e => {
    const p = getPrinter(), conn = p && klipperGetConn(p);
    if (!conn) return;
    const d = conn.data;
    const b = e.target.closest("button");
    if (!b || b.disabled || !root.contains(b)) return;
    if (b.dataset.klpJog) return void klipperJog(p, b.dataset.klpJog, Number(b.dataset.dist));
    if (b.dataset.klpHome) return void klipperHome(p, b.dataset.klpHome);
    if (b.dataset.klpLight != null) {
      const l = d.lights?.[Number(b.dataset.klpLight)];
      if (l) { l.on = !l.on; patchControlCard(root, conn); klipperSetLight(p, l, l.on); }
      return;
    }
    if (b.dataset.klpFanToggle) {
      const next = (d.fanPct ?? 0) > 0 ? 0 : 100;
      d.fanPct = next; patchControlCard(root, conn); klipperSetFan(p, next);
      return;
    }
    if (b.dataset.klpStepFan) {
      const next = Math.max(0, Math.min(100, (d.fanPct ?? 0) + Number(b.dataset.klpStepFan)));
      d.fanPct = next; patchControlCard(root, conn); klipperSetFan(p, next);
      return;
    }
    if (b.dataset.klpStepSpeed) {
      const next = Math.max(10, Math.min(300, (d.speedPct ?? 100) + Number(b.dataset.klpStepSpeed)));
      d.speedPct = next; patchControlCard(root, conn); klipperSetSpeed(p, next);
    }
  });
  root.addEventListener("change", e => {
    const sel = e.target.closest("[data-klp-jogstep]");
    if (!sel) return;
    const conn = klipperGetConn(getPrinter());
    if (conn) conn._ctrlStep = Number(sel.value);
    root.querySelectorAll("[data-klp-jog]").forEach(btn => {
      const sign = Math.sign(Number(btn.dataset.dist)) || 1;
      btn.dataset.dist = String(sign * Number(sel.value));
    });
  });
}
