# Worklog — v2.47.0

## Added

## Changed
- While the NFC tag tester is open, a scan opens no spool, adds none and offers
  no link — like the "+" card (`_testerUp` next to `_chipCardUp` in
  `renderer/inventory.js`: onRfidForeignChip, onRfid, onRfidTagScanned,
  `_processNfcScans`). The tester reads chips on demand (`readRfidNow`), so it is
  unaffected. Checked with a spool's chip placed twice: nothing opened, 220 → 220
  inventory docs.
- With a single RFID reader, the reader plate still shows its numbered dot ("1"),
  coloured by state as with two readers — in the NFC tools
  (`renderer/rfid_protocol/eraser/index.js` render) and in the burn window
  (`renderer/inventory.js` encode modal plates).
- The "Link to my inventory" grid of the "+" card searches the spools' tags too
  (`text` in `renderer/rfid_protocol/linked/index.js`): a tag "customer" finds
  every eligible spool carrying it. Each search reads the live inventory
  (`eligible()`), so a tag added while the grid is open is found. The grid is
  updated surgically: each card keyed (`data-lc-key`), a card still found is kept
  as it is (photo included), the ones gone removed, the new ones inserted in
  order — typing "testclient" now only removes cards (32 → 15 → 5 → 1), none
  rebuilt; before, every keystroke rebuilt every card and they all blinked.
- A maker's chip (Bambu Lab, Creality…) shows a held "Link the proprietary
  third-party Tag(s)" banner where "Burn the TigerTag+" was: on the catalogue
  product card while such a chip waits in the "+" card (creates the TigerData+
  and links it), and on a TigerData / TigerData+ spool's card when an unlinked
  maker chip sits on the TigerPOD (links it to that spool). `presentMakerChips`,
  `makerLinkBannerHtml`, `linkMakerChipsTo` in
  `renderer/rfid_protocol/linked/index.js`; existing `linkedChipOffer*` keys.
  Every link banner gets the burn banner's shine (green, sweeping glint, glowing
  link icon, burning hold fill): the styles in
  `renderer/rfid_protocol/linked/linked.css` moved from `#lcOfferBanner` to the
  shared `.lc-offer-banner` class.
- Every envelope can be given to a friend, the chips' included. Backend
  (TigerTag_Firebase_Backend `functions/tigerCoins.js`, deployed 2026-10-28, not
  committed): `giveEnvelope` takes `id: "chip"` — the giver's oldest unopened
  certified chip is marked `givenTo` / `givenAt` (`unopenedChip` now excludes it
  from `unopened` and from `open`), the friend gets a kind "friend" envelope
  worth one standard surprise envelope (`surpriseWeights` snapshot, `chipUid`);
  README updated. Studio (`renderer/inventory.js`): `_giveEnvelopeTo` and the
  pile's "Give to a friend" offer the gift envelopes first, then the chips'
  (`{ id: "chip" }`); the pile's count includes `unopened`.
- The give window always opens for a TigerSquad member, with the day's count
  ("Sent today · Left", new key `envGiveCount`, `.tc-give-count` in
  `renderer/quests/quests.css`); with nothing left to give it says why
  (`envGiveNoGift`) and the friends are greyed (`give.none` in
  `renderer/quests/squad-deals.js` showGive).

- The inventory search finds a spool by the UID of a maker chip linked to it
  (Bambu Lab, Creality…), whole or partial, any case (`_rowChipUids` in
  `renderer/inventory.js`, used by `_rowIsExactCode` and `_rowMatchesSearch`;
  read live, outside the cached haystack, since a link changes without the row).

