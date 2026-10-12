# Worklog — v2.39.1 (in progress)

## Added
- Tiger Studio Web preparation plan (audit of the brief against the code, decisions, step plan) — `docs/STUDIO-WEB-PLAN.md`
- Tiger Studio Web — browser bridge: a web `electronAPI` (links, app info, product lookup / refresh, full catalogue, image download) loaded only when the Electron preload is absent; `HAS_NATIVE` replaces the "electronAPI exists" desktop checks around RFID — `renderer/web-bridge.js`, `renderer/inventory.html`, `renderer/inventory.js`, `renderer/rfid_protocol/tigertag/index.js`
- Tiger Studio Web — desktop-only UI hidden in a browser through one `data-desktop-only` attribute + `html.is-web` rule (NFC readers bar and tester, TD1S, updater card / icon / banner, printers views, camera detach); printer view modes fall back to the inventory grid — `renderer/inventory.html`, `renderer/css/00-base.css`, `renderer/inventory.js`
- Tiger Studio Web — friend link `?friend=XXX-YYY` pre-fills Add-friend (web equivalent of `tigertag://friend/…`) — `renderer/inventory.js`
- Tiger Studio Web — one sign-in with the Hub: on a first web visit Studio adopts the tigersystem.io Firebase session (verified addresses), signing in to Studio no longer signs the shared DEFAULT session out on the web, and signing out ends it only for the same account — `renderer/inventory.js` (`_adoptSharedWebSession`, sign-in flows, `fbSignOut`)
- Tiger Studio Web — deployment guide (architecture, what works on the web, Hub/Vercel/DNS/Firebase setup) — `docs/WEB_DEPLOYMENT.md`
- Tiger Studio Web — static build `npm run web:build` (`--out`, `--base /studio/`) → `dist-web/` with the app page at the root via `<base>`; `npm run web:serve` to try it locally — `scripts/build-web.mjs`, `package.json`, `.gitignore`
- Tiger Studio Web — installable as an app (PWA): the web build ships a manifest (scope = the served folder, standalone, the app icons) and the home-screen tags iOS reads; an "Install the app" sidebar button appears only when the browser can install it (replays Chrome/Edge/Android's install prompt, unfolds the Share → Add to Home Screen hint on iPhone/iPad), hidden once installed; no service worker on purpose (no stale offline copy after a release) — `scripts/build-web.mjs`, `renderer/web-bridge.js`, `renderer/inventory.js`, `renderer/inventory.html`, `renderer/css/00-base.css` (`data-web-only`), `renderer/css/10-settings.css`

## Changed

## Fixed
- FlashForge / Snapmaker / Creality background ping threw every 30 s while signed out (no printer list yet) — `renderer/printers/{flashforge,snapmaker,creality}/index.js`
- Low-stock notifications stored the desktop's local image-cache path (`/img-cache/…`) in Firestore, so the photo was missing on the account's other devices and on the web; they now store the public image URL, and the web skips the old local paths — `renderer/inventory.js`

## Removed

## i18n
- Added: `sbInstallBtn`, `installIosHint` — 11 locales
