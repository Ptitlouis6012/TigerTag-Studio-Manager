# `.ttag` field contract — per product type

`.ttag` is the **export and import** format of the TigerTag ecosystem, whose job is to carry
everything needed to **create a TigerTag / TigerTag+ chip**. The **envelope, the field list, the data
types and the on-chip mapping are shared**; the **Required / Optional / N-A contract is set per
product type** (`id_type`). Today only **Filament (142)** is ratified and the importer accepts only
142; the other types are drafts to be defined.

Each field has three independent properties — **Type** (wire format), **On chip** (written to the
physical chip), **Contract** (per type). They are genuinely independent: `color_name` is on the chip
yet optional.

A field can also be **Req if chip**: mandatory for a record that carries a chip, and required to be
**absent** on a chipless one. That axis is the record's TIER, not its product type — `id_tigertag`
names the chip's version, so it has nothing to name when there is no chip.

## Product types

| id | Name | Status |
|---|---|---|
| `142` | Filament | ratified · importer-accepted |
| `116` | Accessories | draft |
| `41` | Spare Part | draft |
| `173` | Resin | draft |

## Legend

| Marker | Meaning |
|---|---|
| **Req** | REQUIRED — a well-formed record MUST carry it. |
| **Req if chip** | REQUIRED of a record that HAS a chip, and it must be ABSENT otherwise. A chipless record is recognised by its `uid` (`TigerData_…`, or the legacy `CLOUD_…`). |
| Opt | OPTIONAL — free to omit; passed through verbatim. |
| — | N/A — the field is not used for that product type. |
| **SANITIZED** | Untrusted input — scheme-checked / clamped before any write. |
| **OVERWRITTEN ON IMPORT** | Replaced by Studio in Import mode; only matters for Restore. |
| **IGNORED** | Carried in the file but not applied to the importing account. |

> Envelope `exportedAt` is an **ISO 8601 string**; timestamps inside `records[]` serialise as
> **epoch-ms**; the chip's `timestamp` is **seconds since 2000-01-01**.

---

# Envelope — shared across every product type

File-level wrapper, validated before any record is read. Not part of a record, never on a chip. Identical for all types.

## Envelope — the wrapper around records[]

| Field | Type | On chip | Filament (142) | Accessories (116) | Spare Part (41) | Resin (173) | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `format` | `string` | — | **Req** | **Req** | **Req** | **Req** | Literal `"tigertag"`. Any other value rejects the whole file. |
| `kind` | `string` | — | **Req** | **Req** | **Req** | **Req** | Literal `"ttag"`. Any other value rejects the whole file. |
| `version` | `int` | — | **Req** | **Req** | **Req** | **Req** | Integer ≥ 1 and ≤ the reader's supported version (currently 1). |
| `records` | `array<object>` | — | **Req** | **Req** | **Req** | **Req** | Non-empty array of material records. |
| `exportedAt` | `string (ISO 8601)` | — | Opt | Opt | Opt | Opt | Export date, ISO 8601 string — NOT epoch-ms. Informational. |
| `exportedBy` | `string (uid)` | — | Opt | Opt | Opt | Opt | Exporting account uid. UX hint for Restore/Import; never a security boundary. |
| `rfidBackups` | `object<uid,object>` | — | Opt | Opt | Opt | Opt | Map chip UID → signed factory dump. TigerTag+ only. Restored in Restore, dropped in Import. |

---

# Record fields

The Header block is the same for every type; the rest of the contract (Required / Optional / N-A) is set PER TYPE — pick a type above.

## Header — same for every product type

