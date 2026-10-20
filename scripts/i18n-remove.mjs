#!/usr/bin/env node
/**
 * i18n-remove.mjs — remove keys from every renderer/locales/*.json file in one run.
 *
 *   node scripts/i18n-remove.mjs key1 key2 …
 *   node scripts/i18n-remove.mjs --file keys.txt      (one key per line)
 *
 * Works on the raw text (like i18n-add.mjs) so the rest of each file keeps its
 * formatting. After the edit it re-parses every file and checks that exactly the
 * requested keys are gone and every other key kept its value; any mismatch aborts
 * the whole run before anything is written.
 */
import fs from "node:fs";
import path from "node:path";

const root = new URL("..", import.meta.url).pathname;
const dir = path.join(root, "renderer/locales");
const args = process.argv.slice(2);
let keys = args.filter(a => !a.startsWith("--"));
const fi = args.indexOf("--file");
if (fi >= 0) keys = fs.readFileSync(args[fi + 1], "utf8").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
keys = [...new Set(keys)];
if (!keys.length) { console.error("usage: node scripts/i18n-remove.mjs key1 key2 … | --file keys.txt"); process.exit(1); }

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const plans = [];
for (const name of fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort()) {
  const file = path.join(dir, name);
  let text = fs.readFileSync(file, "utf8");
  const before = JSON.parse(text);
  for (const k of keys) {
    if (!(k in before)) continue;
    // A top-level entry starts at `\n  "key":` and runs to the next top-level key or the closing brace.
    const start = text.search(new RegExp(`\\n  ${esc(JSON.stringify(k))}\\s*:`));
    if (start < 0) { console.error(`[i18n-remove] ${name}: cannot locate "${k}" as a top-level entry`); process.exit(1); }
    const rest = text.slice(start + 1);
    const next = rest.search(/\n  "|\n\}/);
    text = text.slice(0, start) + "\n" + rest.slice(next + 1);
  }
  text = text.replace(/,(\s*\n\})\s*$/, "$1\n");             // the removed key may have been the last one
  let after;
  try { after = JSON.parse(text); } catch (e) { console.error(`[i18n-remove] ${name}: result is not valid JSON — ${e.message}`); process.exit(1); }
  for (const k of Object.keys(before)) {
    const gone = keys.includes(k);
    if (gone && k in after) { console.error(`[i18n-remove] ${name}: "${k}" still present`); process.exit(1); }
    if (!gone && JSON.stringify(after[k]) !== JSON.stringify(before[k])) { console.error(`[i18n-remove] ${name}: "${k}" changed — aborting`); process.exit(1); }
  }
  plans.push({ file, name, text, removed: Object.keys(before).length - Object.keys(after).length });
}
for (const p of plans) fs.writeFileSync(p.file, p.text, "utf8");
console.log(`[i18n-remove] ${plans.map(p => `${p.name} −${p.removed}`).join(", ")}`);
