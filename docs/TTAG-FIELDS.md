# `.ttag` field contract — chip payload vs enrichment metadata

`.ttag` is the **export and import** format of the TigerTag ecosystem. Its primary job is to carry
everything needed to **create a TigerTag or TigerTag+ chip** — so a `.ttag` must always contain the
chip payload. Everything else is **enrichment metadata**: useful in the app, never written to a chip.

This is the field-level contract, so third-party producers (the TigerSystem web playground,
brand/range collection generators, backup tools) can never land half-formed or corrupted data in a
user's inventory. Companion to the TigerSystem-Docs `ttag-format` spec.

**Totals:** 28 required · 44 optional — of which 24/24 chip-payload fields are required.

The contract is **binary**: a field is either needed for a well-formed record, or it is a supplement.
The rule that decides the column: **the chip payload is REQUIRED, enrichment metadata is OPTIONAL.**
A consequence worth stating: a chipless **TigerData** carries the full payload too, so it can become
a real **TigerTag** with no friction and nothing missing.
A "material" here is any TigerTag-tracked item — a filament spool, a resin, an accessory.

## Legend

| Marker | Meaning |
|---|---|
| **REQUIRED** | A well-formed record MUST carry it. Enforced at import: a material missing any of these is refused. |
| **OPTIONAL** | Free to omit. Passed through verbatim when present. |
| **SANITIZED** | Untrusted input — scheme-checked / clamped before any write. |
| **OVERWRITTEN ON IMPORT** | Replaced by Studio in Import mode; the file value only matters for Restore. |
| **IGNORED** | Carried in the file but not applied to the importing account. |

> Envelope-level `exportedAt` is an **ISO 8601 string**; timestamps *inside* `records[]` serialise
> as **epoch-ms**.

---

# Envelope

File-level wrapper. Validated before any record is read — a bad marker rejects the whole file.

## Envelope — the wrapper around records[]

| Field | Contract | Notes |
|---|---|---|
| `format` | **REQUIRED** | Must be the literal `"tigertag"`. Any other value ⇒ the whole file is rejected. |
| `kind` | **REQUIRED** | Must be the literal `"ttag"`. Any other value ⇒ the whole file is rejected. |
| `version` | **REQUIRED** | Integer ≥ 1 and ≤ the reader's supported version (currently 1). Newer ⇒ rejected as "made by a newer version". |
| `records` | **REQUIRED** | Non-empty array of material records. Empty or not an array ⇒ the whole file is rejected. |
| `exportedAt` | **OPTIONAL** | ISO 8601 string — NOT epoch-ms (that rule applies only inside `records[]`). Informational. |
| `exportedBy` | **OPTIONAL** | Exporting account uid. A UX hint only: same account ⇒ Restore pre-selected, otherwise Import. Never a security boundary — Firestore rules are. |
| `rfidBackups` | **OPTIONAL** | Map keyed by chip UID → the signed factory dump. Present only for TigerTag+ materials. Restored in Restore mode, dropped in Import mode. |

---

# Chip payload — what a TigerTag / TigerTag+ is burned from

A `.ttag` exists to CREATE chips, so this payload is REQUIRED: without it the file cannot produce a
chip, and a chipless TigerData could never become a TigerTag.

## Chip · identity

| Field | Contract | Notes |
|---|---|---|
| `uid` | **REQUIRED** | The chip's UID (hex), or `TigerData_<id>` for a chipless material. Doc id. Restore: a record without it is skipped. Never emit a legacy `CLOUD_` value. |
| `id_brand` | **REQUIRED** | Brand id, resolved against the TigerTag reference DB. |
| `id_material` | **REQUIRED** | Material id, resolved against the reference DB. |
| `id_type` | **REQUIRED** | Material type id. |
| `id_aspect1` | **REQUIRED** | Primary aspect id. |
| `id_aspect2` | **REQUIRED** | Secondary aspect id. |
| `id_diameter` | **REQUIRED** | Diameter id (1.75 / 2.85 …). |
| `id_measure_unit` | **REQUIRED** | Unit id that gives `measure` its meaning. |
| `id_version` | **REQUIRED** | Reference-data version id. |
| `id_tigertag` | **REQUIRED**, **OVERWRITTEN ON IMPORT** | Nonce. Import mints a fresh random one (so the copy is never TigerTag+); the file value only matters for Restore. |
| `id_product` | **REQUIRED**, **OVERWRITTEN ON IMPORT** | Catalogue product id. Import unsets it; the file value only matters for Restore. |

