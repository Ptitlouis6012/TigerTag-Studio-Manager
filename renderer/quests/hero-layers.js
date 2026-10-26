/**
 * quests/hero-layers.js — banner scenes built from separate layers
 * (docs/ART-DIRECTION.md: "Banners are delivered as separate elements").
 *
 * Two planes with the same geometry, inside a hero's `.hero-scene`:
 *   back  — drawn BEHIND the desk (a character cut at the waist, still);
 *   front — drawn ON the desk (objects whose base rests in its top stripe).
 * Each plane holds a box of fixed proportions (--hl-ratio on the hero) where
 * every object is placed in % (quests.css, `.hl--<name>` per banner).
 *
 *   heroLayersHtml(dir, { back: [items], front: [items] })
 *   item: "bag" → <dir>bag.webp with class hl--bag,
 *         { name, cls } → <dir><name>.webp with class hl--<cls>,
 *         { html } → that markup as it is (e.g. an easter egg).
 */
export function heroLayersHtml(dir, { back = [], front = [] }) {
  const img = it => typeof it === "string"
    ? `<img class="hl hl--${it}" src="${dir}${it}.webp" alt="" draggable="false">`
    : it.html || `<img class="hl hl--${it.cls || it.name}" src="${dir}${it.name}.webp" alt="" draggable="false">`;
  const plane = (items, cls) => items.length ? `<div class="hl-scene${cls}"><div class="hl-box">${items.map(img).join("")}</div></div>` : "";
  return plane(back, " hl-scene--back") + plane(front, "");
}
