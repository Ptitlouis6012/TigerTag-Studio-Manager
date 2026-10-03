# Worklog — v2.33.0 (released 2026-10-03)

## Added
- Tag index / tag count (TigerTag protocol v2.2, chip byte +39: high nibble = chip i, low nibble = n chips) — `main.js`, `preload.js`, `renderer/inventory.js`, `renderer/rfid_protocol/tigertag/parser.js`, `renderer/rfid_protocol/tigertag/index.js`, `package.json`, `package-lock.json`
  - SDK `tigertag` 1.1.0 → ^1.2.0, forced offline in the main process (`TIGERTAG_OFFLINE=1` — Studio has its own reference-data service; no daily api.tigertag.io check, no cache-folder writes)
  - Burn: guided encode stamps chip i of n (0x11 single, 0x12 / 0x22 twin) via `rfid:burn-one` `{ tagCount, tagIndex }`; the migrated docs record `tag_index` / `tag_count`
  - Re-write paths (`rfid:write-now`, `rfid:encode-cloud`) keep the chip's own byte +39 alongside its timestamp (`_keepChipTimestamp` → `_keepChipIdentity`) — a factory twin no longer loses its 0x12/0x22 on a weight or colour sync; a full write without a readable chip falls back to the doc's `tag_index` / `tag_count`
  - Read: every scan stores `tag_index` / `tag_count` on the inventory doc (unpacked from the SDK's `tag_info`); rows carry `tagIndex` / `tagCount`
  - Twin pairing (2-reader scan + `autoLinkTwinsByTimestamp`) refuses pairs the byte rules out — a chip marked single, mismatched counts, or the same rank twice; unknown (0) never blocks, legacy pairing unchanged
  - Spool card: "Chip i of n" row in Details; a "twin still missing — put the other chip on the reader" banner when `tag_count` ≥ 2 and the partner was never scanned; RFID tester shows "Tag i of n"
  - `.ttag`: exported with the record (verbatim doc); import keeps them when 0–15 and drops them on a chipless record or an out-of-range value; listed as on-chip, optional fields in `docs/TTAG-FIELDS.md` + `playground/ttag-fields-editor/index.html`; `TTAG_ON_CHIP_FIELDS` updated
  - Chip-only: `tag_index` / `tag_count` join `CHIP_ONLY_FIELDS`, so a duplicated (chipless) spool never inherits "chip 1 of 2"; rows of chipless docs ignore them
  - Docs: `docs/firestore-schema.md`, MCP data guide, backend `README.md` (inventory tree)
  - Verified on real chips (TigerPOD, 2 readers): factory 0x12 + single 0x11 of the same product → stored 1/2 and 1/1, NOT paired, missing-twin banner on the 1/2; weight write 1000→950→1000 g touched only page 0x17, byte +39 and timestamp unchanged

## Changed
- Snapmaker U1 camera now works on the stock firmware, not only on Paxx: when Moonraker declares no webcam, Studio wakes the printer's own monitor (`camera.start_monitor` every 10 s over the existing Moonraker socket) and shows its 1080p JPEG refreshed ~1 fps (Blob URLs, swapped only once downloaded); Paxx keeps the WebRTC player; the loop runs only while a feed is on screen (12 s grace) — `renderer/printers/snapmaker/widget_camera.js`, `renderer/printers/snapmaker/index.js`, `renderer/inventory.js`, `renderer/css/50-snapmaker.css`, `renderer/printers/snapmaker/PROTOCOL.md`
- TigerScale photo is now the V3 hardware render (README, scale card, empty state) — contributed in PR #34; shipped copy trimmed + resized to 512² and palettised (1.38 MB → 78 KB), full-res master archived (committed c933d61) — `assets/img/TigerScale_V3.png`, `assets-src/img/TigerScale_V3.png`, `assets-src/README.md`, `renderer/IoT/tigerscale/index.js`, `README.md`

## Fixed
- Printer side card: the whole card scrolls as one (camera included) with no visible scrollbar — the body had become a second scroller (generic `.panel-body` overflow), so the Snapmaker camera, kept outside it to survive re-renders, stayed pinned at the top — `renderer/css/40-printers.css`
- Deleting products (bulk "Delete" in Favorites) was always refused with "permission denied" since the tier-gated attachments rule (v2.12.0): the `products` rule read `request.resource.data` in a single `allow write`, which errors on a delete — split into `allow create, update` (attachment cap kept) + `allow delete: if isOwner()` — backend `firestore.rules` (deployed + committed 4aa71b8)
- Security: `js-yaml` 4.3.1 → 4.3.2 (CVE-2026-84375 / GHSA-2883-xcg3-v3hh, YAML merge-key DoS), transitive via `electron-updater` (parses `latest*.yml`) — `package-lock.json` (already committed in 22b3f3c; internal, not for release note / What's New)
- Toggling ★/❤ on a catalogue product no longer flickers the catalogue grid: a render that lands on the same result list patches the cards' product badges instead of rebuilding every card (which re-inserted the photos 2-3× per click and dropped the chunks scrolled into view); the product card keeps its photo node across re-renders — `renderer/inventory.js` (other views still to audit)

## Removed

## i18n
- Added: `detTagIndex`, `detTagIndexVal`, `twinMissingHint` — 11 locales
