# Worklog — v2.33.1 (in progress)

## Added
- Catalogue (Search views) multi-select: tick products in the table column, or via Select in the grid (shift-click for a range), then ★ Favorite / 🛒 To order / Add to a list the whole selection from the shared bulk bar (with a "N picked" count; no tags / delete there). Each item's product detail is fetched once through the product-card cache, six at a time, prefetched as you tick; one action is capped at 200 products — `renderer/inventory.js` (`state.selectedCatalog`, `_bulkCtx` catalogue context, `_catResolveRow(s)`, `_catBulkClick`), `renderer/inventory.html`, `renderer/css/70-detail-misc.css`
- Bulk "Add to a list" button in the bulk bar for materials, the Favorites table and the catalogue; the list popup now takes several products at once (ticked when the list already holds them all; one arrayUnion / arrayRemove write) — `renderer/inventory.js` (`_addManyToList`, `_openAddToListMenu`), `renderer/inventory.html`, `renderer/css/70-detail-misc.css`

## Changed
- Product videos play inside the card (spool detail + product card, incl. the catalogue): YouTube (watch / youtu.be / shorts / embed / live) and Google Drive links now show a poster that turns into an in-app player on click, instead of opening the browser or only listing a link; MP4 files keep playing inline. Playable videos added as product web-link attachments get the same player (deduped against the chip's own video) instead of a plain link. Both cards draw every video through one entry point `_productVideosHTML` → `_videoSectionHTML`, and the attachment "video" icon uses the same detection (`_isPlayableVideo`) — `renderer/inventory.js`, `renderer/css/70-detail-misc.css`

## Fixed
- "+ Material" from a product (product card, Reorder card, grouped-spools card, spool detail) now offers the guided chip burn when a reader (TigerPOD / ACR122U) is plugged in, like the manual and catalogue add paths already did — `renderer/inventory.js` (`_createCloudFromProduct`, `_offerBurnForCreated`)

## Removed

## i18n
- Added: `bulkSelectedCount`, `catBulkTooMany` — 11 locales
