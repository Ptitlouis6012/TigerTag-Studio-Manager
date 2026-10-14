/**
 * printers/beta-badge.js — the "Beta" mark of a beta printer, in the brand picker
 * and at the top of its live block (Klipper, Prusa, Elegoo CC1): the Beta tag plus an ⓘ
 * whose hover bubble says what beta means. Host service — any brand or plugin
 * may use it. The bubble is the app's shared #toolInfoPop, reached through the
 * document-level `.eac-info[data-tip]` delegation in inventory.js.
 */
import { ctx } from './context.js';

/** The tag + ⓘ pair, inline — the brand picker puts it next to the brand name. */
export function betaBadgeInlineHtml() {
  const tip = ctx.t("printerBetaNote");
  return `<span class="pba-beta-tag">${ctx.esc(ctx.t("betaTag"))}</span><span class="eac-info printer-beta-info" tabindex="0" role="button" data-tip="${ctx.esc(tip)}" aria-label="${ctx.esc(tip)}"><span class="icon icon-info icon-13"></span></span>`;
}

/** The same pair on its own row, at the top of a live block. */
export function betaBadgeHtml() {
  return `<div class="printer-beta-row">${betaBadgeInlineHtml()}</div>`;
}