- A TigerData / TigerData+ spool whose maker chips are linked no longer offers
  "Burn the TigerTag+" on its card (nothing to burn: its chips are a maker's);
  a plain TigerData still offers its upgrade (`renderer/inventory.js` detail
  chip banner, `linkedChipsOf`).
- "+" with unlinked maker chips already on the TigerPOD opens the maker-chip
  choices, as when a chip is placed while the card is up: the catalogue then
  offers "Link", not the burn (`openAddChooser` in
  `renderer/rfid_protocol/linked/index.js`).

- "Add product" (manual) says what Make will do with the TigerPOD: unlinked
  maker chips on it → the held "Link the proprietary third-party Tag(s)" banner
  (creates the TigerData, then links them; never burned); a reader plugged in →
  the held "Burn the TigerTag" banner (creates, then burns); no reader → the
  plain Make. Re-drawn as chips come and go (`_adpRenderFoot`, `#adpFootBanner`
  in `renderer/inventory.html`, `.adp-foot-banner` in
  `renderer/css/60-modals.css`; `saveAddProduct` / `_openCreatedSpool` /
  `_catalogCreate` take `linkMakers`). The catalogue product card offers "Link"
  as well when the maker chips simply sit on the TigerPOD
  (`pendingMakerChips() || presentMakerChips()`). Before, chips placed while
  "Add product" was open were ignored and Make went on to the burn.

- The held Link / Burn banners follow what sits on the TigerPOD NOW: chips
  swapped while the new-chip card is up replace the earlier ones, they are not
  added to them, and the open view stays as it is (no jump back to the
  catalogue). A maker's chip → "Link", a blank NTAG → "Burn", on the spool card
  (its banner slot `.dp-chip-banner` swapped alone), the catalogue product card
  and "Add product" (`_refreshChipBanners` in `renderer/inventory.js`, called on
  card-present / foreign-chip, `ctx.chipsChanged` from
  `renderer/rfid_protocol/linked/index.js`). `pending` / `offer` no longer store
  a chip list: the link takes `presentMakerChips()` at the moment of the hold.
  A Link and a Burn banner are the same height (69 px): the link icon sits in
  the burn logo's 52 px box (`.lc-offer-ic` in
  `renderer/rfid_protocol/linked/linked.css`).

- While the new-chip card ("What would you like to do?") is up, a spool card
  offers no "Upgrade to TigerData+ / TigerTag+": there it is being linked or
  burned (`offerUpgrade` in the detail chip banner, `renderer/inventory.js`);
  closing the card gives the offer back (`closeChipChoice` → `chipsChanged`),
  and it opens the catalogue at once: its click is wired with the other chip
  banners (`_wireDetailChipBanner`), so a banner swapped in place works too.

- The catalogue pick card ("Add from the catalogue") has a mini copy of the
  colour bars under its search, with its OWN colour window
  (`state.cpkHueFilter`, `_cpkHueFilter`): it filters the pick list only, the
  views' bars filter the views only. Drag, wheel, double-click work the same:
  `wireRangeBar` now takes a group (`hueGroup`: one window, its bars, what to
  refresh), and `_hueFilterOn` / `_colorsMatchHue` / `_catalogFilter` take the
  window to test. Markup
  `.cpk-hue` in `renderer/inventory.html`, 14 px bars in
  `renderer/css/40-printers.css`.

- The TigerCoins envelope (how many wait) and gift sit in the header, always in
  sight for a TigerSquad member — the Deals banner's pair, smaller: the
  envelope opens the pile (Deals view + opening stage) or, at 0, the "how to
  get envelopes" help; the gift opens the gift-code window (`#topCoins` in
  `renderer/inventory.html`, painted by `_paintDealsBadge`, `_topCoinsCtx` in
  `renderer/inventory.js`; `openEnvelopeHelp` / `openCoinsCodeModal` exported
  from `renderer/quests/squad-deals.js`; `.top-coins` in
  `renderer/quests/quests.css`). The balance card (opens the TigerCoins
  history, `openCoinsHistory` exported) sits on top, envelope + gift under it,
  stacked like the Deals banner (`#topCoinsBal`, `.top-coins-acts`). In the
  header they are toned down to one flat card like the stat cards (no glow,
  no animation); the Deals banner keeps its animated pair. Each of the three
  switches to the Deals view, then opens its window there (`_toDeals`).
- The header's stat cards are taller (68 px, `--top-card-h`, centred content —
  `.top-stats .sb-stat` in `renderer/css/00-base.css`), the TigerCoins card
  the same height, its content centred (the gift button pinned to 22 px).
