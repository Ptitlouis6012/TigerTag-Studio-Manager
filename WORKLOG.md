# Worklog — v2.19.1 (in progress)

## Added

## Changed

## Fixed
- Dependency refresh — 18 advisories (1 critical, 17 high) down to 0, entirely within the existing
  semver ranges: `package.json` is untouched, only the lockfile was stale. Covers the reported
  **CVE-2026-54673** / GHSA-p2f4-r6v6-j797 (`builder-util-runtime` 9.5.1 → 9.7.0 — electron-updater
  leaked `Authorization` / `PRIVATE-TOKEN` headers across a cross-origin redirect; `electron-updater`
  is a runtime dependency, though our update feed is a public GitHub release that carries no
  credentials), plus electron-builder/app-builder-lib 26.8.1 → 26.15.3 (AppImage search-path advisory),
  electron 41.3.0 → 41.10.6 (three advisories), and tar, undici, ws, js-yaml, tmp, form-data,
  ip-address. Supersedes external PR #10, which pinned a single package through `overrides` —
  `package-lock.json`
- Six column headers in the Printers table view stayed in English in every language (Brand, Name,
  Model, Status, Job, Last seen) — they were hardcoded literals while their neighbours (Preview,
  Ends at) went through `t()`. They now reuse the existing table-header key family; switching
  language already re-renders this view, so they follow immediately — `renderer/inventory.js`

## Removed

## i18n
- Added: `thModel`, `thStatus`, `thJob` — 9 locales (the Printers table headers; `thBrand`, `thName`
  and `printersLastSeen` already existed and are reused)
