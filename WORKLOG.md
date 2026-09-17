# Worklog — v2.27.3 (in progress)

## Added

## Changed

## Fixed
- **Bambu Lab: an AMS HT's slot was edited at the wrong address.** A machine reports each AMS by its OWN id, and an AMS HT is id **128**, not the next number in the row — measured on a user's X1C carrying two AMS v1 plus an AMS HT (`ams.ams[]` = `"0"`, `"1"`, `"128"`). The filament card passed each unit's POSITION in the list as `data-ams-id`, so the HT's slot sent `ams_filament_setting` with `ams_id: 2`, a module that does not exist: the colour and material went nowhere, silently, since the printer answers nothing and the card only ever shows what the machine reports back. It matched by luck for the first two units, whose position equals their id. The row now carries the module's own id — `renderer/printers/bambulab/cards.js`.
  - **The edit sheet opened blank on an AMS HT**: it looked the module up by array index (`ams[128]` in a 3-entry list), so the sheet offered the default orange and the first material in the list instead of what the slot actually holds — an overwrite waiting to happen. Looked up by id now — `renderer/printers/bambulab/index.js`.
  - **The colour never pre-filled on ANY slot** (found while verifying the above on hardware): `_parseColor` already returns `"#RRGGBB"` and the sheet prefixed a second `#`, so it carried `"##2850E"` — an invalid colour, which the OS picker silently reads as black and which paints no swatch at all. Whatever the slot held, the sheet showed grey and the picker opened on black; applying without touching the colour wrote that black. The hex is normalised now (strip `#`, keep six hex digits, fall back to the default) — `renderer/printers/bambulab/index.js`.
  - **The board drew four bays for an AMS HT**, which holds one. `bambuGetSlots` emitted a fixed four per unit while `bambuGetUnits`, right beside it, already derived the count from the module's tray list — the two views of the same hardware disagreed. Both derive it now — `renderer/printers/bambulab/index.js`.
  - Verified on the reporter's X1C (LAN) with an AMS HT attached, through the app's own filament card: the machine reports its single AMS as id **1** and the AMS HT as **128**, so BEFORE the fix editing A1-A4 wrote to a nonexistent `ams_id 0` while the HT's slot wrote to the real AMS. After: the HT slot carries `ams_id 128`, its sheet opens on the filament actually loaded (PETG, `#2850E0`), and applying green `#1CB01C` came back green from the machine with the AMS untouched — the card only ever shows what the printer reports, so the colour returning is proof the write landed. Slot restored to PETG `#2850E0` and read back identical.
  - `PROTOCOL.md` §8.3 records the id-128 rule, the `info: "2004"` marker and the `ams_exist_bits` reading, since the id is what `ams_filament_setting` addresses — `renderer/printers/bambulab/PROTOCOL.md`.

## Removed

## i18n
- Pending cleanup, carried over from v2.23.1: `scaleNoActivity` and `scaleReader` are orphaned — still shipped in all 9 locales, no longer referenced anywhere in `renderer/`
