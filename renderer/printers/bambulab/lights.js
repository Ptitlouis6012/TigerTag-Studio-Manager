/**
 * printers/bambulab/lights.js — the chamber lights of a Bambu Lab printer.
 * Pure functions (no DOM, no socket, no `ctx`).
 *
 * The H2S, H2D, H2D Pro, H2C and X2D have TWO chamber light strips, each its own
 * `ledctrl` node: `chamber_light` and `chamber_light2`. A button that only
 * addresses `chamber_light` switches one strip and leaves the other. The
 * ha-bambulab integration (MIT) drives both and reads the light as "on" when
 * either is on; the node names are protocol facts, not code taken from it. NOT
 * yet seen on a real H2: reported on an H2C. The `heatbed_light` of those
 * printers is another switch and is not driven here.
 */

export const CHAMBER_LIGHT = 'chamber_light';
export const CHAMBER_LIGHT_2 = 'chamber_light2';

// TigerTag catalogue ids (bbl_printer_models.json): H2S 7, H2D 8, H2D Pro 9, H2C 11, X2D 12.
const TWO_CHAMBER_LIGHTS = new Set([7, 8, 9, 11, 12]);

/**
 * The `ledctrl` nodes the light button drives. Two chamber lights for the models
 * above — or for any printer whose own report names `chamber_light2` — else one.
 */
export function bambuChamberLightNodes(modelId, reportedNodes = []) {
  const reported = Array.isArray(reportedNodes) ? reportedNodes : [];
  const two = TWO_CHAMBER_LIGHTS.has(Number(modelId)) || reported.includes(CHAMBER_LIGHT_2);
  return two ? [CHAMBER_LIGHT, CHAMBER_LIGHT_2] : [CHAMBER_LIGHT];
}

/**
 * What each light last said: `{ [node]: mode }`. A push may name only some of the
 * lights, so each push is merged into what was known rather than replacing it.
 */
export function bambuMergeLights(known, report) {
  const modes = { ...(known && typeof known === 'object' ? known : {}) };
  if (Array.isArray(report)) {
    for (const l of report) {
      if (l && typeof l.node === 'string' && typeof l.mode === 'string') modes[l.node] = l.mode;
    }
  }
  return modes;
}

/**
 * Is "the light" on? On when either chamber light is; a printer with neither
 * (the A1's toolhead light) follows the first light it reported. `null` when it
 * has reported nothing.
 */
export function bambuLightOn(modes) {
  const m = modes && typeof modes === 'object' ? modes : {};
  const chamber = [CHAMBER_LIGHT, CHAMBER_LIGHT_2].filter(n => n in m);
  const names = chamber.length ? chamber : Object.keys(m).slice(0, 1);
  return names.length ? names.some(n => m[n] === 'on') : null;
}
