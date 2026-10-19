# Docs and comments match the code

**Rule.** No comment or doc may contradict the code, the config or a newer rule. A change of behaviour updates the comment and doc that describe it in the same commit; a stale claim found in passing is fixed or removed.

**Why.** Founder order (2026-10-19): `llms.txt` once claimed v1.8.2 / 12 000 lines / 5 brands while the app was at v2.12.0 / 28 500 lines / 6 brands; sub-agent instructions listed 9 locales after 11 shipped.

**How.**
- `npm run docs:check` (pre-commit) compares stated facts (version, line count, brands, CSS files, i18n key count, Firestore collections, paths) with the code; fix the doc, never bypass.
- `npm run codemap:check` keeps the CODEMAP line ranges honest.
- `scripts/check-agent-rules.mjs` keeps this rule index, the rule files and the paths they cite in sync.
- When unsure which side is true, ask the founder instead of guessing.
