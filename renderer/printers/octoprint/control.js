/**
 * printers/octoprint/control.js — OctoPrint plugin, "Control" card.
 *
 *   [Z pill] [XY pad] [step]
 *   Fan [−] 80% [+]      Speed [−] 100% [+]
 *
 * Host jog-pad classes (elg-jog-*, elg-fan-*), like the other brands' control
 * cards. Moves and homing go through OctoPrint's printhead API; fan and speed
 * through G-code (M106/M107, M220). OctoPrint reports neither fan nor speed, so
 * the card shows the last value sent from here ("—" until one was). Moves and
 * homing are locked while printing. Patched in place on every poll, rebuilt only
 * when its structure changes (opControlSig).
 */
import { ctx } from '../context.js';
import { opGetConn, opJog, opHome, opSetFan, opSetSpeed } from './core.js';

const STEPS = [0.1, 1, 10, 50];
const locked = d => d.printState === "printing";
const pctText = v => (v == null ? "—" : `${v}%`);

export function opControlSig(conn) {
  if (!conn?.ready || !conn.data.linkUp) return "";
  return [locked(conn.data) ? 1 : 0, conn._ctrlStep ?? 10].join("|");
}

export function renderOpControlCard(p, conn) {
  if (conn?.status !== "connected" || !conn.ready || !conn.data.linkUp) return "";
  const d = conn.data, step = conn._ctrlStep ?? 10, off = locked(d) ? " disabled" : "";
  const jog = (axis, dist, cls, label) =>
    `<button type="button" class="${cls}" data-op-jog="${axis}" data-dist="${dist}"${off} aria-label="${ctx.esc(`${axis}${dist > 0 ? "+" : "−"}${Math.abs(dist)} mm`)}">${label}</button>`;
  const home = (axes, inner, extra = "") =>
    `<button type="button" class="elg-jog-home-btn${extra}" data-op-home="${axes}"${off} aria-label="${ctx.esc(ctx.t("octoCtrlHome", { axes }))}">${inner}</button>`;
  const homeIcon = `<span class="icon icon-home elg-home-icon" aria-hidden="true"></span>`;
  const stepper = (kind, icon, label, val) => `
    <div class="elg-fan-col">
      <div class="elg-fan-col-head">
        ${kind === "fan"
          ? `<button type="button" class="elg-fan-icon-btn${(val ?? 0) > 0 ? " elg-fan-icon-btn--on" : ""}" data-op-fan-toggle="1" aria-label="${ctx.esc(label)}"><span class="icon icon-${icon} icon-16" aria-hidden="true"></span></button>`
          : `<span class="elg-fan-icon-btn" aria-hidden="true"><span class="icon icon-${icon} icon-16"></span></span>`}
        <span class="elg-fan-col-label">${ctx.esc(label)}</span>
      </div>
      <div class="elg-fan-col-controls">
        <button type="button" class="elg-fan-step-btn" data-op-step-${kind}="-10" aria-label="−10%">−</button>
        <span class="elg-fan-pct" data-op-pct="${kind}">${pctText(val)}</span>
        <button type="button" class="elg-fan-step-btn" data-op-step-${kind}="10" aria-label="+10%">+</button>
      </div>
    </div>`;
  return `
    <section class="snap-block elg-ctrl octo-ctrl${off ? " octo-ctrl--locked" : ""}">
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
          <div class="elg-ctrl-speed-row">
            <span class="elg-ctrl-speed-label" aria-label="${ctx.esc(ctx.t("octoCtrlStep"))}"><span class="icon icon-step icon-14"></span></span>
            <select class="elg-ctrl-speed-select" data-op-jogstep="1" aria-label="${ctx.esc(ctx.t("octoCtrlStep"))}"${off}>
              ${STEPS.map(s => `<option value="${s}"${s === step ? " selected" : ""}>${s} mm</option>`).join("")}
            </select>
          </div>
        </div>
      </div>
      ${off ? `<div class="octo-ctrl-note">${ctx.esc(ctx.t("octoCtrlLocked"))}</div>` : ""}
      <div class="elg-fan-section">
        <div class="elg-fan-cols">
          ${stepper("fan", "fan", ctx.t("octoCtrlFan"), conn.sent.fanPct)}
          ${stepper("speed", "speed", ctx.t("octoCtrlSpeed"), conn.sent.speedPct)}
        </div>
      </div>
    </section>`;
}

export function patchOpControlCard(el, conn) {
  const fan = el.querySelector('[data-op-pct="fan"]');
  if (fan) fan.textContent = pctText(conn.sent.fanPct);
  el.querySelector("[data-op-fan-toggle]")?.classList.toggle("elg-fan-icon-btn--on", (conn.sent.fanPct ?? 0) > 0);
  const spd = el.querySelector('[data-op-pct="speed"]');
  if (spd) spd.textContent = pctText(conn.sent.speedPct);
}

/** Delegated on the live block root, once per root element. */
export function wireOpControl(root, getPrinter) {
  if (!root || root.dataset.opCtrlWired) return;
  root.dataset.opCtrlWired = "1";
  root.addEventListener("click", e => {
    const p = getPrinter(), conn = p && opGetConn(p);
    if (!conn) return;
    const b = e.target.closest("button");
    if (!b || b.disabled || !root.contains(b)) return;
    if (b.dataset.opJog) return void opJog(p, b.dataset.opJog, Number(b.dataset.dist));
    if (b.dataset.opHome) return void opHome(p, b.dataset.opHome);
    const after = () => patchOpControlCard(root, conn);
    if (b.dataset.opFanToggle) { opSetFan(p, (conn.sent.fanPct ?? 0) > 0 ? 0 : 100); return after(); }
    if (b.dataset.opStepFan) { opSetFan(p, (conn.sent.fanPct ?? 0) + Number(b.dataset.opStepFan)); return after(); }
    if (b.dataset.opStepSpeed) { opSetSpeed(p, (conn.sent.speedPct ?? 100) + Number(b.dataset.opStepSpeed)); return after(); }
  });
  root.addEventListener("change", e => {
    const sel = e.target.closest("[data-op-jogstep]");
    if (!sel) return;
    const conn = opGetConn(getPrinter());
    if (conn) conn._ctrlStep = Number(sel.value);
    root.querySelectorAll("[data-op-jog]").forEach(btn => {
      btn.dataset.dist = String((Math.sign(Number(btn.dataset.dist)) || 1) * Number(sel.value));
    });
  });
}