- New easter egg `codeEnvelope`: three quick clicks on the red envelope beside
  the tiger in the "Gift code" window (`tapEgg` + glints in
  `renderer/quests/squad-deals.js` openCoinsCodeModal, `.tcx-pile-env` in
  `renderer/quests/quests.css`); backend `EGGS.codeEnvelope`
  (TigerTag_Firebase_Backend `functions/tigerCoins.js`, deployed 2026-10-29,
  not committed);
  listed in `.agents/rules/easter-eggs.md`.

- Opening a deal closes every other side card first (settings, notifications,
  spool card…), so its own card shows alone; a deal opening over another still
  slides over it (`ctx.closeOtherSides` → `_closeAllSidePanels({ keepDeals })`
  in `renderer/inventory.js`, called from the deal click in
  `renderer/quests/squad-deals.js`).

- A click on the coin above the TigerCoins history flips it (three turns,
  1.1 s) to the sound of a spinning coin — a metallic ping, then ticks
  slowing down (`sfx.coinFlip` in `renderer/quests/coin-sound.js`,
  synthesised, muted with the other TigerCoins sounds) — and throws nine
  little gold stars around it
  (`.tch-coin` / `tch-coin-flip`, `.tch-coin-star` in `renderer/quests/quests.css`,
  `openCoinsHistory` in `renderer/quests/squad-deals.js`).

- The decorative brand column of the "+" card says what it is for: a small
  "Works with" caption on top (the app works with these printers and their
  spools' own tags) — `.lc-brands-cap` in `renderer/inventory.html` and
  `renderer/rfid_protocol/linked/linked.css`; a smaller size for the
  languages with longer words (`:lang(fr|es|it|pt|ru)`) so every word fits the
  52 px column whole.

## Fixed
- The TigerCoins history says which way each line went, after a mockup made
  with ChatGPT (`assets-src/img/tigercoins/coin-history-mockup.png`): an
  envelope received gets a green bar, an arrow into the envelope, the friend's
  avatar, "From {name}" and "+1" with an envelope; one given a red bar, an
  arrow out, "To {name}" and "−1"; coins earned a gold bar and "+53" with a
  coin; coins spent a red bar (`openCoinsHistory` in
  `renderer/quests/squad-deals.js`, `ctx.friendAvatar` in `renderer/inventory.js`,
  `.tch-row--in/out/coin` in `renderer/quests/quests.css`; the friend drawn
  by `userAvatar(f, "sqb-avatar")` as in the League ranking — the row's icon
  rule narrowed to `.tch-row > img`, it had blown the badge up to 30 px). Before,
  both envelope lines read "—".
- The TigerCoins history window opens at its final size: its list has a fixed
  height, the app's loading animation centred in it (`loadingHTML` now on the
  header's ctx too, `_topCoinsCtx` — it showed "…"), instead of growing once the log arrives
  (`.tch-log` in `renderer/quests/quests.css`).
- The TigerCoins history shows "0", not "−0" / "+0", when nothing was spent or
  earned (`openCoinsHistory` in `renderer/quests/squad-deals.js`).
- Deleting a spool now deletes its maker chips' links too (`markSpoolDeleted`,
  same batch, `linkedChipsOf` covers the twin); a link left behind pointed at a
  missing spool and kept the chip "already linked". A link to a spool that no
  longer exists no longer blocks the chip from being linked again
  (`presentMakerChips`).
- A maker's chip (Bambu Lab, Creality… MIFARE 1K) placed while the "+" card is
  up is no longer ignored: the card switches to the maker-chip choices and the
  chip waits there, so "+ Inventory" creates the TigerData+ and links it — nothing
  opens, nothing is added, nothing is written (`holdForeignChip`,
  `pendingMakerChips` in `renderer/rfid_protocol/linked/index.js`; called from
  `onRfidForeignChip` in `renderer/inventory.js`). A chip already linked to a
  spool is left alone there. While such a chip waits, the catalogue product card
  offers no "Burn the TigerTag+" (a maker's chip is linked, never written).
  Checked with a Bambu Lab spool: both MIFARE chips linked to the new TigerData+.

## Removed

## i18n
- `envGiveCount` (11 locales).
- `linkedChipWorksWith` (11 locales).
- `coinLog_to`, `coinLog_from` added; `coinLog_given`, `coinLog_received`
  removed (11 locales).
