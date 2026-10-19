# WORKLOG.md

**Rule.** `WORKLOG.md` is the running log of everything changed since the last release: update it right after each change, keep it describing the end state, and read it at the start of every session.

**Why.** It replaces memory between sessions and makes release prep instant; it is the source the changelog is synthesized from.

**How.**
- Sections `Added` / `Changed` / `Fixed` / `Removed` / `i18n`; one bullet per logical change, naming the files touched; i18n keys listed by name.
- Collapse as you go: intermediate steps vanish, an "Added X" + "Fixed X" becomes one entry, a same-session revert removes both entries.
- No implementation noise ("updated selector on line 42").
- Mark admin/debug-only entries as internal so they stay out of the release note and What's New.
- After a release: reset it to the blank template for the next version and bump `package.json` to the next patch; leave both uncommitted (`release.md`). Blank template:

```markdown
# Worklog — vX.Y.Z (in progress)

## Added

## Changed

## Fixed

## Removed

## i18n
```