## Chip · quantity

| Field | Contract | Notes |
|---|---|---|
| `measure` | **REQUIRED**, **SANITIZED** | Quantity as stored on the chip, paired with `id_measure_unit`. Clamped finite ≥ 0. |

## Chip · colour

| Field | Contract | Notes |
|---|---|---|
| `color_r` | **REQUIRED**, **SANITIZED** | Primary colour, red. Clamped 0–255. |
| `color_g` | **REQUIRED**, **SANITIZED** | Primary colour, green. Clamped 0–255. |
| `color_b` | **REQUIRED**, **SANITIZED** | Primary colour, blue. Clamped 0–255. |
| `color_a` | **REQUIRED**, **SANITIZED** | Primary colour, alpha. Clamped 0–255. |

## Chip · raw data slots

| Field | Contract | Notes |
|---|---|---|
| `data1` | **REQUIRED** | Raw chip slot 1 — diameter id at creation (default 56 = 1.75 mm). |
| `data2` | **REQUIRED** | Raw chip slot 2. |
| `data3` | **REQUIRED** | Raw chip slot 3. |
| `data4` | **REQUIRED** | Raw chip slot 4. |
| `data5` | **REQUIRED** | Raw chip slot 5. |
| `data6` | **REQUIRED** | Raw chip slot 6. |
| `data7` | **REQUIRED** | Raw chip slot 7. |

## Chip · timestamp

| Field | Contract | Notes |
|---|---|---|
| `timestamp` | **REQUIRED** | The chip's encode timestamp — TigerTag chip epoch = 1 Jan 2000. Not Firestore bookkeeping. |

---

# Enrichment metadata — never written to a chip

Enriches the material inside the app. A chip is burned without any of it, and a material stays
well-formed without it.

## Derived & display

| Field | Contract | Notes |
|---|---|---|
| `measure_gr` | **OPTIONAL**, **SANITIZED** | Quantity normalised to grams. Drives the gauge AND the Import reset (`weight_available = capacity`). Clamped finite ≥ 0. |
| `capacity` | **OPTIONAL** | Last-resort capacity fallback in the Import reset chain. |
| `online_color_list` | **OPTIONAL** | Hex colour string (e.g. `00A046`), derived from the chip colour bytes. |
| `online_color_type` | **OPTIONAL** | Mono / dual / tri / rainbow discriminator. |
| `color_name` | **OPTIONAL** | Human colour label. |
| `material` | **OPTIONAL** | Human material label (e.g. `PETG HF Basic`). |
| `series` | **OPTIONAL** | Product series label. |
| `name` | **OPTIONAL** | Product name. |
| `label` | **OPTIONAL** | Free-text label. |
| `message` | **OPTIONAL** | Free-text message. |

## Inventory state

| Field | Contract | Notes |
|---|---|---|
| `weight_available` | **OPTIONAL**, **OVERWRITTEN ON IMPORT**, **SANITIZED** | Remaining grams. Import resets it to capacity — only meaningful for Restore. Clamped finite ≥ 0. |
| `container_id` | **OPTIONAL** | Container from the bundled catalogue — needed for gross→net weighing. |
| `container_weight` | **OPTIONAL** | Empty-container grams (may be a per-account calibrated value). |
| `TD` | **OPTIONAL**, **SANITIZED** | Transmission Density, measured by a TD1S. Clamped to `[0.1, 100]` when > 0, else `null`. |

## References & tags

| Field | Contract | Notes |
|---|---|---|
| `sku` | **OPTIONAL** | Product reference (SKU). |
| `barcode` | **OPTIONAL** | Product reference (EAN / barcode). |
| `info1` | **OPTIONAL** | Free-text slot 1. |
| `info2` | **OPTIONAL** | Free-text slot 2. |
| `info3` | **OPTIONAL** | Free-text slot 3. |
| `tags` | **OPTIONAL** | Array of user labels. |

## Links — all untrusted

