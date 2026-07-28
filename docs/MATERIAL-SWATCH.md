# The material swatch — Studio's implementation of the convention

> **The convention itself is NOT defined here.** Its canonical home is
> **TigerSystem-Docs → [`docs/developers/material-swatch.md`](https://github.com/TigerTag-Project/TigerSystem-Docs/blob/main/docs/developers/material-swatch.md)**,
> the repo that declares itself the source of truth for the ecosystem. Studio,
> the Hub, the mobile app and any third party all implement *that* page.
> Amend it there first; this file only records how Studio implements it.

## The rule in one line

**Everything is a camembert except a ramp, and every ramp is at 135°.**
Bicolor is not a special case: two equal conic sectors put the boundary on the
vertical axis, so the vertical split is a *consequence* of the pie, guaranteed
on a round swatch, a square tile and a clipped fill bar alike.

## Where it lives in Studio

| | `renderer/inventory.js` |
|---|---|
| The pie | `_pieSplit(colors)` |
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
