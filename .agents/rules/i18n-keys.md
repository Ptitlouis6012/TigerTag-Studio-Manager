# i18n keys

**Rule.** Every user-visible string goes through a key: `t("key")` in JS, `data-i18n` / `data-i18n-placeholder` in HTML. Reference locale is `en`. A new key is added in all 11 locales (en fr de es it zh pt pt-pt pl ru nl) in the same commit, through `npm run i18n:add`, never by hand-editing the JSON. No hardcoded UI text.

**Why.** Founder order, repeated: never ship a key with only the English value, and never make him ask twice. Hand edits drifted the locale files apart before the checker existed.

**How.**
- App strings: `renderer/locales/<locale>.json`. Add with `npm run i18n:add -- key [--after existingKey] en="…" fr="…" …` (all 11 values).
- Remove keys the same way, never by hand: `node scripts/i18n-remove.mjs key1 key2 …` (or `--file keys.txt`); it aborts if any other key would change. `node scripts/check-agent-rules.mjs --orphans` lists keys no code references.
- Printer plugin strings live inline in the plugin (`const i18n` in `renderer/printers/klipper/plugin.js`, `s11(...)` in `renderer/printers/octoprint/plugin.js`), merged at runtime by `mergePluginStrings`; every key carries all 11 locales.
- `npm run i18n:check` (pre-commit) fails on a missing, extra, empty or type-mismatched key. `scripts/check-agent-rules.mjs` checks the plugin tables.
- If a translation cannot be written now, add the key in every locale anyway with the English value and say so in `WORKLOG.md` — never leave a locale without the key.
- Copy voice: `copy-registers.md`. Key reference: `docs/i18n-keys.md` (append new keys there).
- Conditions never compare translated labels (`ids-not-labels.md`).
