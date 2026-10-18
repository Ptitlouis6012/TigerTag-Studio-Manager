/**
 * printers/model-list.js — "Which printer is it?": one connector's models, with
 * their pictures and a search, embedded in a plugin's add-flow choice card
 * (Klipper, OctoPrint — their catalogues run to 150+ machines). Picking one is
 * optional; the pick rides into the settings form (model + name) through the
 * flow's prefill. Host service, same look as the settings model picker
 * (.pba-mp-*), same word search ("v2 ender" finds "Ender-3 V2").
 *
 *   mountModelList(container, brand, onChange)  → { reset() }
 *   onChange({ id, name } | null)
 */
import { ctx } from './context.js';

const norm = v => String(v || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ");

export function mountModelList(container, brand, onChange) {
  if (!container) return { reset() {} };
  const models = (ctx.getState().db?.printerModels?.[brand] || []).filter(m => String(m.id) !== "0");
  const thumb = m => {
    const url = ctx.printerImageUrl(m);
    return url ? `<img src="${ctx.esc(url)}" alt="" loading="lazy" onerror="this.style.opacity='.15'"/>` : "";
  };
  container.innerHTML = `
    <div class="pba-models-head">
      <span class="pba-models-title">${ctx.esc(ctx.t("printerModelPickTitle"))}</span>
      <span class="pba-models-hint">${ctx.esc(ctx.t("printerModelPickHint"))}</span>
    </div>
    <div class="pba-mp-search-row pba-models-search">
      <span class="icon icon-search icon-13" aria-hidden="true"></span>
      <input type="text" class="pba-mp-search" placeholder="${ctx.esc(ctx.t("printerModelSearchPh"))}"
             aria-label="${ctx.esc(ctx.t("printerModelSearchPh"))}" autocomplete="off" spellcheck="false"/>
    </div>
    <div class="pba-models-list" role="listbox">
      ${models.map(m => `
        <button type="button" class="pba-mp-opt" role="option" aria-selected="false" data-id="${ctx.esc(m.id)}" data-name="${ctx.esc(m.name)}">
          <span class="pba-mp-thumb">${thumb(m)}</span>
          <span class="pba-mp-name">${ctx.esc(m.name)}</span>
          <span class="icon icon-check icon-13 pba-models-check" aria-hidden="true"></span>
        </button>`).join("")}
      <div class="pba-mp-empty" hidden>${ctx.esc(ctx.t("printerModelSearchEmpty"))}</div>
    </div>`;

  const search = container.querySelector(".pba-mp-search");
  const empty = container.querySelector(".pba-mp-empty");
  const opts = [...container.querySelectorAll(".pba-mp-opt")];
  const filter = () => {
    const words = norm(search.value).split(" ").filter(Boolean);
    let shown = 0;
    for (const o of opts) {
      const hit = !words.length || words.every(w => norm(o.dataset.name).includes(w));
      o.hidden = !hit;
      if (hit) shown++;
    }
    empty.hidden = shown > 0;
  };
  const select = opt => {
    for (const o of opts) {
      const on = o === opt;
      o.classList.toggle("pba-mp-opt--selected", on);
      o.setAttribute("aria-selected", on ? "true" : "false");
    }
    onChange(opt ? { id: opt.dataset.id, name: opt.dataset.name } : null);
  };
  search.addEventListener("input", filter);
  search.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); opts.find(o => !o.hidden)?.click(); }
  });
  // Click picks; clicking the picked one again lets it go (the pick is optional).
  container.querySelector(".pba-models-list").addEventListener("click", e => {
    const opt = e.target.closest(".pba-mp-opt");
    if (opt) select(opt.classList.contains("pba-mp-opt--selected") ? null : opt);
  });

  return {
    reset() { search.value = ""; filter(); select(null); container.querySelector(".pba-models-list").scrollTop = 0; },
  };
}
