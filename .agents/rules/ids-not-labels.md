# Conditions key on IDs, never on labels

**Rule.** Any condition, filter, sort key or branch on a reference value (`id_aspect`, `id_brand`, `id_material`, `id_type`, `id_diameter`, `id_measure_unit`, `id_version`) compares the numeric ID, never its label text.

**Why.** A label is translated display copy and can be renamed in the reference DB; `colorBg` once matched `'bicolor'` in label strings.

**How.** Carry the ID on the row next to the label (`aspect1Id` / `aspect2Id`), name the IDs you branch on in a constant map (`ASPECT_ID = { TRICOLOR: 24, RAINBOW: 145, BICOLOR: 252 }`), and use labels for rendering only. Applies to filters, imports, validators, playgrounds and doc examples.
