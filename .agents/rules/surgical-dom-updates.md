# Surgical DOM updates

**Rule.** When something changes, update the smallest node that changed; rebuilding a whole panel's `innerHTML` is the last resort.

**Why.** Full rebuilds reload images and video, drop scroll, focus and selection, cancel holds and inline edits, and re-run every wiring — the recurring bug source in this app.

**How.** Cheapest first: (1) guard with a signature of what the render depends on and bail when unchanged (`_rowSignature`, `_detailStructuralSig`); (2) patch text/class/style in place; (3) render the section off-DOM, swap just that node and re-wire only it (split render and wiring: `buildPanelHTML` + `_wireToolbox`); (4) full rebuild only when the structure changed, preserving live media. Keep delegated handlers on the stable parent.
