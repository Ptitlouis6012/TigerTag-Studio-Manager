# Tiger Studio Web — preparation

Status: **V1 implemented (uncommitted) — see [`WEB_DEPLOYMENT.md`](WEB_DEPLOYMENT.md); iPad pass pending.** Source: the founder's brief
(`CLAUDE_OPUS_TIGER_STUDIO_WEB.md`, 2026-10-12), summarised and audited against
the real code below. Decisions marked **[FOUNDER]** must be taken before work starts.

## 1. The brief in one paragraph

Ship a browser version of Studio at `https://studio.tigersystem.io`, on Vercel,
from the **same codebase** as the Electron app (no rewrite, no framework change,
Electron must keep working). V1 = Firebase sign-in, inventory viewing and
management, lists/search/filters/detail, usable on iPad Safari. Hardware
(ACR122U / PC-SC, USB, LAN printers, filesystem) is out of V1: hidden or
disabled with a clear message on web, untouched on desktop. Same Firebase
project, no secrets in the client, rules not loosened. Preview URL first,
production only after validation. Deliverables: `WEB_DEPLOYMENT.md`,
`.env.example`, a test pass, a final report, a PR.

## 2. Audit — what the code actually looks like

| Fact | Consequence for the web target |
|---|---|
| Renderer is **plain ES modules, no bundler**; Firebase is the **compat SDK** loaded from `renderer/lib/firebase/` | No bundle to "protect" — the files can be served statically as they are. |
| Renderer is already isolated: **zero Node imports**, every native call goes through `contextBridge` (`preload.js`) | The adapter layer the brief asks for **already exists**. Web = provide a browser implementation of the same globals. |
| Bridges exposed: `electronAPI` (~34 methods used), `bambulab` (32 uses), `anycubic` (43), `elegoo` (12), `td1s` (21), `mcpBridge` (9), `studio` (2) | One `web-bridge.js` shim, loaded only when `window.electronAPI` is absent. Printer/TD1S/MCP bridges → absent, guarded by a capability flag. |
| `electronAPI` uses spread across `inventory.js` + 17 printer/IoT/RFID modules | The printer modules stay desktop-only; the gating happens at their entry points (nav, add-flows), not inside each one. |
| Reference data (`id_*.json`) is served by the **main process** (`db:*` IPC, with download-and-update) | Web: fetch `assets/db/tigertag/*.json` statically (+ the same CDN refresh, in memory). |
| Catalogue (`catalog:fetch-all`), product lookup (`rfid:lookup-product`), image cache (`img:get`) run in **main** | Web: call the endpoints directly with `fetch`. `cdn.tigertag.io` answers `Access-Control-Allow-Origin: *` (checked on `/healthz/`) — **the catalogue/lookup hosts still need the same check**. Image cache → browser HTTP cache (already immutable, 1 y). |
| Google sign-in already falls back to `signInWithPopup` when the loopback bridge is missing; email/password is plain Firebase | Auth mostly works as is. Needs `studio.tigersystem.io` (+ preview domains) in Firebase **Authorized domains**. Safari/iPad: popup OK, **redirect flow fragile** (authDomain is `tigertag-connect.firebaseapp.com`, third-party storage blocked) — keep the popup. |
| Firestore persistence (`enablePersistence({synchronizeTabs})`) | Works in browsers; on iOS Safari IndexedDB is evicted after ~7 days idle — just a cold start, not a bug. |
| **No router** — one HTML page, views toggled in JS | "Deep routes on reload" mostly N/A. Only real deep link: `tigertag://friend/<CODE>` → web equivalent `?friend=<CODE>` (and the landing page can link to it). |
| `assets/` is **148 MB** | Web build must ship a filtered subset (icons, svg, db, the images actually referenced), not the whole folder. |
| CSS is desktop-first: no responsive breakpoints in `00-base.css`, panels resized by mouse drag, ~20 mouse-only handlers | **The iPad pass is the largest real cost of V1**, not the plumbing. |
| No lint / typecheck / unit tests; validators exist (`i18n:check`, `codemap:check`, `docs:check`, `node --check`) | Acceptance = validators + driving the web build in the in-app browser (desktop + mobile/tablet viewport) + `npm run start:drive` for Electron non-regression. |
| Tiger Hub = **Next.js 14** app on Vercel | Studio cannot be "built inside" Hub (different stack). See decision D1. |

## 3. Comments on the brief

**Sound and kept as is:** one codebase / two targets, no rewrite, hardware out of
V1, same Firebase project, no secrets client-side, rules never loosened,
preview before production, capability detection instead of crashes.

**To correct or clarify:**

1. **"Hosted via Tiger Hub"** — kept, for the shared sign-in: Studio's static build is
   served from the Hub at `/studio` (it is not rebuilt in Next.js; it ships as static
   files). See D1.
2. **"Prevent Electron/Node imports in the browser bundle"** — there is no bundle and
   the renderer already imports nothing native. The real work is the **shim + gating**,
   which is smaller than the brief suggests.
3. **"No local business storage"** — true for Firestore, false for reference data,
   catalogue and image cache, which live in the main process. They need web
   implementations (section 2).
4. **"Deep routes work on reload"** — there are no routes. Only the friend link matters.
5. **"Implement without waiting for validation / create branch / open PR"** — conflicts
   with this repo's rule: *no commit, branch push or PR without an explicit order*.
   We prepare and implement; git happens on the founder's go.
6. **"Run lint, typecheck, tests"** — they don't exist here; use the project's validators
   and real-browser verification. Adding a test framework for this is not worth it in V1.
