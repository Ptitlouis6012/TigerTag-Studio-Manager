# Material swatch

**Rule.** The material swatch convention is owned by TigerSystem-Docs (`docs/developers/material-swatch.md`); Studio draws every swatch through `colorBg()` / `_pieSplit()` / `RAMP_ANGLE` in `renderer/inventory.js` and never open-codes a gradient.

**Why.** An open-coded gradient in the Add-Product preview drew bicolors mirrored relative to the inventory.

**How.** Amend the convention in TigerSystem-Docs first, then re-align Studio. Check any change against `playground/material-swatch/index.html`. Details: `docs/MATERIAL-SWATCH.md`.
