# Linked chips — third-party RFID chips on Tiger spools

Many spools already carry a chip from their maker (Bambu Lab, Creality, …): MIFARE
Classic 1K, 4-byte UID, content encrypted or proprietary. Tiger Studio cannot read
them as TigerTags, but their **UID** is stable and unique. A *linked chip* maps such
a UID to a spool of the inventory, so scanning the maker's chip behaves like
scanning a TigerTag: the spool opens, the scale updates its weight.

## Data model

```
users/{uid}/rfidAliases/{UID_HEX}     (owner read / write, Firestore rules)
  spoolId   string     — the inventory doc the chip points to
  chip      string     — "mifare1k" | "mifare4k" | "unknown" (from the reader's ATR)
  vendor    string     — "bambu" | "creality" | "unknown" (phase 1: always "unknown")
  linkedAt  timestamp
```

- One document per **physical** third-party chip, keyed by its UID (uppercase hex):
  a chip points to **one** spool at a time.
- A spool may have **several** linked chips (a Bambu Lab spool has one per flange).
- Per account: the same chip can be linked on two accounts independently.
- Linked chips earn **no XP** and no TigerCoins envelope.

## Which spool doc is the target

The user picks a **spool**, never a chip. A TigerTag / TigerTag+ twin is shown as one
spool; the app picks the doc:

| Spool | Target |
|---|---|
| TigerData / TigerData+ | its only doc |
| TigerTag / TigerTag+ single | its chip's doc |
| TigerTag / TigerTag+ twin, both chips known | the chip with `tag_index` 1; indexes unknown (0, older chips) → the **smaller UID** |
| Twin with only one chip scanned so far | that chip |

The target is **never moved** afterwards: the twin link already mirrors everything
(Studio opens the pair, `setSpoolWeightByRfid` mirrors the weight through
`twin_tag_uid`), so either half works. One exception: when the target doc is deleted,
the alias moves to its twin if it has one, otherwise it is removed (done lazily when
the chip is next resolved).

## Studio flow (phase 1)

1. A card is placed and is not a TigerTag (no readable user pages: `main.js` "no
   dump") → `rfid-foreign-chip { readerName, uid, chip }`.
2. Scans within 1.5 s are buffered (the TigerPOD's two readers see both flanges'
   chips at once).
3. Any of them already linked → the spool opens, like a TigerTag scan.
4. None linked → the **new-chip side card** (`#chipChoicePanel`: a rail of choices, the chosen view in the pane beside it), minimal on purpose (no UID, no chip type); "Add from the catalogue" is opened straight away (most materials are in it):
   "What would you like to do?", three choices:
   - **Add from the catalogue** → the catalogue pick side card (brand + the catalogue
     search: words, SKU, barcode); a tap opens the product's catalogue card, whose "+ Inventory" creates a TigerData+.
   - **Add manually** → the usual "Add product" panel; saving creates a TigerData.
   - In both cases the chips wait 15 min (`linkPendingTo`) and are linked to the
     spool when it is saved; no burn is offered then. Any other creation clears them
     (`clearPendingLink`).
   - **Link to my inventory** → a grid of the spools that have no linked chip yet
     (twin pairs shown once, search on brand, material, colour), drawn as the
     inventory grid's cards. A tap opens the material as in the inventory; its spool
     card then shows "Link the detected chips" with a Link button, which links every
     chip of the scan to it.

   The same side card opens for a **blank NTAG** (TigerTag Init or an erased / empty-NDEF
   chip, `_chipIsWritableBlank`), with the same title and the catalogue and
   manual tiles only: the created spool is then offered for burning onto that chip,
   as before. It replaces the "Add product" panel that used to open straight away.
5. The spool's detail panel lists its **linked chips** (its own and its twin's), each
   with ONE held "Unlink" (1.2 s) that removes every chip of the material together — never one chip on its own.

## Later phases

- **Phase 2 — ecosystem:** `setSpoolWeightByRfid` (TigerScale), the mobile app and the
  Tiger Touch firmware resolve linked chips too (read `rfidAliases/{UID}` when no
  inventory doc matches).
- **Phase 3 — optional, founder's call:** read the maker's chip content (Bambu Lab's
  format is documented publicly by the community) to prefill material, colour and
  weight and offer the matching catalogue product.
