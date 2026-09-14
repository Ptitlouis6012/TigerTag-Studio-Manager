/**
 * printers/creality/material-frame.js — builds the `modifyMaterial` frame sent
 * to a Creality printer over the WebSocket on port 9999.
 *
 * Pure: no DOM, no ctx, no connection. It turns the slot fields into the exact
 * TEXT that goes on the wire, so what Tiger Studio sends can be produced and
 * checked outside the app.
 *
 * WHY THIS EXISTS — the firmware reads temperatures by their JSON text, not by
 * their value. `minTemp` / `maxTemp` are kept only when the number is written
 * WITH a decimal point. Measured on an Ender-3 V4 + CFS, same frame on the same
 * slot, read back with {"method":"get","params":{"boxsInfo":1}}:
 *
 *     sent  "minTemp":215.0,"maxTemp":230.0   →  read back 215 / 230
 *     sent  "minTemp":216,  "maxTemp":231     →  read back   0 / 0
 *     sent  "minTemp":217.0,"maxTemp":232.0   →  read back 217 / 232
 *
 * JavaScript cannot express that difference: 190 and 190.0 are the same Number,
 * so JSON.stringify always writes "minTemp":190 and the firmware silently drops
 * it. The mobile app never hit this because Dart serialises a double as 190.0.
 * The float fields are therefore written as text here, explicitly.
 *
 * `pressure` is kept by the firmware either way; it is written the same way
 * for consistency, since the protocol types all three as floats. No other
 * numeric field is touched — id, boxId, selected, percent, editStatus and state
 * are integers and must stay integers.
 */

// The three fields the firmware types as floats.
const FLOAT_FIELDS = ["minTemp", "maxTemp", "pressure"];

/**
 * A number as JSON text that always carries a decimal point.
 * 190 → "190.0", 0.04 → "0.04", 215.5 → "215.5".
 * Exponent notation ("1e-7") has no decimal point either, so it is expanded.
 */
export function creFloatLiteral(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0.0";
  if (Number.isInteger(n)) return n.toFixed(1);
  let text = String(n);
  if (/e/i.test(text)) text = n.toFixed(20).replace(/0+$/, "").replace(/\.$/, ".0");
  return text;
}

/**
 * The full `modifyMaterial` frame as a string, ready for ws.send().
 *
 * The float fields are swapped for unique placeholder strings before
 * JSON.stringify runs, then the quoted placeholders are replaced by the
 * decimal literals. Everything else — escaping of vendor / name / colour
 * included — is still done by JSON.stringify, so no field is hand-serialised
 * except the three that must be.
 */
export function buildModifyMaterialFrame(fields) {
  const slot = { ...fields };
  const literals = new Map();
  FLOAT_FIELDS.forEach((key, i) => {
    if (!(key in slot)) return;
    const token = `__CRE_FLOAT_${i}__`;
    literals.set(`"${token}"`, creFloatLiteral(slot[key]));
    slot[key] = token;
  });
  let text = JSON.stringify({ method: "set", params: { modifyMaterial: slot } });
  for (const [quoted, literal] of literals) text = text.replace(quoted, literal);
  return text;
}

/* ── Which material to declare ─────────────────────────────────────────────
   Measured on an Ender-3 V4 + CFS, the firmware applies two more rules to a
   `modifyMaterial` frame, both silently:

   1. `type` is the material FAMILY — `material_type`, plus "-" + `filled_type`
      when set ("PLA", "ABS-CF"). A marketing label such as "PLA High Speed" is
      not a type.
   2. `rfid` survives only when `vendor` + `type` + `name` match EXACTLY one of
      the printer's own material profiles (the `retMaterials` reply to
      {"method":"get","params":{"reqMaterials":1}} — 18 of them on that model).
      `00001` + PLA + Generic + "Generic PLA" is kept; the same with vendor R3D
      is reset to "0".

   So the four identity fields are not composed freely: they are looked up in
   the printer's library, and taken from it verbatim when a profile fits. When
   none does, `rfid` is sent as "0" on purpose — an id the firmware is about to
   discard anyway would only make the frame look more certain than it is. */

/**
 * The printer's material library, reduced to what identity matching needs.
 * `retMaterials` is an array of { base: { id, brand, name, meterialType, … } }
 * — `meterialType` is Creality's own spelling.
 */
export function creParseMaterialLibrary(retMaterials) {
  const list = Array.isArray(retMaterials) ? retMaterials : (retMaterials?.list ?? []);
  return list
    .map(entry => entry?.base ?? entry)
    .filter(b => b && b.id != null)
    .map(b => ({
      id:     String(b.id),
      vendor: String(b.brand ?? b.vendor ?? ""),
      type:   String(b.meterialType ?? b.materialType ?? b.type ?? ""),
      name:   String(b.name ?? ""),
    }));
}

/** The family the firmware expects in `type`, from an id_material.json record. */
export function creMaterialFamily(dbRecord, fallback = "") {
  const base = String(dbRecord?.material_type ?? "").trim();
  if (!base) return fallback;
  const filled = String(dbRecord?.filled_type ?? "").trim();
  return filled ? `${base}-${filled}` : base;
}

/**
 * The identity fields to send for a material the user picked.
 *
 *   vendor   — the vendor chosen in the picker
 *   label    — the material label chosen ("PLA High Speed"), used only when the
 *              database has no record to derive a family from
 *   dbRecord — the id_material.json record for that label (may be null)
 *   library  — creParseMaterialLibrary() output, or null if not received yet
 *
 * Returns { rfid, type, vendor, name, match } where `match` says how it was
 * resolved: "id" (the database's Creality id is a profile of this vendor),
 * "family" (the vendor's plain "<vendor> <family>" profile), "name" (a profile
 * with that exact name and family under another brand), "none" (no
 * profile fits — rfid "0"), or "no-library" (library not received — best
 * effort, the firmware decides).
 */
export function resolveCrealityMaterial({ vendor, label = "", dbRecord = null, library = null }) {
  const family = creMaterialFamily(dbRecord, label);
  const dbId   = dbRecord?.metadata?.crealityID != null ? String(dbRecord.metadata.crealityID) : null;
  const plainName = `${vendor} ${family}`;

  if (!Array.isArray(library) || library.length === 0) {
    return { rfid: dbId ?? "0", type: family, vendor, name: plainName, match: "no-library" };
  }
  const byId     = dbId ? library.find(p => p.id === dbId && p.vendor === vendor) : null;
  const byFamily = library.find(p => p.vendor === vendor && p.type === family && p.name === plainName);
  // A product line filed under another brand: "Hyper PLA" is a profile of
  // brand Creality, while the picker offers "Hyper" as a vendor of its own. The
  // name + family still identify it exactly, and the firmware wants the
  // profile's own brand as `vendor`.
  const byName   = library.find(p => p.name === plainName && p.type === family);
  const profile  = byId ?? byFamily ?? byName;
  if (profile) {
    return { rfid: profile.id, type: profile.type, vendor: profile.vendor, name: profile.name,
             match: byId ? "id" : byFamily ? "family" : "name" };
  }
  return { rfid: "0", type: family, vendor, name: plainName, match: "none" };
}
