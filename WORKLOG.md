# Worklog — v2.40.1 (in progress)

## Added
- Tiger Studio Web hotfixes — ship web-only fixes without a desktop build: `npm run web:hotfix` tags the commit `web-vX.Y.Z.N` (X.Y.Z = the latest release, checked against package.json); `web-sync.yml` also runs on those tags (refuses a non-latest base, deploys the Hub, waits for `{version, webBuild}`); the build stamps the web build number (`--web-build`, shown as "X.Y.Z · web N", part of the reload check); the Hub builds the highest hotfix of the latest release — `scripts/web-hotfix.mjs`, `scripts/build-web.mjs`, `renderer/web-bridge.js`, `.github/workflows/web-sync.yml`, `package.json`, `docs/WEB_HOTFIX.md`

## Changed
- Studio Web served at the root of `studio.tigersystem.io` (no redirect); `tigersystem.io/studio` redirects there; separate sign-in from the Hub — `docs/WEB_DEPLOYMENT.md`, `docs/STUDIO-WEB-PLAN.md`, `README.md`, `FEATURES.md`, `llms.txt`, `scripts/build-web.mjs` (comments)

## Fixed
- Tiger Studio Web: the page no longer requests the Agora SDK (Anycubic cloud camera, desktop-only, not in git), which answered 404 on the web (shipped to the web as web-v2.40.0.1) — `scripts/build-web.mjs`

## Removed

## i18n
