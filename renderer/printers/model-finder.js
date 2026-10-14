/**
 * printers/model-finder.js — "Find your printer" across every connector.
 *
 * The brand picker used to ask for the CONNECTOR first (Creality? Klipper?),
 * which is a question about protocols the user should not need to answer. This
 * indexes every printer model of every catalogue — the hand-wired brands' and
 * the plugins' (Klipper, OctoPrint…) — under one name per machine, so a search
 * finds the machine and lists the ways Studio can reach it: one → straight to
 * that connector; several (a Creality K1: Creality or Klipper) → the user picks.
 *
 * A hand-wired brand's catalogue names its models bare ("K1"); a plugin's names
 * carry the maker ("Creality K1"). Both become "<maker> <model>" here, and the
 * normalised form is the key that merges them. No DOM, no state.
 */

const norm = s => String(s || "")
  .toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/\([^)]*\)/g, " ")          // "(Beta)", "(rooted)"… are notes, not the name
  .replace(/[^a-z0-9]+/g, " ").trim();

/** The machine's full name: the brand label in front unless the name already starts with it. */
function fullName(label, name, isPlugin) {
  const n = String(name || "").trim();
  if (isPlugin) return n;   // plugin catalogues name the maker themselves
  const first = norm(label).split(" ")[0];
  return first && norm(n).startsWith(first) ? n : `${label} ${n}`;
}

/**
 * @param {Record<string, object[]>} printerModels  state.db.printerModels
 * @param {string[]} brandOrder                     PRINTER_BRANDS (connector order)
 * @param {(brand: string) => { label: string, beta?: boolean } | null} metaOf
 * @param {(brand: string) => boolean} isPlugin
 * @returns {{ key, name, image, entries: { brand, modelId }[] }[]}
 */
export function buildModelIndex(printerModels, brandOrder, metaOf, isPlugin) {
  const byKey = new Map();
  for (const brand of brandOrder) {
    const meta = metaOf(brand);
    if (!meta) continue;
    for (const m of printerModels?.[brand] || []) {
      if (String(m.id) === "0") continue;                 // "Select Printer" placeholder
      const name = fullName(meta.label, m.name, isPlugin(brand));
      const key = norm(name);
      if (!key) continue;
      let item = byKey.get(key);
      if (!item) { item = { key, name: name.replace(/\s*\([^)]*\)\s*$/, ""), model: m, entries: [] }; byKey.set(key, item); }
      if (!item.entries.some(e => e.brand === brand)) item.entries.push({ brand, modelId: String(m.id) });
      // Prefer a hand-wired brand's picture (larger, official) over a plugin's.
      if (!isPlugin(brand) && isPlugin(item.entries[0].brand)) item.model = m;
    }
  }
  return [...byKey.values()];
}

/** Every typed word must START a word of the name ("k1" finds K1 and K1C, not
 * LK10), any order; whole-name prefix matches first. */
export function searchModels(index, query, limit = 40) {
  const words = norm(query).split(" ").filter(Boolean);
  if (!words.length) return [];
  const q = words.join(" ");
  return index
    .filter(it => { const toks = it.key.split(" "); return words.every(w => toks.some(t => t.startsWith(w))); })
    .map(it => ({ it, rank: it.key.startsWith(q) ? 0 : it.key.split(" ").some(t => t.startsWith(words[0])) ? 1 : 2 }))
    .sort((a, b) => a.rank - b.rank || a.it.name.localeCompare(b.it.name))
    .slice(0, limit)
    .map(x => x.it);
}