| Field | Type | On chip | Filament (142) | Accessories (116) | Spare Part (41) | Resin (173) | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `uid` | `string (hex | TigerData_…)` | **yes** | **Req** | **Req** | **Req** | **Req** | Chip hardware UID in hex, or `TigerData_<id>` for a chipless material. Firestore doc id. Never emit a legacy `CLOUD_`. |
| `id_type` | `uint8 (0–255) · ref` | **yes** | **Req** | **Req** | **Req** | **Req** | Product type id — references `id_type.json` (142 Filament · 116 Accessories · 41 Spare Part · 173 Resin). This value selects which contract below applies. Import accepts 142 only for now. |
| `id_brand` | `uint16 (0–65535) · ref` | **yes** | **Req** | **Req** | **Req** | **Req** | Brand id — references `id_brand.json`. |
| `id_material` | `uint16 (0–65535) · ref` | **yes** | **Req** | **Req** | **Req** | **Req** | Material id — references `id_material.json`. |
| `id_version` | `string (derived)` | no | — | — | — | — | NOT a stored field, and never required: the version/tier NAME (e.g. "TigerTag", "TigerTag+") DERIVED from id_tigertag via id_version.json. A record normally omits it. |
| `id_tigertag` | `uint32 · ref id_version.json` | **yes** | **Req if chip** | **Req if chip** | **Req if chip** | **Req if chip** | **OVERWRITTEN ON IMPORT**. The chip's tag id (bytes 0-3). It REFERENCES id_version.json, so only the four ids listed there are legal: 0 RFID Empty, 1542820452 TigerTag, 1816240865 TigerTag Init, 3155151767 TigerTag+. Required of a record that HAS a chip; a chipless record (uid TigerData_… or legacy CLOUD_…) has no chip and therefore no version, so it must NOT carry the field at all — it is written for the first time when a real chip is programmed. Studio ≤2.15.0 stored a random u32 here on chipless materials, a value outside the referential; 2.16.0 stopped writing it and deletes the stray ones. Import drops the field (which is what makes the copy not a TigerTag+); Restore keeps it verbatim. |
| `id_product` | `uint32 (0–4294967295)` | **yes** | Opt | Opt | Opt | Opt | **OVERWRITTEN ON IMPORT**. Catalogue product id — look up a real one in the public catalogue at https://tigersystem.io/fr/catalog. When unknown it MUST be `4294967295` (`0xFFFFFFFF`, the “generic” sentinel), never absent. Import always resets it to that value. |
| `timestamp` | `uint32 (0–4294967295, chip epoch)` | **yes** | **Req** | **Req** | **Req** | **Req** | Chip encode timestamp — SECONDS since 2000-01-01 (TigerTag chip epoch, not Unix, not Firestore). |

## Filament identity

