/**
 * printers/octoprint/cards.js — OctoPrint plugin, side-card widgets.
 *
 * Uses the host's shared card classes (snap-job / snap-temp / snap-fil, the
 * job bar) so an OctoPrint printer reads like every other brand. Reads ctx at
 * call time — never destructured at module scope.
 */
import { ctx } from '../context.js';
import { jobBar, jobBarFill } from '../job-bar.js';
import { opRemainingSec as remainingSec } from './core.js';

export const OP_ACTIVE_STATES = new Set(["printing", "paused"]);

const fmtTempPair = (cur, tgt) => {
  const c = typeof cur === "number" && isFinite(cur) ? `${Math.round(cur)}` : "—";
  return typeof tgt === "number" && tgt > 0 ? `${c}/${Math.round(tgt)}°C` : `${c}°C`;
};
const fmtDuration = sec => {
  const s = Math.max(0, Math.floor(sec || 0)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
};

export function opStateLabel(s) {
  const key = { printing: "snapState_printing", paused: "snapState_paused", complete: "snapState_complete",
                cancelled: "snapState_cancelled", error: "snapState_error", idle: "snapState_standby" }[s];
  const lbl = key ? ctx.t(key) : null;
  return lbl && lbl !== key ? lbl : (s || "—");
}

export function renderOpJobCard(p, conn) {
  if (conn.status !== "connected" || !conn.ready || !conn.data.linkUp) return "";
  const d = conn.data;
  const st = d.printState || "idle";
  const isActive = OP_ACTIVE_STATES.has(st), isDone = st === "complete";
  const bar = jobBar(conn, st, (d.progress || 0) * 100);
  const pct = isActive || bar.tone !== "idle" ? bar.pct : 0;
  const fallbackImg = ctx.printerImageUrlFor(p.brand, p.printerModelId) || ctx.printerImageUrl(ctx.findPrinterModel(p.brand, "0"));
  const thumb = (isActive || isDone) && d.printPreviewUrl ? d.printPreviewUrl : (fallbackImg || "");
  const leaf = (isActive || isDone) && d.printFilename ? String(d.printFilename).split("/").pop() : "";
  const rem = isActive ? remainingSec(d) : null;
  const paused = st === "paused";
  const nameLine = leaf
    ? `<div class="snap-job-name" title="${ctx.esc(leaf)}">${ctx.esc(leaf)}</div>`
    : `<div class="snap-job-name snap-job-name--idle">${ctx.esc(ctx.t("snapJobNoActive") || "—")}</div>`;
  const btns = isActive ? `
      <button type="button" class="cre-action-btn cre-action-btn--pause" data-op-job="${paused ? "resume" : "pause"}"
              aria-label="${ctx.esc(paused ? ctx.t("snapPrintResume") : ctx.t("snapPrintPause"))}">
        <span class="icon ${paused ? "icon-play" : "icon-pause"} icon-14"></span><span class="hold-progress"></span>
      </button>
      <button type="button" class="cre-action-btn cre-action-btn--stop" data-op-job="stop" aria-label="${ctx.esc(ctx.t("snapPrintCancel"))}">
        <span class="icon icon-stop icon-14"></span><span class="hold-progress"></span>
      </button>` : "";
  const layer = isActive && d.currentLayer != null && d.totalLayer
    ? `<span class="snap-job-layer">${d.currentLayer}/${d.totalLayer}</span>` : "";
  return `
    <div class="snap-job snap-job--${ctx.esc(st)}">
      <div class="snap-job-thumb"${thumb ? ` style="background-image:url('${ctx.esc(thumb)}')"` : ""}></div>
      <div class="snap-job-info">
        <div class="elg-job-name-row elg-job-name-row--with-btns">
          ${nameLine}
          <div class="cre-actions elg-job-actions">${btns}</div>
        </div>
        <div class="snap-job-stats">
          <span class="snap-job-pct">${pct}%</span>
          <span class="snap-job-time">${ctx.SNAP_ICON_CLOCK} <span>${ctx.esc(rem != null ? fmtDuration(rem) : isActive ? "—" : "0m")}</span></span>
          ${layer}
        </div>
        <div class="snap-job-bar">${jobBarFill(bar)}</div>
        <div class="snap-job-foot">
          <span class="snap-job-state snap-job-state--${ctx.esc(st)}">${ctx.esc(opStateLabel(st))}</span>
        </div>
      </div>
    </div>`;
}

export function renderOpTempCard(conn) {
  if (!conn?.ready || !conn.data.linkUp) return "";
  const t = conn.data?.temps || {};
  const pill = (label, icon, cur, tgt, cls = "") => {
    const heating = typeof tgt === "number" && tgt > 0 && typeof cur === "number" && cur < tgt - 1;
    return `
      <div class="snap-temp${cls}${heating ? " snap-temp--heating" : ""}">
        <span class="snap-temp-label">${ctx.esc(label)}</span>${icon}
        <span class="snap-temp-val">${ctx.esc(fmtTempPair(cur, tgt))}</span>
      </div>`;
  };
  const tools = t.tools || [];
  const pills = tools.filter(x => typeof x.cur === "number")
    .map(x => pill(tools.length > 1 ? x.label : "E1", ctx.SNAP_ICON_NOZZLE, x.cur, x.tgt));
  if (typeof t.bed === "number") pills.push(pill("BED", ctx.SNAP_ICON_BED, t.bed, t.bedTarget, " snap-temp--bed"));
  if (typeof t.chamber === "number") pills.push(pill("CASE", ctx.SNAP_ICON_CHAMBER, t.chamber, t.chamberTarget, " snap-temp--chamber"));
  if (!pills.length) return "";
  return `
    <section class="snap-block">
      <h4 class="snap-block-title">${ctx.esc(ctx.t("snapTemperatureTitle"))}</h4>
      <div class="snap-temps">${pills.join("")}</div>
    </section>`;
}

/* OctoPrint keeps no filament identity: a slot would only ever read "—", so no
   filament card is drawn at all rather than one full of empty squares. */
export function renderOpFilamentCard() { return ""; }
