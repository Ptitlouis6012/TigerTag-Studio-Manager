# Worklog — v2.38.1 (in progress)

## Added
- **Hover a table thumbnail to see it big (issue #67)** — in the inventory, catalogue and list tables, resting the mouse on a spool's thumbnail shows a 220 px preview beside it (framed in the spool colour, sharper rendition, appears after a short pause so sweeping down the column doesn't flash; hides on scroll / click) — `renderer/inventory.js` (`thumbHTML` + `_catThumbHTML` `data-zoom`, `_showThumbZoom`), `renderer/css/70-detail-misc.css`
- Reports (bug / idea / catalogue / brand): the GitHub issue's Environment table now also carries the reporter's **TigerSquad badge** and **XP** ("1,282 XP · 19 TigerTag+ Certified · 45 TigerTag chips") — read by the server from `userProfiles/{uid}.tigerSquad.tier` and `users/{uid}.xpPoints` / `certifiedPlusCount` / `tigerTagCount`, never taken from the app; the "Automatic information" panel shows them before sending — `renderer/report/index.js`, `renderer/inventory.js`, backend `functions/reportIssue.js` (deployed)

## Changed
- Scrolling a results list (catalogue, inventory grid / table): the photos now fade out (0.35 s) and back in (0.8 s) instead of vanishing and popping back, and the TigerTag logo on the colour square crossfades the other way (it fades out as the photo fades in, instead of showing through it) — the fade exists only around the scroll hold (`body.photos-held` → `body.photos-fade-in`), never on a normal load, so grid rebuilds still don't blink — `renderer/inventory.js` (`_hueHoldSync`), `renderer/css/70-detail-misc.css`
- Bundled reference data refreshed: brand **IEMAI** (id 50266) added — 137 brands; catalogue unchanged (14,463 products) — `assets/db/tigertag/id_brand.json`, `last_update.json`
- TigerSquad rankings: the Countries League and Makers ranks read "#1", "#2"… (wider rank column) — `renderer/inventory.js`, `renderer/css/10-settings.css`

## Fixed
- **High CPU at idle (issue #66)** — looping CSS animations kept the renderer re-compositing the whole window at 60 fps: measured on a Mac, idle on the inventory **51 % → 5.6 %** renderer CPU, printers view **49.5 % → 20 %** (Linux without GPU compositing was hit harder). Closed windows and the account menu sit in the page at opacity 0, so their pulses / spinners / rings / light sweep never stopped — everything inside a closed `.modal-overlay` or `.acct-dropdown` is now paused (resumes on open); the TigerSpool / TigerScale "live" ping and the printers' "online" dot pulse 3 times when they come online, then stay lit, instead of forever — `renderer/css/00-base.css`, `renderer/IoT/tigerspool/tigerspool.css`, `renderer/IoT/tigerscale/tigerscale.css`, `renderer/css/40-printers.css`, `renderer/css/70-detail-misc.css`
- A profile photo that fails to load now falls back to the initials: the inline error handler removed the image before switching its parent to initials, so it found no parent and the avatar stayed blank (TigerSquad rankings, friends' lists…); photos are also requested without a referrer, which Google-hosted pictures accept more often — `renderer/inventory.js` (`_avatarPhotoTag`, `_renderAvatarPhotoOverlay`)

## Removed
- FlashForge "Adventurer A5" (issue #29): no such model exists in FlashForge's range (Adventurer 5M / 5M Pro / AD5X) — it was a placeholder showing the 5M Pro photo. Removed from the model catalogue, the connection tutorial's model picker and the network-scan detection, with its two images; a printer saved with a model no longer in the catalogue now shows "—" instead of a bare catalogue number — `data/printers/ffg_printer_models.json`, `renderer/printers/flashforge/tutorial.json`, `renderer/printers/flashforge/probe.js`, `renderer/printers/flashforge/PROTOCOL.md`, `renderer/inventory.js` (`printerModelName`), `assets/img/ffg_printers/a5.png`, `assets/img/tutorials/flashforge/models/a5.png`

## i18n
- Added: `reportInfoBadge`, `reportInfoXp` — 11 locales
- Changed: `squadXpLine`, `squadLevelUpText_platinum`, `xpNextPlatinumHow`, `xpChipsHint`, `squadRule_silver`, `squadRule_platinum`, `squadRuleXp` — "TigerTag+ Certified" (the product name, untranslated) instead of "certified TigerTag+" — 11 locales
