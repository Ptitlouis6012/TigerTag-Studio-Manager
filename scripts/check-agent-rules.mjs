#!/usr/bin/env node
/**
 * check-agent-rules.mjs — keeps the agent rules and the strings they protect honest.
 *
 * Fails (exit 1) when:
 *   1. a file in .agents/rules/ is not cited in the "## Rules" index of CLAUDE.md;
 *   2. the index cites a rule file that does not exist;
 *   3. a repo path cited in CLAUDE.md, AGENTS.md or a rule file does not exist;
 *   4. a printer-plugin string table (renderer/printers/<plugin>/plugin.js,
 *      `const i18n = {…}`) has a key missing one of the 11 locales or empty
 *      (the locale JSON files are checked by check-i18n-consistency.mjs).
 * Warns (exit 0) about:
 *   5. en.json keys referenced nowhere in the code (orphans; dynamic keys built
 *      as t(`prefix${x}`) are excluded by prefix, so the count is an upper bound).
 *      `--orphans` lists them.
 *
 * Path check (3): a backticked token is treated as a repo path when it has a
 * file extension or a slash, its first segment exists at the repo root, and it
 * is not a template (<x>, {x}, *, …, vX.Y.Z). Lines naming another repo
 * (TigerSystem-Docs, the backend repo…) are skipped: their paths live there.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = f => readFileSync(join(root, f), "utf8");
const LOCALES = ["en", "fr", "de", "es", "it", "zh", "pt", "pt-pt", "pl", "ru", "nl"];
const errors = [], warnings = [];

// ── 1-2. Rule files ↔ index ──────────────────────────────────────────────
const RULES_DIR = ".agents/rules";
const ruleFiles = existsSync(join(root, RULES_DIR))
  ? readdirSync(join(root, RULES_DIR)).filter(f => f.endsWith(".md")).sort() : [];
const claude = read("CLAUDE.md");
const idx = claude.match(/^## Rules\n([\s\S]*?)(?=^## |^# )/m);
if (!idx) errors.push('CLAUDE.md has no "## Rules" index section');
const cited = new Set([...(idx?.[1] || "").matchAll(/`\.agents\/rules\/([\w.-]+\.md)`/g)].map(m => m[1]));
for (const f of ruleFiles) if (!cited.has(f)) errors.push(`${RULES_DIR}/${f} is not cited in the CLAUDE.md Rules index`);
for (const f of cited) if (!ruleFiles.includes(f)) errors.push(`CLAUDE.md Rules index cites ${RULES_DIR}/${f}, which does not exist`);
for (const f of ruleFiles) {
  const body = read(`${RULES_DIR}/${f}`);
  if (!/^# .+/m.test(body) || !body.includes("**Rule.**") || !body.includes("**Why.**") || !body.includes("**How.**"))
    errors.push(`${RULES_DIR}/${f} does not follow the "# Title / **Rule.** / **Why.** / **How.**" format`);
}

// ── 3. Cited paths exist ─────────────────────────────────────────────────
const OTHER_REPO = /TigerSystem-Docs|TigerTag_Firebase_Backend|backend repo|TigerTag_Firebase_Integration|TigerHub|mobile app|SliceForge/i;
const TEMPLATE = /[<>{}*…]|X\.Y\.Z|\.\.\.|^\.\.\/|^https?:|^~|\s/;
const rootEntries = new Set(readdirSync(root));
const PATH_EXT = new Set([".md", ".js", ".mjs", ".cjs", ".json", ".css", ".html", ".py", ".sh", ".yml", ".yaml", ".svg", ".txt"]);
function checkPaths(file) {
  read(file).split("\n").forEach((line, i) => {
    if (OTHER_REPO.test(line)) return;
    for (const [, tok] of line.matchAll(/`([^`\n]+)`/g)) {
      const p = tok.replace(/:\d+(-\d+)?$/, "").replace(/\/$/, "");
      if (TEMPLATE.test(p) || p.startsWith(".") && !p.startsWith(".agents") && !p.startsWith(".github") && !p.startsWith(".githooks") && !p.startsWith(".claude")) continue;
      if (!p.includes("/") && !PATH_EXT.has(extname(p))) continue;
      const first = p.split("/")[0];
      if (!rootEntries.has(first)) continue;           // not a repo-root path (Firestore path, runtime folder…)
      if (first === "CLAUDE.local.md" || first === ".claude") continue;   // gitignored, machine-local
      if (!existsSync(join(root, p))) errors.push(`${file}:${i + 1} cites \`${tok}\`, which does not exist`);
    }
  });
}
for (const f of ["CLAUDE.md", "AGENTS.md", ...ruleFiles.map(f => `${RULES_DIR}/${f}`)]) if (existsSync(join(root, f))) checkPaths(f);

// ── 4. Printer-plugin string tables ──────────────────────────────────────
const PLUGINS = "renderer/printers";
for (const dir of readdirSync(join(root, PLUGINS))) {
  const f = `${PLUGINS}/${dir}/plugin.js`;
  if (!existsSync(join(root, f))) continue;
  const src = read(f);
  const start = src.search(/^const i18n = \{/m);
  if (start < 0) continue;
  const end = src.indexOf("\n};", start);
  const block = src.slice(start, end + 3).replace(/^const i18n = /, "return ");
  let table;
  try {
    // s11(...) is positional: a missing or extra value would silently shift every later locale.
    table = new Function("s11", block)((...v) => {
      if (v.length !== LOCALES.length) throw new Error(`s11() got ${v.length} values, expected ${LOCALES.length} (first: "${String(v[0]).slice(0, 40)}")`);
      return Object.fromEntries(LOCALES.map((l, i) => [l, v[i]]));
    });
  } catch (e) { errors.push(`${f}: string table could not be read — ${e.message}`); continue; }
  for (const [key, val] of Object.entries(table)) {
    // A value is a non-empty string, or a non-empty list of them (helper bullets).
    const filled = v => typeof v === "string" ? !!v.trim() : Array.isArray(v) && v.length > 0 && v.every(x => typeof x === "string" && x.trim());
    const missing = LOCALES.filter(l => !filled(val?.[l]));
    if (missing.length) errors.push(`${f}: "${key}" is missing ${missing.join(", ")}`);
  }
}

// ── 5. Orphan en.json keys (warning) ─────────────────────────────────────
const en = JSON.parse(read("renderer/locales/en.json"));
const codeFiles = [];
(function walk(d) {
  for (const n of readdirSync(join(root, d))) {
    const p = `${d}/${n}`;
    if (n === "lib" || n === "locales" || n === "node_modules") continue;
    if (statSync(join(root, p)).isDirectory()) walk(p);
    else if (/\.(js|mjs|cjs|html|json)$/.test(n)) codeFiles.push(p);   // json: tutorial.json step keys
  }
})("renderer");
const corpus = [...codeFiles, "main.js", "preload.js"].filter(f => existsSync(join(root, f))).map(read).join("\n")
  + (existsSync(join(root, "data")) ? readdirSync(join(root, "data")).filter(n => n.endsWith(".json")).map(n => read(`data/${n}`)).join("\n") : "");
// Keys built at run time: t(`prefix${x}`) and t("prefix" + x).
const dynPrefixes = [
  ...[...corpus.matchAll(/`([A-Za-z][\w-]*?)\$\{/g)].map(m => m[1]),
  ...[...corpus.matchAll(/["']([A-Za-z][\w-]*?)["']\s*\+\s*[\w(]/g)].map(m => m[1]),
].filter(p => p.length >= 3);
const orphans = Object.keys(en).filter(k => !corpus.includes(k) && !dynPrefixes.some(p => k.startsWith(p)));
if (orphans.length) {
  warnings.push(`${orphans.length} en.json key(s) look unused (upper bound — keys may be built dynamically). Run with --orphans to list them.`);
  if (process.argv.includes("--orphans")) warnings.push(...orphans.map(k => `  orphan: ${k}`));
}

// ── Report ───────────────────────────────────────────────────────────────
for (const w of warnings) console.warn(`[agent-rules] warning: ${w}`);
if (errors.length) {
  console.error(`[agent-rules] ${errors.length} problem(s):`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error("Fix the rule index, the rule file or the cited path (see .agents/rules/docs-match-code.md).");
  process.exit(1);
}
console.log(`[agent-rules] OK — ${ruleFiles.length} rule files indexed, cited paths exist, plugin string tables complete.`);
