# Tiger Studio Web — deployment

Tiger Studio runs in a browser at **`https://tigersystem.io/studio`**, from the
same code as the desktop app. `https://studio.tigersystem.io` is a redirect to it.
Decisions and the audit behind them: [`STUDIO-WEB-PLAN.md`](STUDIO-WEB-PLAN.md).

## Architecture

```
TigerTag-Studio-Manager (this repo)            TigerTag_Hub (Next.js on Vercel)
  renderer/  data/  assets/                      prebuild: scripts/fetch-studio-web.mjs
  scripts/build-web.mjs  ── static folder ──▶      → shallow clone of a Studio tag
                                                   → build-web.mjs --base /studio/
                                                   → public/studio/   (gitignored)
                                                 next.config.mjs
                                                   /studio            → rewrite to /studio/index.html
                                                   studio.tigersystem.io → redirect to tigersystem.io/studio
```

- **No bundler, no second codebase.** The renderer is plain ES modules + the
  Firebase compat SDK; the web build is a filtered copy of `renderer/`, `data/`
  and `assets/`. `index.html` is `renderer/inventory.html` with a
  `<base href="/studio/renderer/">`, so every relative URL resolves as on desktop.
- **`renderer/web-bridge.js`** stands in for the Electron preload in a browser:
  it defines a web `window.electronAPI` (`isWeb: true`) with the methods a
  browser can honour — external links, app info, product lookup / refresh, full
  catalogue (the TigerTag API answers CORS), image download. In Electron it does
  nothing. Native features stay absent and are feature-detected by the renderer.
- **`HAS_NATIVE`** (`renderer/inventory.js`) is the one "is this the desktop app"
  test. Never use `!!window.electronAPI` for that any more — it is true on the web.
- **`data-desktop-only`** on an element hides it in a browser (`html.is-web`
  rule in `renderer/css/00-base.css`). Hidden today: NFC readers bar + tester,
  TD1S, updater (card, icon, banner), printer views, camera detach.

## What works on the web

| Works | Desktop only (for now) |
|---|---|
| Sign-in (Google popup, email + password), several accounts | NFC / RFID readers (ACR122U, TigerPOD), chip encode |
| Inventory grid / table / detail, edit, weight, add product | TD1S sensor, USB scale |
| Racks, favourites, lists / wishlists, cart | LAN printers (all brands), cameras |
| Catalogue, product lookup | Auto-update, local AI-assistant (MCP) server |
| Friends, friend link `?friend=XXX-YYY`, notifications | Native file dialogs (downloads go through the browser) |
| TigerScale / TigerSpool state (cloud) | |
| **Install as an app** (PWA): sidebar button on Chrome / Edge / Android, Share → Add to Home Screen on iPhone / iPad | |

Printers are planned for the web too — through the brands' cloud APIs or a relay;
see the plan.

## Install as an app (PWA)

The build writes `manifest.webmanifest` (name, standalone display, icons from
`assets/favicon/`) and the iOS home-screen tags into `index.html`. Its scope is the
served folder **without** the trailing slash (`/studio`), because the page itself
lives at `/studio`. `web-bridge.js` keeps Chrome's `beforeinstallprompt`; the sidebar
"Install the app" button (`#sbInstallBtn`, `data-web-only`) replays it, or on iOS
unfolds the Share → Add to Home Screen hint. There is deliberately **no service
worker**: Chrome no longer needs one to install, and an offline cache would keep
serving the previous version after each release.

## Shared sign-in with the Hub

Studio and the Hub share the origin `tigersystem.io`, therefore one Firebase
session (same project, same API key — checked). On a first visit with no Studio
account, Studio adopts the Hub's signed-in user (`_adoptSharedWebSession`, verified
addresses only). Signing in to Studio leaves the Hub signed in; signing out of
Studio ends the Hub session only when it is the same account.

## Commands

```bash
npm run web:build                                   # → dist-web/ (base /)
npm run web:serve                                   # build + http://localhost:5181
node scripts/build-web.mjs --out <dir> --base /studio/
```

In the Hub repo: `npm run studio:fetch` (runs automatically as `prebuild`).

| Hub env var | Effect |
|---|---|
| `STUDIO_WEB_REF` | Studio tag or branch to ship (default: latest GitHub release) |
| `STUDIO_WEB_REQUIRED=1` | fail the Hub build if Studio can't be built (default: warn, ship the Hub without `/studio`) |

No secret is involved: the Firebase web config is public by design (already in
`renderer/firebase.js`); security is the Firestore / Storage rules, unchanged.
No `.env` is needed for the web build.

## Shipping a new Studio Web version

1. Release Studio as usual (tag `vX.Y.Z`, GitHub Release).
2. Redeploy the Hub (any push, or *Redeploy* in Vercel) — the build pulls the
   latest release. A release older than the web build (≤ v2.39.0) is skipped
   with a warning.

## One-time setup (founder)

1. **Vercel** — Hub project → Settings → Domains → add `studio.tigersystem.io`.
2. **DNS (OVH)** — `studio` `CNAME` `cname.vercel-dns.com.`
3. **Firebase Auth** — Authentication → Settings → Authorized domains: make sure
   `tigersystem.io` is listed (it is the Hub's domain — expected to be there
   already). `studio.tigersystem.io` does not need to be: it only redirects.
   Vercel preview URLs (`*.vercel.app`) must be added one by one to test sign-in
   on a preview.
4. Optionally set `STUDIO_WEB_REQUIRED=1` on the Production environment once a
   Studio release with the web build exists, so a broken Studio build can't
   silently drop `/studio`.

## Known limits

- **iPad / touch**: the layout is desktop-first; the tablet pass is still to do.
- **Size**: the build is ~144 MB, mostly printer and tutorial images; a browser
  only downloads what it shows.
- **iOS Safari** may evict the offline cache (IndexedDB) after about a week of
  no use — the next visit simply reloads from the network.
