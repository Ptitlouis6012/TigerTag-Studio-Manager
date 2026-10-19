# `.ttag` field contract

**Rule.** The `.ttag` field contract is authored in `playground/ttag-fields-editor/index.html` and exported to `docs/TTAG-FIELDS.md`; never hand-edit that doc and never change the importer's contract on your own initiative.

**Why.** The contract is ratified by the founder per product type; the code follows the contract, not the reverse.

**How.** When a new `TTAG-FIELDS.md` arrives: re-align the importer validation (`_ttagRecordValid`, `_ttagMaterialValid`, `TTAG_REQUIRED_NUM` in `renderer/inventory.js`) keeping refuse-and-count, drop the file in, then propagate to TigerSystem-Docs and the mobile app. The importer accepts only `id_type == 142` (Filament) today.
