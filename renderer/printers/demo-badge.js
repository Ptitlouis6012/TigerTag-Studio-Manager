/**
 * printers/demo-badge.js — the "Demo" mark of a demo printer (docs/DEMO-MODE.md):
 * a printer record flagged `demo: true`, answered by the simulator in the main
 * process. Shown next to its name on the board card, in its side-card title and
 * in the Add-a-printer card. Host service, any brand. The ⓘ bubble uses the
 * app's shared #toolInfoPop (document-level `.eac-info[data-tip]` delegation).
 */
import { ctx } from './context.js';

/** The Demo tag + ⓘ pair, inline. */
export function demoTagHtml() {
  const tip = ctx.t("demoTagInfo");
  return `<span class="printer-demo-tag">${ctx.esc(ctx.t("demoTag"))}</span><span class="eac-info printer-beta-info printer-demo-info" tabindex="0" role="button" data-tip="${ctx.esc(tip)}" aria-label="${ctx.esc(tip)}"><span class="icon icon-info icon-13"></span></span>`;
}

/** The account's demo records, as plain data for the simulator (its own fields only). */
export function demoRecords(printers) {
  return (printers || []).filter(p => p && p.demo === true)
    .map(p => Object.fromEntries(Object.entries(p).filter(([, v]) => v == null || typeof v !== "object")));
}

/**
 * Demo printers served on this computer's NETWORK address (`demoLan: true`,
 * for devices that test against the simulator) follow the computer when its
 * address changes: the host part of their address — and of a camera URL — is
 * rewritten to the current one, the port kept. `save(printer, fields)` writes.
 */
export async function repointLanDemos(printers, save) {
  const lan = (printers || []).filter(p => p?.demo === true && p.demoLan === true);
  if (!lan.length || !window.demoMode?.lanHost) return;
  const host = await window.demoMode.lanHost().catch(() => null);
  if (!host) return;
  for (const p of lan) {
    const key = p.brand === "bambulab" ? "broker" : "ip";
    const cur = String(p[key] || "");
    const m = cur.match(/^(https?:\/\/)?([\d.]+)(:\d+)?$/);
    if (!m || m[2] === host) continue;
    const fields = { [key]: `${m[1] || ""}${host}${m[3] || ""}` };
    if (p.cameraUrl) fields.cameraUrl = String(p.cameraUrl).replace(m[2], host);
    try { await save(p, fields); } catch (e) { console.warn("[demo] re-point failed:", e?.message); }
  }
}

/** Tell the simulator which demo printers the account holds (it starts / stops their faces). */
let _lastSig = null;
export function syncDemoPrinters(printers) {
  const demo = demoRecords(printers).map(({ updatedAt, sortIndex, isActive, printerName, ...r }) => r);
  const sig = JSON.stringify(demo);
  if (sig === _lastSig || !window.demoMode) return;
  _lastSig = sig;
  window.demoMode.sync(demo).then(res => {
    for (const r of res || []) if (!r.ok) console.warn(`[demo] ${r.id}: ${r.error}`);
  }).catch(e => console.warn("[demo] sync failed:", e?.message));
}
