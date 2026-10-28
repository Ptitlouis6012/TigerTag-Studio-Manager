# Worklog — v2.46.2 (in progress)

## Added
- Brand column in the "What would you like to do?" side card (`.lc-brands` in
  `renderer/inventory.html` between the rail and the pane, styled in
  `renderer/rfid_protocol/linked/linked.css`; card 612 → 664 px). Decorative,
  `aria-hidden`, monochrome masks: TigerTag on top, level with the card's title
  (the app icon's tiger, `tigersystem-icon-framed-white.svg`), the others centred
  in the height below it — Bambu Lab, Creality, Anycubic, Snapmaker, Elegoo,
  Qidi, Prusa, FlashForge, Klipper, OctoPrint, Fluidd, Mainsail. Alive:
  - a sheen sweeps left to right through each logo every 7 s, one after the
    other (`--i`);
  - lit (`.is-lit`): the logo takes its brand colour (`--brand`), grows (a
    negative inset on the masked `<i>` — a transform blurred the mask), glows
    (drop-shadow on the wrapper, which a mask would cut) and a shine crosses it;
  - lit by hover, held 900 ms after the mouse has left so a brush plays the whole
    effect, and by a garland played once each time the card opens — the makers
    one after the other, top to bottom, 1.1 s apart, then it rests
    (`wireBrandColumn` in `renderer/rfid_protocol/linked/index.js`);
  - the mouse in the column grows the tiger slowly (`.is-awake`, 0.7 s in and
    out, its own colour, no glow).
  Reduced motion: no garland and no sheen; hover still lights a logo, without transitions.
  `scripts/check-theme-tokens.mjs` BRAND exemption gains prusa, qidi, klipper,
  octoprint, fluidd, mainsail.
  `assets/svg/icons/logo_mainsail.svg`: Mainsail's sail, from
  mainsail-crew/mainsail `public/img/logo.svg`, recoloured black for the mask.
- `assets/svg/icons/logo_qidi.svg`: Qidi's cube over the "QiDi" wordmark, built
  from the vector paths of QIDIStudio's `resources/images/QIDIStudio_p.svg`
  (QIDITECH/QIDIStudio), stacked instead of side by side.

## Changed
- "Give an envelope" modal (`renderer/quests/squad-deals.js` showEnvelope,
  `renderer/quests/quests.css`): the envelope turns toward the mouse with glints
  twinkling round it, the same as the envelope help window (`tilt`,
  `.tch-env-tilt`, `.tch-glints`; the glints go once it is opened or given). The
  "Give" button is the "Open ×10" button: `.sqd-open.tp-hold.tp-ten` gradient,
  held 2 s through `holdToFire` (now exported from `coin-pull.js`) — it strains
  and grows while held, a click alone shakes with the `pullHoldTen` bubble. It
  reads "Offrir" alone, centred, no icon; the friends search sits 16 px under
  the title (`.tc-reveal-actions:has(> .tc-give)` drops its 22 px margin).
- The give window from the Friends panel hides an easter egg, `envGive`: glints
  while not found, three quick clicks on the envelope (`tapEgg`) → one common
  envelope. `_coinsCtx` (`renderer/inventory.js`) now carries `easterEgg` /
  `eggFound` — without them `tapEgg` was a silent no-op. The pile stage's give
  window passes no egg (it would stack a second opening stage). Needs the
  backend's `envGive` entry in `EGGS` (TigerTag_Firebase_Backend
  `functions/tigerCoins.js`, deployed 2026-10-28, not committed yet).
- New rule `.agents/rules/easter-eggs.md` (indexed in CLAUDE.md): how an egg
  works end to end, the current ids, how to add one.
- Grid card photos ask the CDN for `medium` (256 px, ~9.7 kB) instead of `large`
  (512 px, ~33 kB): `GRID_CARD_IMG` in `renderer/inventory.js`, used by
  `_gridCardInnerHTML` and its in-place patch. A quarter of the decoded bitmap
  memory and ~70 % less download per card in the catalogue grid. CLAUDE.md size
  table updated.
- Each view loads the rendition it paints: the local image cache now warms the
  grid's `medium` instead of the raw `large` (`preCacheImages`), and every call
  site resolves the SIZED url (`resolvedImg(cdnImg(url, size))`), so list thumbs
  load `small` / `compact` and the side card `large` (285 px slot, 570 device px).
  The thumb error fallback retries the same size, not the raw `large`.
