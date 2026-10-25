# TigerSquad artwork

Slots for the TigerSquad invite window (`_openSquadInvite` in
`renderer/inventory.js`). Until a file exists here, the window draws a local
placeholder (icon + CSS halo) — no broken image.

| File | Use | Size drawn |
|---|---|---|
| `tigersquad-bronze.webp` ✅ | Bronze level badge | 64–72 px |
| `tigersquad-silver.webp` ✅ | Silver level badge | 64–72 px |
| `tigersquad-gold.webp` ✅ | Gold level badge | 64–72 px |
| `tigersquad-platinum.webp` ✅ | Platinum level badge | 64–72 px |
| `tigersquad-coffee.webp` ✅ | coffee illustration on the support card (master: `assets-src/img/tigersquad/tigersquad-coffee.png`) | 56–64 px |

To switch one on: drop the file here, then set its path in `SQUAD_ASSETS`
(same file, next to `_openSquadInvite`) — e.g.
`gold: "../assets/img/tigersquad/tigersquad-gold.webp"`.

The join modal's "What you unlock" tiles reuse each space's own art (rankings scene, deals scene,
a legendary item, the XP history scene, the red envelope); the +150 XP chip uses
`../tigercoins/gift-v2.webp`. (The old perk SVGs were retired with the three perk cards.)
