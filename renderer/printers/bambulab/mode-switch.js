/**
 * printers/bambulab/mode-switch.js — Cloud ⇄ LAN switch in the settings form.
 *
 * A printer added through the Bambu account already carries everything a LAN
 * connection needs: its serial (the cloud dev_id), its access code (filed at add
 * time) and its address (learned from its own telemetry, saved as `broker`). So
 * the owner can move it to the local broker — and back — without re-adding it.
 *
 * One switch, a "Cloud | LAN" pill whose knob slides from side to side, on the
 * row of the "Connection tutorial" key: flipping it changes nothing else on the page. Shown only on a
 * machine that came from the cloud (doc id `cloud_<devId>`): a LAN-only printer
 * has no account to fall back to.
 */

/** Did this printer come from the Bambu account (so it may go either way)? */
export const bambuCanSwitchMode = p => !!p && p.brand === "bambulab" && String(p.id || "").startsWith("cloud_");

/** Insert the switch at the top of the form body (edit mode only). */
export function renderBambuModeSwitch(printer, bodyEl, { t, esc }) {
  if (!bambuCanSwitchMode(printer) || !bodyEl) return;
  const lan = printer.mode !== "cloud";
  const pill = document.createElement("button");
  pill.type = "button";
  pill.className = "bbl-mode-pill";
  pill.setAttribute("role", "switch");
  pill.setAttribute("aria-checked", String(lan));
  pill.setAttribute("aria-label", `${t("printerConnModeLabel")}: ${t("printerConnModeCloud")} / ${t("printerConnModeLan")}`);
  pill.innerHTML = `
      <span class="bbl-mode-knob" aria-hidden="true"></span>
      <span class="bbl-mode-opt" data-bbl-side="cloud">${esc(t("printerConnModeCloud"))}</span>
      <span class="bbl-mode-opt" data-bbl-side="lan">${esc(t("printerConnModeLan"))}</span>`;
  // Same row as the "Connection tutorial" key, on its right.
  const row = document.createElement("div");
  row.className = "bbl-mode-switch";
  const tuto = bodyEl.querySelector(":scope > .pba-tuto-pill");
  if (tuto) { tuto.replaceWith(row); row.append(tuto); } else bodyEl.prepend(row);
  row.append(pill);
  pill.addEventListener("click", () => pill.setAttribute("aria-checked", String(pill.getAttribute("aria-checked") !== "true")));
}

/** "cloud" | "lan" | null (no switch on this form). */
export function readBambuModeSwitch(bodyEl) {
  const pill = bodyEl?.querySelector(".bbl-mode-switch .bbl-mode-pill");
  return pill ? (pill.getAttribute("aria-checked") === "true" ? "lan" : "cloud") : null;
}
