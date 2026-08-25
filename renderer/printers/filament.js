/**
 * printers/filament.js — one spool, six machines.
 *
 * Turns a TigerTag spool into the values a printer can be TOLD. Every brand
 * wants something different — Bambu insists on an id from its own catalogue and
 * refuses anything else, Creality wants an id AND strings, Snapmaker and
 * FlashForge want strings only, Anycubic wants a colour as three integers — so
 * the translation is resolved ONCE here and each brand takes what it needs.
 *
 * Written from the behaviour of the mobile app (Tiger NFC Connect), which has
 * been doing this on real hardware for a long time, but not from its code: the
 * mobile's newer driver layer has regressed against its own older per-brand
 * screens in three places, and its bundled catalogue is a truncated copy of the
 * one this repo already ships complete. The rules below are the proven ones.
 *
 * TWO RULES CARRY EVERYTHING:
 *
 *  1. NEVER REFUSE. A machine that has never heard of R3D can still be told
 *     "Generic PLA" in the right colour at the right temperature, and that is a
 *     far better answer than a spool the user assigned and nothing happening.
 *     Only the IDENTITY is lossy; colour and temperature always travel intact.
 *
 *  2. TEMPERATURES COME FROM THE CATALOGUE, never from the chip. The chip
 *     carries its own temperature bytes and they are deliberately ignored —
 *     mobile ignores them too, and if the two apps disagreed here they would set
 *     different temperatures for the same spool on the same printer.
 */

/* Bambu's Generic PLA. The one value that is always accepted, used whenever the
   material has no id of its own — 33 of the catalogue's 113 entries have none
   (PEEK, PA12, TPE, POM, PEI…), so this is a normal path, not an error path. */
export const BAMBU_GENERIC = "GFA00";
/* Creality's "no id" sentinel. Not a real id — it tells the machine to keep the
   strings and skip the catalogue lookup. */
export const CREALITY_NO_ID = "0";
/* Used only when the material is unknown to the catalogue AND to the brand.
   Deliberately narrow: a wrong temperature damages a print, so the fallback is
   the range that is safe for the material every machine can do. */
export const FALLBACK_TEMP = { min: 190, max: 220 };
/* Creality's flow tuning. Only ever meaningful for materials the catalogue has
   measured; everything else gets the value Creality itself defaults to. */
export const CREALITY_DEFAULT_PRESSURE = 0.04;

const clean = v => (typeof v === "string" ? v.trim() : "");
/* A material the catalogue does not know still has a name, and that name is
   usually a real material — but not always. Mobile sends whatever it holds, so
   an id it cannot resolve reaches the printer as the literal material type
   "Unknown Material": a sentence, in the field a machine parses. Anything that
   does not LOOK like a material token is refused here and becomes Generic PLA;
   a plausible one (`PLA`, `PEI-1010`, `PLA+`) is passed through, because a
   catalogue that lags behind a new filament should not flatten it. */
const FAMILY_RE = /^[A-Za-z][A-Za-z0-9]*(?:[-+][A-Za-z0-9]+)*\+?$/;
const plausibleFamily = v => {
  const s = clean(v).toUpperCase();
  return (s.length <= 12 && FAMILY_RE.test(s)) ? s : "";
};
/* Machines are told a vendor as a bare token. Snapmaker's G-code and Elegoo's
   MQTT both break on a space, so the space goes rather than the name. */
const token = v => clean(v).replace(/\s+/g, "");

/**
 * @param {object} row  a normalized inventory row (`normalizeRow` output)
 * @returns {object} everything any brand could need, already defaulted
 */
export function resolveFilament(row) {
  const mat = row?.materialData || null;
  const meta = mat?.metadata || {};
  const rec = mat?.recommended || {};

  /* The FAMILY, not the label. "PLA-CF" is a PLA that happens to be carbon
     filled, and a machine told `PLA-CF` as its material type will reject it
     where `PLA` + a `CF` sub-type is understood. The catalogue splits the two
     for us; the label is only a fallback for an entry that predates the split. */
  const family = clean(mat?.material_type) || plausibleFamily(row?.material) || "PLA";
  const filled = clean(mat?.filled_type) || null;
  const label = clean(mat?.label) || clean(row?.material) || family;

  /* The brand as printed on the spool, or the word every machine accepts. An
     empty vendor is not sent as an empty string — several firmwares treat that
     as a malformed field rather than as "unspecified". */
  const vendorRaw = clean(row?.brand);
  const vendor = vendorRaw && vendorRaw !== "-" ? vendorRaw : "Generic";

  const colorHex = (clean(row?.colorHex).replace("#", "").toUpperCase() || "FFFFFF").slice(0, 6);

  const tempMin = Number.isFinite(rec.nozzleTempMin) ? rec.nozzleTempMin : FALLBACK_TEMP.min;
  const tempMax = Number.isFinite(rec.nozzleTempMax) ? rec.nozzleTempMax : FALLBACK_TEMP.max;

  return {
    vendor,
    vendorToken: token(vendor) || "Generic",
    family,
    filled,
    label,
    subType: filled || clean(row?.aspect1) || null,
    colorHex,
    tempMin,
    tempMax,

    /* Bambu — `tray_info_idx`. Resolved from the catalogue, falling back to
       Generic PLA. A product-level id from a TigerTag+ scan would take priority
       over both; Studio does not store one on the row yet, and this is where it
       plugs in when it does. */
    bambuId: clean(meta.bambuID) || BAMBU_GENERIC,
    /* Bambu — `tray_type`. The family and the fill, joined the way Bambu writes
       it. Falls back to the plain family rather than to the label, because the
       label is exactly the composed form Bambu would reject. */
    bambuTrayType: filled ? `${family}-${filled}` : family,

    /* Creality — `rfid`. Its own catalogue id, or the sentinel. */
    crealityId: clean(meta.crealityID) || CREALITY_NO_ID,
    crealityPressure: Number.isFinite(meta.crealityPressureAdvance)
      ? meta.crealityPressureAdvance : CREALITY_DEFAULT_PRESSURE,

    /* True when the machine will be told a real identity rather than a Generic
       stand-in. The UI owes the user this: an assignment that lands as "Generic
       PLA" is a success, but not the same success. */
    exact: !!clean(meta.bambuID),
  };
}

/* ── Colour, formatted per brand ──────────────────────────────────────────────
   Six machines, five formats, and none of them tolerant. Kept here so a brand
   never open-codes one and drifts. */
export const color = {
  /** Bambu `tray_color`, Snapmaker `FILAMENT_COLOR_RGBA` — RRGGBBAA. */
  rgba: (hex, alpha = "FF") => `${hex}${alpha}`.toUpperCase().slice(0, 8),
  /** Elegoo, FlashForge — RRGGBB, no hash. */
  rgb: hex => hex.toUpperCase().slice(0, 6),
  /** Elegoo's proven form carries the hash; its newer driver drops it. */
  hashed: hex => `#${hex.toUpperCase().slice(0, 6)}`,
  /** Creality — seven hex digits, lowercase. Not a typo: `#0` then RRGGBB. */
  creality: hex => `#0${hex.toLowerCase().slice(0, 6)}`,
  /** Anycubic — three integers. Pure black is nudged, because an ACE renders
      `0,0,0` as transparent and the slot would look empty. */
  rgbArray: hex => {
    const n = parseInt(hex.slice(0, 6), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    return c.every(v => v === 0) ? [1, 1, 1] : c;
  },
};
