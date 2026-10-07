/**
 * printers/prusa/cards.js — Prusa live-block card widgets.
 *
 * Same markup and classes as the other brands' cards (snap-job / snap-temp /
 * snap-fil), so the side card reads identically whatever the printer.
 * All functions read from ctx at call time — never destructure ctx at module
 * scope, so inventory.js can populate it after import resolution.
 */
import { ctx } from '../context.js';
import { jobBar, jobBarFill } from '../job-bar.js';

function fmtTempPair(cur, tgt) {
  const c = (typeof cur === "number" && isFinite(cur)) ? `${Math.round(cur)}` : "—";
  return (typeof tgt === "number" && isFinite(tgt)) ? `${c}/${Math.round(tgt)}°C` : `${c}°C`;
}

function fmtDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m.toString().padStart(2, "0")}m` : `${m}m`;
}

// PrusaLink state (normalised to lowercase by index.js) → shared label keys.
// `attention` is a Prusa thing: the printer stopped and waits for a human
// (filament runout, MMU load failure, crash detection…).
export const PRUSA_ACTIVE_STATES = new Set(["printing", "paused", "attention"]);
export function prusaStateLabel(s) {
  const aliases = {
    printing:  "snapState_printing",
    paused:    "snapState_paused",
    complete:  "snapState_complete",
    cancelled: "snapState_cancelled",
    error:     "snapState_error",
    idle:      "snapState_standby",
    ready:     "ffgState_ready",
    busy:      "ffgState_busy",
    attention: "prusaState_attention",
  };
  const key = aliases[s];
  if (!key) return s || "—";
  const lbl = ctx.t(key);
  return lbl && lbl !== key ? lbl : (s || "—");
}

export function renderPrusaJobCard(p, conn) {
  if (conn.status !== "connected") return "";
  const d = conn.data;
  const jobState = d.printState || "idle";
  const isActive = PRUSA_ACTIVE_STATES.has(jobState);
  const isDone   = jobState === "complete";
  const bar      = jobBar(conn, jobState, (d.progress || 0) * 100);
  const pct      = isActive || bar.tone !== "idle" ? bar.pct : 0;
  const fallbackImg = ctx.printerImageUrlFor(p.brand, p.printerModelId)
                   || ctx.printerImageUrl(ctx.findPrinterModel(p.brand, "0"));
  const thumbUrl = ((isActive || isDone) && d.printPreviewUrl) ? d.printPreviewUrl : (fallbackImg || "");
  const leafName = (isActive || isDone) && d.printFilename ? String(d.printFilename).split("/").pop() : "";
  const timeText = isActive ? (d.printEstimated != null ? fmtDuration(d.printEstimated) : "—") : "0m";
  const isPaused = jobState === "paused" || jobState === "attention";
  const nameLine = leafName
    ? `<div class="snap-job-name" title="${ctx.esc(leafName)}">${ctx.esc(leafName)}</div>`
    : `<div class="snap-job-name snap-job-name--idle">${ctx.esc(ctx.t("snapJobNoActive") || "—")}</div>`;
  // Pause/resume + stop, both held (1.2 s / 1.5 s) like every other brand.
  const jobBtns = isActive && d.jobId != null ? `
      <button type="button" class="cre-action-btn cre-action-btn--pause" data-prusa-job="${isPaused ? "resume" : "pause"}"
              aria-label="${ctx.esc(isPaused ? ctx.t("snapPrintResume") : ctx.t("snapPrintPause"))}">
        <span class="icon ${isPaused ? "icon-play" : "icon-pause"} icon-14"></span>
        <span class="hold-progress"></span>
      </button>
      <button type="button" class="cre-action-btn cre-action-btn--stop" data-prusa-job="stop"
              aria-label="${ctx.esc(ctx.t("snapPrintCancel"))}">
        <span class="icon icon-stop icon-14"></span>
        <span class="hold-progress"></span>
      </button>` : "";
  return `
    <div class="snap-job snap-job--${ctx.esc(jobState)}">
      <div class="snap-job-thumb"${thumbUrl ? ` style="background-image:url('${ctx.esc(thumbUrl)}')"` : ""}></div>
      <div class="snap-job-info">
        <div class="elg-job-name-row elg-job-name-row--with-btns">
          ${nameLine}
          <div class="cre-actions elg-job-actions">${jobBtns}</div>
        </div>
        <div class="snap-job-stats">
          <span class="snap-job-pct">${pct}%</span>
          <span class="snap-job-time">${ctx.SNAP_ICON_CLOCK} <span>${ctx.esc(timeText)}</span></span>
        </div>
        <div class="snap-job-bar">${jobBarFill(bar)}</div>
        <div class="snap-job-foot">
          <span class="snap-job-state snap-job-state--${ctx.esc(jobState)}">${ctx.esc(prusaStateLabel(jobState))}</span>
        </div>
      </div>
    </div>`;
}

export function renderPrusaTempCard(conn) {
  const t = conn.data?.temps || {};
  const pills = [];
  const pill = (label, icon, cur, tgt, cls = "") => {
    const heating = typeof tgt === "number" && tgt > 0 && typeof cur === "number" && cur < tgt - 1;
    return `
      <div class="snap-temp${cls}${heating ? " snap-temp--heating" : ""}">
        <span class="snap-temp-label">${label}</span>
        ${icon}
        <span class="snap-temp-val">${ctx.esc(fmtTempPair(cur, tgt))}</span>
      </div>`;
  };
  if (typeof t.nozzle === "number") pills.push(pill("E1", ctx.SNAP_ICON_NOZZLE, t.nozzle, t.nozzleTarget));
  if (typeof t.bed === "number")    pills.push(pill("BED", ctx.SNAP_ICON_BED, t.bed, t.bedTarget, " snap-temp--bed"));
  if (typeof t.chamber === "number") pills.push(pill("CASE", ctx.SNAP_ICON_CHAMBER, t.chamber, t.chamberTarget, " snap-temp--chamber"));
  if (!pills.length) return "";
  return `
    <section class="snap-block">
      <h4 class="snap-block-title">${ctx.esc(ctx.t("snapTemperatureTitle"))}</h4>
      <div class="snap-temps">${pills.join("")}</div>
    </section>`;
}

// Fans + speed / flow — read-only (PrusaLink exposes no command for them).
export function renderPrusaStatusCard(conn) {
  if (conn.status !== "connected") return "";
  const d = conn.data;
  const chip = (icon, label, val) => `
    <div class="ffg-chip"><span class="icon icon-${icon} icon-13"></span><span>${ctx.esc(label)} ${ctx.esc(val)}</span></div>`;
  const chips = [];
  if (typeof d.fans?.print === "number")  chips.push(chip("fan", ctx.t("ffgFanCooling") || "Fan", `${Math.round(d.fans.print)}%`));
  if (typeof d.speed === "number")        chips.push(chip("speed", ctx.t("prusaSpeed") || "Speed", `${Math.round(d.speed)}%`));
  if (typeof d.flow === "number")         chips.push(chip("droplets", ctx.t("prusaFlow") || "Flow", `${Math.round(d.flow)}%`));
  if (!chips.length) return "";
  return `<section class="snap-block ffg-status-block"><div class="ffg-status-row">${chips.join("")}</div></section>`;
}

// One square per slot: the MMU's 5 bays, an XL's tools, or the single nozzle.
// PrusaLink does not report what is loaded, so a slot shows the material the
// running job asked for (from the G-code metadata) — and nothing otherwise.
export function renderPrusaFilamentCard(p, conn) {
  const fils = Array.isArray(conn.data?.filaments) ? conn.data.filaments : [];
  if (!fils.length) return "";
  const cards = fils.map((f) => {
    const has = !!(f.type || f.color);
    const style = f.color ? `background:${ctx.esc(f.color)};color:${ctx.esc(ctx.snapTextColor(f.color))};` : "";
    return `
      <div class="snap-fil${f.isActive ? " snap-fil--active" : ""}">
        <div class="snap-fil-tag">${ctx.esc(f.label)}</div>
        <div class="snap-fil-square ${f.color ? "snap-fil-square--filled" : "snap-fil-square--empty"}" style="${style}">
          <span class="snap-fil-main">${ctx.esc(has ? (f.type || "—") : "—")}</span>
        </div>
        <div class="snap-fil-meta"><div class="snap-fil-sub">${ctx.esc(f.type || "—")}</div></div>
      </div>`;
  });
  return `
    <section class="snap-block">
      <h4 class="snap-block-title">${ctx.esc(ctx.t("snapFilamentTitle"))}${conn.data?.info?.mmu ? ` <span class="prusa-mmu-tag">MMU</span>` : ""}</h4>
      <div class="snap-fil-grid">${cards.join("")}</div>
    </section>`;
}
