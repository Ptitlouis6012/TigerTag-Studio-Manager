# Worklog — v2.18.1 (in progress)

## Added
- Add-material source picker — "+ Material" now opens a side card asking where the material comes
  from: **From Catalogue** (opens the catalogue in grid view — picking an unfamiliar product is a
  visual task — and yields a TigerData+) or **Manually** (you fill it in, yields a TigerData). Each
  row shows the tier pair its path leads to — `TigerData+` `TigerTag+` / `TigerData` `TigerTag`,
  drawn with the header stats' own capsules — so the outcome, chipless now and once burned, is
  named before you commit; the explanation sits in the shared ⓘ bubble. No scrim, like the spool
  detail card — the app stays visible and clickable behind it — and it joins the side-card cascade
  as its leftmost member, so opening a spool or a printer pushes it left instead of burying it.
  Same side card + rows as the printer add flow —
  `renderer/inventory.html`, `renderer/inventory.js`, `renderer/css/40-printers.css`
- "Get it on MakerWorld" button in the TigerScale panel's empty state, next to "View on GitHub" —
  links to the printable TigerScale V3 body. Both CTAs now stack full-width so the pair reads the
  same in all 9 locales — `renderer/IoT/tigerscale/index.js`, `renderer/IoT/tigerscale/tigerscale.css`

## Changed
- TigerScale onboarding card rebuilt around the V3 machine — the photo sits on a lit stage with a
  "V3" generation badge, the ✓ list became six icon-led feature rows (dual NFC readers, real
  remaining weight, on-board touchscreen + calibration wizard, account sync, offline recognition,
  runs unattended), and both destinations keep the brand colour they already have in the sidebar
  (GitHub slate, MakerWorld teal + package icon) —
  `renderer/IoT/tigerscale/index.js`, `renderer/IoT/tigerscale/tigerscale.css`
- TigerScale illustration + header icon replaced with the V3 body (empty state, scale card
  thumbnail, README, header health icon) — `assets/img/TigerScale_Photo.png`,
  `assets/svg/icons/icon_tigerscale_3d.svg` (masters archived in `assets-src/`)
- The TigerScale "View on GitHub" button pointed at the V2 repo (`TigerTag-Scale`, no longer
  developed); it now opens `Tiger-Scale-V3` — `renderer/IoT/tigerscale/index.js`

## Fixed
- Printer photos showed as black silhouettes in the Printers list view in dark mode — the row
  thumbnail carried a leftover `mix-blend-mode: multiply` (needed back when the catalogue images had
  a white background; they are transparent PNGs now), which multiplied each photo with the dark row
  background. Permanent on Windows, hover-only on macOS. Blend mode dropped — `renderer/css/40-printers.css`
- Windows virtual smart-card readers ("Windows Hello for Business", "Microsoft Virtual Smart Card")
  are no longer treated as NFC readers — PC/SC enumerates these TPM-backed certificate readers
  exactly like an ACR122U and they permanently report a card present, so a user with 2 readers got a
  3rd burn slot that never turned green and the Burn button stayed disabled. Added to the existing
  name filter at the reader-registration gate — `services/nfc-process.js`, `docs/READER-SELECTION-BRIEF.md`

## Removed
- The standalone "From Catalogue" button in the inventory action bar — it is now the first choice of
  the "+ Material" side card, so adding a material has one entry point instead of two.
  `renderer/inventory.html`, `renderer/inventory.js` (handler + its `_syncInvBarButtons` visibility
  line), i18n key `catalogBtn`

## i18n
- Added: `matSourceTitle`, `matSourceSub`, `matSourceCatalogue`, `matSourceCatalogueHint`,
  `matSourceManual`, `matSourceManualHint` — 9 locales
- Added: `scaleEmptyCtaModel`, `scaleEmptyBullet4`, `scaleEmptyBullet5`, `scaleEmptyBullet6` — 9 locales
- Removed: `catalogBtn` — 9 locales
- Rewritten for the V3 machine: `scaleEmptySub`, `scaleEmptyBullet1`, `scaleEmptyBullet2`,
  `scaleEmptyBullet3` — 9 locales