7. **`.env.example`** — the client needs no env vars (Firebase config is public and already
   in `renderer/firebase.js`). Only meaningful if the build needs one (e.g. a preview flag).
8. **Missing from the brief**: iOS Safari specifics (popup auth, IndexedDB eviction, no
   Web Serial/WebUSB/Web NFC at all on iPad — so not even the "browser-compatible hardware"
   path exists there), the 148 MB assets problem, the auto-updater / "What's New" / MCP
   surfaces that must disappear on web, telemetry/analytics labelling (`platform: web`),
   and the store/ToS impact of a public web URL (none expected, worth a line).

## 4. Decisions needed

- **D1 Hosting topology — DECIDED (2026-10-12):** Studio Web is served by the **Hub**
  Vercel project. **Revised 2026-10-13:** the public address is
  **`studio.tigersystem.io`**, served at the root of that host by a rewrite (Hub
  `middleware.ts`); `tigersystem.io/studio` redirects there. Trade-off accepted by the
  founder: the subdomain is its own origin, so Studio Web no longer shares the Hub's
  Firebase sign-in (one login per site), and `studio.tigersystem.io` must be a Firebase
  Auth authorised domain. (First version, 2026-10-12: Studio lived at
  `tigersystem.io/studio` and the subdomain redirected to it, to share the session.) The Hub build clones the
  latest Studio release and builds it into `public/studio/` — no hand copy
  (implemented: see `WEB_DEPLOYMENT.md`).
  To verify: the Hub (modular v12) and Studio (compat) SDKs read the same persisted
  session for the `[DEFAULT]` app; Studio's extra per-account named apps are not shared.
- **D2/D3 DECIDED (2026-10-12):** V1 scope as proposed below; sign-in = Google + email.
  **Long-term goal = full parity, printers included** — so every desktop-only feature is
  gated behind a capability (never deleted, never forked), and the web bridge exposes the
  same method names so a later transport can fill them in. A browser cannot open raw
  TCP/MQTT/UDP to a LAN printer, so web printers will come through one of: the brands'
  cloud APIs (Bambu / Anycubic cloud are already implemented — on desktop they run in main
  because of Cloudflare/CORS, so on web they need a small server proxy), or a relay
  (Tiger Bridge, or a desktop Studio publishing printer state to Firestore).
- **D2 V1 scope** — proposed: inventory (grid/table/detail, weight, edit, add
  product), racks/storage, lists/wishlists, catalogue, friends, account/settings.
  Printers: **list only, shown as "available in the desktop app"** (live state needs the LAN).
  Excluded: RFID, TD1S, TigerScale/USB scale, TigerSpool live, cameras, updater, MCP.
- **D3 [FOUNDER] Sign-in methods on web** — Google (popup) + email/password; any other provider?
- **D4** Release cadence — web deploys on every push to `main` (preview per PR) vs only on tags.
  Recommended: production on tag, previews on branches.

## 5. Implementation plan (once D1–D3 are taken)

| # | Step | Files | Risk |
|---|---|---|---|
| 1 | `renderer/platform.js`: `IS_WEB` + capability map (`lan`, `rfid`, `usb`, `fs`, `updates`, `mcp`) | new file, imported first by `inventory.js` | low |
| 2 | `renderer/web-bridge.js`: browser `electronAPI` (openExternal → `window.open`, db → static JSON, catalogue/lookup → `fetch`, imgGet → URL passthrough, getAppInfo → `{platform:'web'}`, all printer/RFID/update methods → explicit "unsupported") ; loaded only if `!window.electronAPI` | new file + one `<script>` in `inventory.html` | low |
| 3 | Gate entry points on capabilities: printers view, add-printer flows, RFID tester, TD1S, scales, cameras, updater, MCP card, deep-link listener | `inventory.js` (CODEMAP-guided), a few i18n keys (11 locales) | medium — many call sites |
| 4 | Friend deep link on web: `?friend=CODE` → `_openAddFriendWithCode` | `inventory.js` | low |
| 5 | Web build: `scripts/build-web.mjs` → `dist-web/` (renderer + data + filtered assets, same tree so relative `../assets` paths keep working); `vercel.json` (output dir, `/` → `/renderer/inventory.html`, cache headers, CSP) | new files, `package.json` scripts | low |
| 6 | iPad/touch pass: breakpoints, side panels as sheets on narrow screens, pointer events instead of mouse-only, hold-to-confirm on touch, no hover-only affordances | `renderer/css/*`, `inventory.js` | **high effort** — iterate with founder screenshots |
| 7 | Firebase: add authorized domains (prod + `*.vercel.app` previews); review rules for cross-account access (read-only audit, backend repo) | console + backend repo (no deploy unless a gap is found) | low |
| 8 | Docs: `WEB_DEPLOYMENT.md` (architecture, `npm run web:dev` / `web:build`, Vercel, OVH DNS `CNAME studio → cname.vercel-dns.com`, Firebase domains), `llms.txt`, CODEMAP, README | docs | low |
| 9 | Verify: validators, web build in the in-app browser (desktop + tablet viewport, Safari-like constraints), Electron non-regression via dev-drive; report what could not be tested (real iPad) | — | — |

**Founder-only actions:** create the Vercel project / link the repo, DNS record at OVH,
Firebase authorized domains (or give the go to do it), approve the production promotion.

**Rough sizing:** steps 1–5 + 7–8 ≈ one focused session; step 6 (iPad) is open-ended —
budget it as its own phase with real-device feedback.