| Field | Type | On chip | Filament (142) | Accessories (116) | Spare Part (41) | Resin (173) | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id_aspect1` | `uint8 (0–255) · ref` | **yes** | **Req** | **Req** | **Req** | **Req** | Primary aspect id — references `id_aspect.json` (one shared file for both aspects). |
| `id_aspect2` | `uint8 (0–255) · ref` | **yes** | **Req** | **Req** | **Req** | Opt | Secondary aspect id — same `id_aspect.json`. |
| `id_diameter` | `— (not a record field)` | **yes** | — | — | — | Opt | NOT a field of the record. It is a name for chip byte `data1`, whose value references `id_diameter.json` (e.g. 56 = 1.75 mm) — see data1, which IS required. Studio reads it as `id_diameter ?? data1` and writes it back as `data1`; no inventory document has ever carried an `id_diameter` key. Listing it as required rejected every real material at export. |
| `id_unit` | `uint8 (0–255) · ref` | **yes** | **Req** | **Req** | **Req** | **Req** | Unit id — gives `measure` its meaning (21 = g, 35 = kg, …). The REFERENCE FILE is `id_measure_unit.json`, but the record field is `id_unit`: the contract used to name it after the file, which rejected every real material at export. |

## Quantity

| Field | Type | On chip | Filament (142) | Accessories (116) | Spare Part (41) | Resin (173) | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `measure` | `uint24 (0–16777215)` | **yes** | **Req** | **Req** | **Req** | **Req** | **SANITIZED**. A bare quantity with NO unit of its own — the unit comes from `id_measure_unit`. Clamped finite ≥ 0. |

## Colour

| Field | Type | On chip | Filament (142) | Accessories (116) | Spare Part (41) | Resin (173) | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `color_r` | `uint8 (0–255)` | **yes** | **Req** | **Req** | **Req** | **Req** | **SANITIZED**. Primary colour, red. |
| `color_g` | `uint8 (0–255)` | **yes** | **Req** | **Req** | **Req** | **Req** | **SANITIZED**. Primary colour, green. |
| `color_b` | `uint8 (0–255)` | **yes** | **Req** | **Req** | **Req** | **Req** | **SANITIZED**. Primary colour, blue. |
| `color_a` | `uint8 (0–255)` | **yes** | **Req** | **Req** | **Req** | **Req** | **SANITIZED**. Primary colour, alpha. |
| `color_r2` | `uint8 (0–255)` | **yes** | Opt | Opt | Opt | Opt | **SANITIZED**. Second colour, red. Absent or empty ⇒ `0`. |
| `color_g2` | `uint8 (0–255)` | **yes** | Opt | Opt | Opt | Opt | **SANITIZED**. Second colour, green. Absent or empty ⇒ `0`. |
| `color_b2` | `uint8 (0–255)` | **yes** | Opt | Opt | Opt | Opt | **SANITIZED**. Second colour, blue. Absent or empty ⇒ `0`. |
| `color_r3` | `uint8 (0–255)` | **yes** | Opt | Opt | Opt | Opt | **SANITIZED**. Third colour, red. Absent or empty ⇒ `0`. |
| `color_g3` | `uint8 (0–255)` | **yes** | Opt | Opt | Opt | Opt | **SANITIZED**. Third colour, green. Absent or empty ⇒ `0`. |
| `color_b3` | `uint8 (0–255)` | **yes** | Opt | Opt | Opt | Opt | **SANITIZED**. Third colour, blue. Absent or empty ⇒ `0`. |
| `color_name` | `string (≤28 B UTF-8)` | **yes** | Opt | Opt | Opt | Opt | Free description stored ON the chip in a fixed 28-byte UTF-8 slot. On-chip yet optional. |

## Raw chip data slots

| Field | Type | On chip | Filament (142) | Accessories (116) | Spare Part (41) | Resin (173) | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `data1` | `uint8 (0–255)` | **yes** | **Req** | **Req** | **Req** | Opt | Raw chip slot 1. REQUIRED for Filament (the diameter id, default `56` = 1.75 mm) — its requiredness depends on id_type (Optional for Resin, where it means Mixing Time). Same chip byte as id_diameter for Filament. |
| `data2` | `uint16 (0–65535)` | **yes** | **Req** | **Req** | **Req** | **Req** | Raw chip slot 2. Absent or empty ⇒ `0`. |
| `data3` | `uint16 (0–65535)` | **yes** | **Req** | **Req** | **Req** | **Req** | Raw chip slot 3. Absent or empty ⇒ `0`. |
| `data4` | `uint8 (0–255)` | **yes** | **Req** | **Req** | **Req** | **Req** | Raw chip slot 4. Absent or empty ⇒ `0`. |
| `data5` | `uint8 (0–255)` | **yes** | **Req** | **Req** | **Req** | **Req** | Raw chip slot 5. Absent or empty ⇒ `0`. |
| `data6` | `uint8 (0–255)` | **yes** | **Req** | **Req** | **Req** | **Req** | Raw chip slot 6. Absent or empty ⇒ `0`. |
| `data7` | `uint8 (0–255)` | **yes** | **Req** | **Req** | **Req** | **Req** | Raw chip slot 7. Absent or empty ⇒ `0`. |

## Derived quantity

| Field | Type | On chip | Filament (142) | Accessories (116) | Spare Part (41) | Resin (173) | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `measure_gr` | `number (grams)` | no | Opt | Opt | Opt | Opt | **SANITIZED**. Grams, DERIVED from the on-chip `measure` + `id_measure_unit` (1 kg ⇒ 1000 g). Already implemented and used across the app. A producer never needs to send it — the app computes it. |
| `measure_ml` | `number (millilitres)` | no | Opt | Opt | Opt | Opt | Millilitres, derived from the SAME source (`measure` + `id_measure_unit`, 1 L ⇒ 1000 ml) — the volume counterpart of `measure_gr` for liquid products that report a volume (some liquids still report a mass → `measure_gr`). New: the derivation mechanism exists; this ml output isn't wired up yet. |
| `capacity` | `number` | no | Opt | Opt | Opt | Opt | Last-resort capacity fallback in the Import weight-reset chain. |

## Derived & display

| Field | Type | On chip | Filament (142) | Accessories (116) | Spare Part (41) | Resin (173) | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `online_color_list` | `string (hex)` | no | Opt | Opt | Opt | Opt | Hex colour string (e.g. `00A046`), derived from the chip colour bytes. |
| `online_color_type` | `uint` | no | Opt | Opt | Opt | Opt | Mono / dual / tri / rainbow discriminator. |
| `material` | `string` | no | Opt | Opt | Opt | Opt | Human material label resolved for display. |
| `series` | `string` | no | Opt | Opt | Opt | Opt | Product series label. |
| `name` | `string` | no | Opt | Opt | Opt | Opt | Product name. |
| `label` | `string` | no | Opt | Opt | Opt | Opt | Free-text label. |
| `message` | `string` | no | Opt | Opt | Opt | Opt | Free-text message. |

## Inventory state

| Field | Type | On chip | Filament (142) | Accessories (116) | Spare Part (41) | Resin (173) | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `weight_available` | `number (grams)` | no | Opt | Opt | Opt | Opt | **OVERWRITTEN ON IMPORT**, **SANITIZED**. Remaining grams. Import resets it to capacity, so it only matters for Restore. |
| `container_id` | `uint (ref)` | no | Opt | Opt | Opt | Opt | Container from the bundled catalogue — needed for gross→net weighing. |
| `container_weight` | `number (grams)` | no | Opt | Opt | Opt | Opt | Empty-container grams; may be a per-account calibrated value. |
| `TD` | `uint16 (0–65535, /10 = mm)` | **yes** | Opt | Opt | Opt | Opt | **SANITIZED**. Transmission Density (measured by a TD1S). On the chip at byte offset 44 as a uint16, divided by 10 = mm. Clamped to [0.1, 100] when > 0, else null. |

## References & tags

| Field | Type | On chip | Filament (142) | Accessories (116) | Spare Part (41) | Resin (173) | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `sku` | `string` | no | Opt | Opt | Opt | Opt | Product reference (SKU). |
| `barcode` | `string (digits only)` | no | Opt | Opt | Opt | Opt | EAN / barcode — digits only, no letters or separators. |
| `info1` | `string` | no | Opt | Opt | Opt | Opt | Free-text slot 1. |
| `info2` | `string` | no | Opt | Opt | Opt | Opt | Free-text slot 2. |
| `info3` | `string` | no | Opt | Opt | Opt | Opt | Free-text slot 3. |
| `tags` | `array<string>` | no | Opt | Opt | Opt | Opt | A plain JSON array of strings — Studio filters it to strings on read (`data.tags.filter(x => typeof x === "string")`). No separator-joined form. |

## Links — all untrusted

| Field | Type | On chip | Filament (142) | Accessories (116) | Spare Part (41) | Resin (173) | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `url_img` | `string (http/https URL)` | no | Opt | Opt | Opt | Opt | **SANITIZED**. Product image URL. Non-http(s) scheme dropped on import. |
| `url_img_user` | `string (http/https URL)` | no | Opt | Opt | Opt | Opt | **SANITIZED**. User's own image URL. Non-http(s) scheme dropped on import. |
| `LinkTDS` | `string (http/https URL)` | no | Opt | Opt | Opt | Opt | **SANITIZED**. Technical datasheet URL. |
| `LinkMSDS` | `string (http/https URL)` | no | Opt | Opt | Opt | Opt | **SANITIZED**. Safety datasheet URL. |
| `LinkYoutube` | `string (http/https URL)` | no | Opt | Opt | Opt | Opt | **SANITIZED**. Video URL. |
| `LinkREACH` | `string (http/https URL)` | no | Opt | Opt | Opt | Opt | **SANITIZED**. REACH compliance URL. |
| `LinkROHS` | `string (http/https URL)` | no | Opt | Opt | Opt | Opt | **SANITIZED**. RoHS compliance URL. |
| `LinkFOOD` | `string (http/https URL)` | no | Opt | Opt | Opt | Opt | **SANITIZED**. Food-contact compliance URL. |

## Relations & state

| Field | Type | On chip | Filament (142) | Accessories (116) | Spare Part (41) | Resin (173) | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `twin_tag_uid` | `string (hex UID)` | no | Opt | Opt | Opt | Opt | Partner chip's hex UID. Twins only: reciprocity expected, both records in the same file — a half-twin is refused. |
| `rfidBackup` | `bool` | no | Opt | Opt | Opt | Opt | **OVERWRITTEN ON IMPORT**. `true` only for TigerTag+, with a matching `rfidBackups` entry keyed by this record's uid. The dump is the chip's user memory pages `0x04`–`0x27` (= 4–39 decimal, 144 bytes — the full NTAG213 user memory), stored in the envelope. Import forces `false`. |
| `rfidListed` | `bool` | no | Opt | Opt | Opt | Opt | **OVERWRITTEN ON IMPORT**. Deleted on import. |
| `deleted` | `bool | null` | no | Opt | Opt | Opt | Opt | **OVERWRITTEN ON IMPORT**. Reset to `null` on import/restore. Never ship a deleted record. |
| `deleted_at` | `epoch-ms | null` | no | Opt | Opt | Opt | Opt | **OVERWRITTEN ON IMPORT**. Reset to `null` on import/restore. |

## Storage placement — carried, never applied

| Field | Type | On chip | Filament (142) | Accessories (116) | Spare Part (41) | Resin (173) | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `rack` | `object` | no | Opt | Opt | Opt | Opt | **IGNORED**. Rack placement object. Never inherited on import. |
| `rack_id` | `string` | no | Opt | Opt | Opt | Opt | **IGNORED**. Rack id. Not applied on import. |
| `level` | `uint` | no | Opt | Opt | Opt | Opt | **IGNORED**. Shelf level. Not applied on import. |
| `position` | `uint` | no | Opt | Opt | Opt | Opt | **IGNORED**. Slot position. Not applied on import. |

## Firestore stamps

| Field | Type | On chip | Filament (142) | Accessories (116) | Spare Part (41) | Resin (173) | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `updatedAt` | `epoch-ms` | no | Opt | Opt | Opt | Opt | **OVERWRITTEN ON IMPORT**. Stamped fresh on write. Firestore Timestamps serialise as epoch-ms. |
| `updated_at` | `epoch-ms` | no | Opt | Opt | Opt | Opt | Legacy stamp. |
| `last_update` | `epoch-ms` | no | Opt | Opt | Opt | Opt | Legacy stamp. |
| `needUpdateAt` | `epoch-ms` | no | Opt | Opt | Opt | Opt | Auxiliary stamp. |

---

## Chip data slots — meaning per product type

The seven raw chip slots hold a type-specific payload. Same bytes on the chip, different meaning:

| Slot | Filament (142) | Accessories (116) | Spare Part (41) | Resin (173) |
| --- | --- | --- | --- | --- |
| `data1` | Diameter ID (mm) | — | — | Mixing Time (minute) |
| `data2` | Nozzle Temp Min (°C) | — | — | Work Temp Min (°C) |
| `data3` | Nozzle Temp Max (°C) | — | — | Work Temp Max (°C) |
| `data4` | Dry Temp (°C) | — | — | Curing Temp (°C) |
| `data5` | Dry Time (hours) | — | — | Curing Time (min) |
| `data6` | Bed Temp Min (°C) | — | — | Wash Temp (°C) |
| `data7` | Bed Temp Max (°C) | — | — | Wash Time (min) |

---

## Minimal well-formed record, per type

**Filament (142)** — ratified: `uid`, `id_type`, `id_brand`, `id_material`, `timestamp`, `id_aspect1`, `id_aspect2`, `id_unit`, `measure`, `color_r`, `color_g`, `color_b`, `color_a`, `data1`, `data2`, `data3`, `data4`, `data5`, `data6`, `data7`. Plus `id_tigertag` **only when the record carries a chip** (and it must be absent otherwise).

**Accessories (116)** — draft: `uid`, `id_type`, `id_brand`, `id_material`, `timestamp`, `id_aspect1`, `id_aspect2`, `id_unit`, `measure`, `color_r`, `color_g`, `color_b`, `color_a`, `data1`, `data2`, `data3`, `data4`, `data5`, `data6`, `data7`. Plus `id_tigertag` **only when the record carries a chip** (and it must be absent otherwise).

**Spare Part (41)** — draft: `uid`, `id_type`, `id_brand`, `id_material`, `timestamp`, `id_aspect1`, `id_aspect2`, `id_unit`, `measure`, `color_r`, `color_g`, `color_b`, `color_a`, `data1`, `data2`, `data3`, `data4`, `data5`, `data6`, `data7`. Plus `id_tigertag` **only when the record carries a chip** (and it must be absent otherwise).

**Resin (173)** — draft: `uid`, `id_type`, `id_brand`, `id_material`, `timestamp`, `id_aspect1`, `id_unit`, `measure`, `color_r`, `color_g`, `color_b`, `color_a`, `data2`, `data3`, `data4`, `data5`, `data6`, `data7`. Plus `id_tigertag` **only when the record carries a chip** (and it must be absent otherwise).

Plus a valid envelope for every type: `format`, `kind`, `version`, `records`.

---

## Editing this contract

`playground/ttag-fields-editor/index.html` — standalone page (no deps, no server). Pick a product
type tab, then set each field's type, on-chip and Required / Req-if-chip / Optional / N-A. It regenerates this document:
**Download TTAG-FIELDS.md** and drop it into `docs/`.
