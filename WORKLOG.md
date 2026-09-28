# Worklog — v2.30.1 (in progress)

## Added
- Dev-drive test harness: `npm run start:drive` starts the DEV app with Chromium's DevTools protocol on 127.0.0.1:9339 (opt-in env `TIGER_DEVDRIVE`, never in a packaged build); `npm run drive -- <eval|click|type|wait|shot|logs|reload>` drives the renderer from the command line — evaluate JS, click / type by CSS selector, screenshot the window or one element, stream console + uncaught errors — so changes can be verified without a human at the keyboard — `main.js`, `scripts/devdrive.mjs`, `package.json`
- Dev tool `playground/swatch-blend/index.html` — tunes the bicolor/tricolor blend width (`SPLIT_BLEND`) live on every surface (table dot, circle, tile, grid card and detail card, each with and without a photo, fill bar), with the produced CSS

## Changed
- Add Product (manual): the colour preview is a real grid card — `_gridCardInnerHTML` fed the very doc the form will save (`_adpDraftDoc`, extracted from the RFID Data block, read as a chipless TigerData row): colour square with the TigerTag logo, name, material · brand, weight and TigerData badge, updating live as the form is filled (and while dragging the custom colour picker). The mode-by-mode gradient code of the old round swatch is gone — the card goes through `colorBg`, so the preview can't drift from the grid. The view behind the colour picker is no longer blurred or dimmed, so the preview stays sharp while the colour is edited (brand/material pickers keep their dim, without blur) — `renderer/inventory.html`, `renderer/css/60-modals.css`, `renderer/inventory.js`
- Material swatch convention v1.2: a **Tricolor** aspect (chip slots, or a list of 3+ colours on a Tricolor product) is drawn as the smooth conic sweep (`_conicSweep`, the catalogue's `conic_gradient` look) unless aspect 1 or 2 is Rainbow (stays a 135° ramp). Bicolor and any other two or three hard colours (chip aspect or catalogue list) are drawn as a soft split on the 135° axis — each colour solid, with a 20 % blended seam between them (`SPLIT_BLEND`, one knob for every surface), first colour top-left — instead of a hard diagonal / a 3-sector camembert; four or more colours stay a camembert; a tricolor with no third slot is a 2-colour ramp (no longer repeats slot 1). One change in `_pieSplit`, so swatches, the frames round photos and the Add-Product preview all follow. Amended first in TigerSystem-Docs — `renderer/inventory.js`, `playground/material-swatch/index.html`, `docs/MATERIAL-SWATCH.md`, `CLAUDE.md`

## Fixed
- Material swatch: Bicolor / Tricolor / Rainbow are recognised by their aspect ID (252 / 24 / 145 — `ASPECT_ID`), no longer by matching the label text, which is display copy and can change; rows now carry `aspect1Id` / `aspect2Id` (spools, and catalogue items from `RFID_Data`) — `renderer/inventory.js`, `playground/material-swatch/index.html`

## Removed

## i18n
- Pending cleanup, carried over from v2.23.1: `scaleNoActivity` and `scaleReader` are orphaned — still shipped in all 11 locales, no longer referenced anywhere in `renderer/`