| Field | Contract | Notes |
|---|---|---|
| `url_img` | **OPTIONAL**, **SANITIZED** | Product image URL. Non-http(s) ⇒ dropped on import. |
| `url_img_user` | **OPTIONAL**, **SANITIZED** | User's custom image URL. Non-http(s) ⇒ dropped on import. |
| `LinkTDS` | **OPTIONAL**, **SANITIZED** | Technical datasheet URL. Non-http(s) ⇒ dropped. |
| `LinkMSDS` | **OPTIONAL**, **SANITIZED** | Safety datasheet URL. Non-http(s) ⇒ dropped. |
| `LinkYoutube` | **OPTIONAL**, **SANITIZED** | Video URL. Non-http(s) ⇒ dropped. |
| `LinkREACH` | **OPTIONAL**, **SANITIZED** | REACH compliance URL. Non-http(s) ⇒ dropped. |
| `LinkROHS` | **OPTIONAL**, **SANITIZED** | RoHS compliance URL. Non-http(s) ⇒ dropped. |
| `LinkFOOD` | **OPTIONAL**, **SANITIZED** | Food-contact compliance URL. Non-http(s) ⇒ dropped. |

## Relations & state

| Field | Contract | Notes |
|---|---|---|
| `twin_tag_uid` | **OPTIONAL** | Twinned materials only. Reciprocity expected and both records must be in the same file — a half-twin is refused as a whole. Import remaps it; dropped if the partner isn't in the batch. |
| `rfidBackup` | **OPTIONAL**, **OVERWRITTEN ON IMPORT** | `true` only for TigerTag+, and only with a matching `rfidBackups` entry keyed by this record's `uid`. Import forces `false`. |
| `rfidListed` | **OPTIONAL**, **OVERWRITTEN ON IMPORT** | Deleted on import. |
| `deleted` | **OPTIONAL**, **OVERWRITTEN ON IMPORT** | Reset to `null` on import/restore. A producer must never ship a deleted record. |
| `deleted_at` | **OPTIONAL**, **OVERWRITTEN ON IMPORT** | Reset to `null` on import/restore. |

## Storage placement — carried, never applied

| Field | Contract | Notes |
|---|---|---|
| `rack` | **OPTIONAL**, **IGNORED** | Rack object. An imported material never inherits the exporter's storage layout. |
| `rack_id` | **OPTIONAL**, **IGNORED** | Rack id. Not applied on import. |
| `level` | **OPTIONAL**, **IGNORED** | Shelf level. Not applied on import. |
| `position` | **OPTIONAL**, **IGNORED** | Slot position. Not applied on import. |

## Firestore stamps

| Field | Contract | Notes |
|---|---|---|
| `updatedAt` | **OPTIONAL**, **OVERWRITTEN ON IMPORT** | Always stamped fresh on write. Serialises as epoch-ms inside `records[]`. |
| `updated_at` | **OPTIONAL** | Legacy stamp. Serialises as epoch-ms. |
| `last_update` | **OPTIONAL** | Legacy stamp. Serialises as epoch-ms. |
| `needUpdateAt` | **OPTIONAL** | Auxiliary stamp. Serialises as epoch-ms. |

---

## Minimal well-formed record

A record MUST carry: `uid`, `id_brand`, `id_material`, `id_type`, `id_aspect1`, `id_aspect2`,
`id_diameter`, `id_measure_unit`, `id_version`, `id_tigertag`, `id_product`, `measure`, `color_r`,
`color_g`, `color_b`, `color_a`, `data1`, `data2`, `data3`, `data4`, `data5`, `data6`, `data7`,
`timestamp`.

Plus a valid envelope: `format`, `kind`, `version`, `records`.

## Enforcement

Studio enforces this at import (`_ttagRecordValid` / `_ttagMaterialValid` in `renderer/inventory.js`):

- A record missing any REQUIRED field is refused. `null` and `""` do not count as present.
- A **material is atomic** — a twin pair passes only if both sides do; a half-twin is refused whole.
- Refused materials never reach the preview and are **counted and shown** to the user
  (`ttagRejected`), never silently dropped.
- The write builder re-filters as a last line of defence, so nothing invalid can ever be written.

---

## Editing this contract

`playground/ttag-fields-editor/index.html` is a standalone page (no dependencies, no server) that
lists every field with a Required / Optional toggle, chip / off-chip banding, live counters and a
per-category bulk set. It regenerates this exact document — edit there, then **Download
TTAG-FIELDS.md** and drop it back into `docs/`.