- Side-card photos (spool detail panel, product card, reorder panel) ask for the
  rung that covers the photo as laid out now (`_panelImg`: the photo on screen,
  else the card's inner width) instead of always the raw `large`: a 257 px
  product card on a DPR-1 screen loads `medium`. `_cdnSizeFor` accepts a rung up
  to 10 % smaller than the slot (invisible upscale).
- Image cache hygiene (`_imgCacheTidy` in `renderer/inventory.js`, new
  `img:prune` in `main.js`, `imgPrune` in `preload.js`): once per session the map
  keeps only the newest `&v=` of each product × rendition and main deletes the
  files it no longer points at. Images are used exactly as the CDN serves them,
  nothing is resized locally. `img:get`'s fetch is factored into
  `_fetchImageBuffer` (same per-hop SSRF check).

## Fixed
- Switching accounts from the Deals view no longer leaves the cards as skeletons
  for 10-40 s. The view read Firestore directly (the deals, then each deal's
  claim and link: ~45 reads) and, on a switch, those reads queued behind every
  listener the new account starts (measured 12 s for Tiger Tag, 42 s for
  OpenMaker, even from the local cache). It now asks the squadDeal function's new
  `list` action — one HTTP call, ~1 s on a first visit (`_renderDealsView` in
  `renderer/inventory.js`); the direct Firestore reads stay as the fallback. One
  load per account at a time (`_dealsLoading`: renderInventory runs it on every
  snapshot of a switch), the claims filled in after the list on the fallback
  path, and each account's last Deals kept for the session (`_dealsByUid`):
  switching back is instant, then refreshed. Backend: TigerTag_Firebase_Backend
  `functions/squadDeals.js` `listDeals` (same scope as firestore.rules, Timestamps
  as epoch ms) + README row, deployed 2026-10-28, not committed yet. Checked
  against direct reads on two accounts: same deals, claims, links and dates.
  The view also stopped rebuilding itself on every snapshot (3 to 18 identical
  rebuilds per switch, each reloading every card's photo): a signature guard on
  the data it shows (`host._sqdSig`; the countdowns tick in place, an expiry
  forces a repaint) — 1 or 2 rebuilds per switch, measured.
- A product photo changed in the catalogue now reaches the spools linked to it
  (`renderer/inventory.js`, `_catalogStaleRows` + new `_catalogTime`). The stale
  scan never fired: `product/get/all` carries no `updated_at`, and `product/get`
  sends it as an ISO string that `Number()` read as NaN ("never changed"). A spool
  whose `url_img` differs from the list's `img_src` is now stale (unless it shows
  the user's own photo), and `updated_at` is parsed as ISO or epoch. The new URL
  is a new image-cache key, so the photo downloads on the next catalogue sync.
- The catalogue sync completes again, in ~1 s (`main.js`, `catalog:fetch-all`).
  The primary source is now the RFID-Guide snapshot
  (`database/id_catalog.json` on raw.githubusercontent.com, auto-synced several
  times a day, identical to `get/all` field for field): 1.6 MB gzip, kept on disk
  with its ETag (`userData/catalog-snapshot.json` + `.etag`) so an unchanged
  catalogue is a `304` with no download (`_fetchCatalogSnapshot`). `get/all` is
  the fallback only: 18 845 products are 19 pages of ~11 s served one at a time,
  and the 20 s per-page abort with no retry threw the whole sync away, so the old
  cache (old photo URLs) stayed; pages now get 60 s and two retries
  (`_fetchCatalogPage`).
- Screen flicker on Retina Macs ("tile memory limits exceeded" in the console,
  thousands per session despite `force-gpu-mem-available-mb=1024`). ~40 closed
  overlays were only `opacity: 0`, each a full-window `backdrop-filter` surface
  still composited. Closed `.modal-overlay` (`renderer/css/60-modals.css`) and
  `.sfe-backdrop` (`renderer/css/50-snapmaker.css`) are now `visibility: hidden`
  once their fade-out ends (open = visible at once).
- Grid cards (`.spool-card`, `renderer/css/70-detail-misc.css`) are skipped when
  off screen (`content-visibility: auto`, 240 px placeholder height).
- A catalogue refresh (`_refreshApiData`) no longer overwrites a photo the user
  set themselves (`url_img_user`).

## Docs
- `ROADMAP.md`: G7 under the printer control panel — Bambu Lab "skip objects" on
  a multi-part plate (issue #156): objects from the running job's `.3mf`, plate
  map + hold to confirm, MQTT `skip_objects`; firmware support to verify on a
  real P1S first.
- `ROADMAP.md`: G8 — Anycubic ACE Pro 2 drying per unit (read: `drying_status`
  already on the wire; control: `MULTI_COLOR_BOX_DRY`, payload from
  hass-anycubic_cloud) + humidity / filament left to capture (issue #157).

## Removed

## i18n
