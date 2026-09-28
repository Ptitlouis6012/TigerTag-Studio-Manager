# The material swatch — Studio's implementation of the convention

> **The convention itself is NOT defined here.** Its canonical home is
> **TigerSystem-Docs → [`docs/developers/material-swatch.md`](https://github.com/TigerTag-Project/TigerSystem-Docs/blob/main/docs/developers/material-swatch.md)**,
> the repo that declares itself the source of truth for the ecosystem. Studio,
> the Hub, the mobile app and any third party all implement *that* page.
> Amend it there first; this file only records how Studio implements it.

## The rule in one line

**A Tricolor aspect is a smooth conic sweep (`_conicSweep`, unless it is also Rainbow); other two or three colours make a 135° soft split (solid colours, 20 % blended seam — `SPLIT_BLEND`), four or more make a camembert, smooth
colours make a 135° ramp** (convention v1.2). Bicolor and tricolor blend along
the one axis of the system, first colour top-left — on a round swatch, a square
tile, a clipped fill bar and the colour frame round a photo alike. (v1.0 split
bicolor vertically, v1.1 on a hard diagonal with tricolor as a camembert; on the
colour frame round product photos a hard edge still read as separate bars.)

## Where it lives in Studio

| | `renderer/inventory.js` |
|---|---|
| The colour-list split (2-3 → ramp, 4+ → pie) | `_pieSplit(colors)` |
| The ramp angle | `RAMP_ANGLE` (`135deg`) |
| The decision ladder | `colorBg(row)` |
| Watermark variant | `isColorDark(bg)` → `logoSrc(bg)` |

**Never open-code a gradient anywhere else.** The Add-Product preview
(`_adpUpdateCircle`) is the cautionary tale: it drew its own 50/50 linear split
for a bicolor while `colorBg` drew a 180°/180° conic — the same vertical line
*mirrored*, so a spool swapped sides between the preview and Save. It now calls
the shared helpers, and so must anything new.

## Checking a change

`playground/material-swatch/index.html` — open it in a browser, no server. It is
the **conformance harness**: it links the *shipped* stylesheets and copies the
branch logic verbatim, then crosses all 17 colour cases with the 11 surfaces
that paint a spool, each at its real size, with live colour pickers. If a
change to `colorBg` breaks a surface, it shows there.

Do not confuse it with the reference renderer in TigerSystem-Docs
(`docs/developers/material-swatch-playground.html`): that one is self-contained and shows
the *convention* on abstract box shapes, for implementers outside Studio. This
one proves *Studio* obeys it.

## Studio-specific gaps

Tracked here rather than in the convention, because they are ours:

- **Aspect matching by label.** `colorBg` substring-matches the aspect *label*
  (`bicolor` / `bicolore` / `tricolor` / `rainbow` / …) instead of the ids
  `252` / `24` / `145`. It works because the reference table is English, but it
  breaks the moment a label is translated. The convention says to match on the
  id, and `assets/db/tigertag/id_aspect.json` even carries an authoritative
  `color_count` per aspect.
- **Rack fill bar.** In the rack "fill" view the colour is painted inside a
  partial-height box, so the pie re-centres with the fill level: the same spool
  draws a slightly different picture at 30 % and at 90 %.
- **`color_a` is ignored.** Transparent filaments render opaque; the `Clear`
  and `Translucent` aspects are not reflected in the colour.
