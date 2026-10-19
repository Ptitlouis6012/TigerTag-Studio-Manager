# AGENTS.md

Entry point for any coding agent working in this repository.

- **Rules**: the index is the **Rules** section of [`CLAUDE.md`](CLAUDE.md) — one line per rule, each
  pointing to its file in `.agents/rules/`. Read the index before changing anything; the critical
  rules (language, git, attribution, secrets, i18n, irreversible actions) are applicable from it alone.
- **Codebase reference**: the rest of `CLAUDE.md`, then `llms.txt`, `renderer/CODEMAP.md` and
  `CODEMAP-main.md`.
- Machine-specific paths are not committed; they live in `CLAUDE.local.md` on the founder's machine.

This file deliberately restates no rule: one rule lives in one place.
