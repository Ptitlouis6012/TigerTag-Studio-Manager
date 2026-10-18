/**
 * printers/temp-edit.js — click a temperature pill to type a new target.
 *
 * The same inline editor the built-in brands use (Bambu, Snapmaker, Elegoo…),
 * packaged for plugins. A pill opts in with three attributes:
 *
 *   <div class="snap-temp snap-temp--editable"
 *        data-temp-set="<heater id>" data-temp-target="210" data-temp-max="300">
 *
 * wireTempEdit(root, onSet) delegates on `root` once; Enter or blur sends
 * onSet(heaterId, value), Escape cancels. The live block must be refreshed with
 * morphInner (dom-morph.js), which leaves a `.snap-temp--editing` pill alone, so
 * an incoming poll cannot close the editor.
 */

/** Attributes that make a pill editable (spread into its opening tag). */
export function tempEditAttrs(id, target, max) {
  return ` data-temp-set="${String(id).replace(/"/g, "&quot;")}" data-temp-target="${Math.max(0, Math.round(Number(target) || 0))}" data-temp-max="${max}"`;
}

export function wireTempEdit(root, onSet) {
  if (!root || root.dataset.tempEditWired) return;
  root.dataset.tempEditWired = "1";
  root.addEventListener("click", e => {
    const pill = e.target.closest("[data-temp-set]");
    if (!pill || !root.contains(pill) || pill.classList.contains("snap-temp--editing")) return;
    const valEl = pill.querySelector(".snap-temp-val");
    if (!valEl) return;
    const max = parseInt(pill.dataset.tempMax ?? "300", 10);
    const input = document.createElement("input");
    input.type = "number"; input.min = "0"; input.max = String(max);
    input.value = pill.dataset.tempTarget ?? "0"; input.className = "snap-temp-set-input";
    pill.classList.add("snap-temp--editing");
    valEl.replaceWith(input);
    input.focus(); input.select();
    let done = false;
    const restore = () => {
      if (done) return;
      done = true;
      if (input.parentNode) { try { input.replaceWith(valEl); } catch (_) {} }
      pill.classList.remove("snap-temp--editing");
    };
    const confirm = () => {
      if (done) return;
      const v = parseInt(input.value, 10);
      if (!isNaN(v) && v >= 0 && v <= max) onSet(pill.dataset.tempSet, v);
      restore();
    };
    input.addEventListener("keydown", ev => {
      if (ev.key === "Enter") { ev.preventDefault(); confirm(); }
      if (ev.key === "Escape") { ev.preventDefault(); restore(); }
    });
    input.addEventListener("blur", confirm);
  });
}
