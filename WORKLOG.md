# Worklog — v2.48.0

## Added
- Product mockup assets, each usable alone or assembled (`assets/img/mockups/*.webp`,
  masters in `assets-src/img/mockups/`): `tigerpod-mini` (the blue TigerPOD Mini
  cut out from the RFID-Guide photo; the clear spool flanges are
  translucent, not milky with the photo's white background, and the white
  left in the base's gaps is gone), `studio-screen` (a Studio capture, 1920×1018),
  `imac-frame` (an empty desktop iMac, black bezel, silver chin, no logo, transparent screen) and
  `imac-studio` (the capture pasted in, pixel-exact), `iphone-frame` (an empty
  iPhone, transparent screen) and `iphone-connect` (the Tiger NFC Connect home
  screen pasted in). Only the empty device frames were AI-generated (`*-source.png`);
  the screenshots are composited locally so no UI is redrawn.
  `tigerscale` (the TigerScale V3 render, flanges made translucent, cropped).
  `tigerspool` (a TigerSpool render made from TigerSystem-Docs' photo with
  the TigerScale render's spool, so the three devices carry the same spool;
  transparent, flanges made translucent like the TigerPOD's and the
  TigerScale's, cropped; generated original `tigerspool-source.png`).
  `tigertouch-tour` (the TigerTouch repo's animated three-quarter view,
  `assets/mockups/animated/angle/panda-touch-angle-tour.webp`, unchanged).
  `hero-ecosystem` (1120×580, master also `-transparent` and `-transparent-2x`): the three assembled on the email's light grey —
  iMac with Studio, TigerPOD Mini front left, iPhone front right, soft floor
  shadows — composited locally from those assets (recomposed with the
  re-cut TigerPOD, same placements), at true relative scale (one
  px/cm from the 24-inch iMac's 46.1 cm; TigerPOD Mini with a 1 kg spool
  ≈ 25.6 cm); the iPhone, front view, brought to the foreground (larger).

## Changed
- The app is now shown as **Tiger Studio Manager 2** (window title in
  `main.js` and `renderer/inventory.html`, sidebar brand "Studio Manager 2");
  `productName`, the auto-update feed and the user-data folder are unchanged.
- Signed-out welcome screen redone as a page of its own: a top bar with the
  name ("2" in the accent colour) and a compact language select (the 11
  languages in their own language, applied at once, kept in `tigertag.lang` —
  `#signinLangs`, `_paintSigninLangs`, `_syncSignedOutLook` in
  `renderer/inventory.js`); on the left a "New generation" badge, a headline, a
  subline, four benefits (bold claim + plain fact; on a very short window
  the claim only) — the fourth, maker deals: TigerSquad prices and vouchers
  earned with TigerCoins, "Create my account"
  (opens the sign-in dialog in create mode — `openAddAccountModal(mode)`) and
  "I already have an account", and "No TigerPOD needed to get started"; on the
  right the ecosystem hero as three separate layers (`imac-studio`,
  `tigerpod-mini`, `iphone-connect` on a stage with the hero's proportions),
  each floating gently on its own rhythm above a floor shadow that tightens as
  it rises (`.sph-*`) — the iMac and the iPhone; the TigerPOD Mini stands on
  the desk (no float, no shadow) and turns over into a TigerScale, then a
  TigerSpool, and back, each held ~4 s, the three images laid so their spools
  coincide (matched on the red filament) and turning around the spool hub
  (`.sph-face`); the Tiger
  Touch (a Panda Touch at true scale, its screen animated: start-up, list,
  cards — `tigertouch-tour.webp`, its two stand feet clipped off along the
  case's bottom edge) floats in front of the iMac (`.sph-touch`); and under it "Works with" + the printer brand logos (up to 40 px)
  (Bambu Lab, Creality, Prusa, Elegoo, Anycubic, FlashForge, Snapmaker,
  Klipper, OctoPrint — the chip chooser's `.lc-brand` logos), lit in their own
  colour one after the other like a garland, then a rest, again, and under the
  mouse (`_signinGarland` in `renderer/inventory.js`); a quiet footer "Free · Open source",
  GitHub, "Need a paw?" (Discord). Copy and hero rise in under half a second
  (none with reduced motion); fits the 900×600 minimum window without
  scrolling. While signed out the app header and the inventory view bar are
  hidden (`body.signed-out`), and the sidebar too when no account is
  remembered on this machine (`body.no-accounts`) (`.signin-ph-*` in
  `renderer/css/70-detail-misc.css`). The hero is
  `assets/img/mockups/hero-ecosystem-transparent.webp`, also on the sign-in dialog.
- First launch picks the system's language when it is one of the 11 shipped
  (first match in the OS order; pt-BR / pt → `pt`, other pt-XX → `pt-pt`,
  zh-* → `zh`), else English — no longer always English (`_systemLang` in
  `renderer/inventory.js`).
- The printer icon is a real 3D printer (enclosed frame, gantry, print head,
  part on the bed) wherever `.icon-printer` is used
  (`assets/svg/icons/icon_printer.svg`).
- Signed in with no spool yet: "Where do we start?" replaces the two QR cards,
  under the search row and the colour bars (kept, a signature of the app):
  "Welcome to your workshop 2.0", three cards each opening the flow
  that gets a first win, with explicit links — Add a spool (the "+" add card:
  catalogue or by hand), Plug in my TigerPOD (the whole card turns green and
  becomes "Your TigerPOD is ready · Put a spool with a chip on the reader ·
  Waiting for a scan…" as soon as a reader is plugged in, else opens the
  TigerPOD window) and Choose my printer (Printers view + brand picker); the
  TigerPOD and printer cards only in the desktop app. The phone app as one
  line under them. When the first spool lands, "One less spool to look for."
  Each card shows its picture at the top right — the spool, the TigerPOD, and
  a printer that cross-fades to another random catalogue model every 2 s
  The Printers view with no printer shows the same screen (`_paintInvStart`,
  `_onInvStartClick`), replacing its old empty card (keys `printersEmptyTitle`,
  `printersEmptyBullet1-3` and `.printers-empty-bullets` / `-cta` removed).
  (`_invStartShown`, `_paintInvStartPod`, `_cycleInvStartPrinter` and the
  `#mainResult` click listener in `renderer/inventory.js`, `.inv-start*` /
  `.inv-start-art` in `renderer/css/70-detail-misc.css`). Then a slim "Going further (optional)"
  strip above the spool list offers the hardware steps — TigerPOD, a real
  printer — each with "I don't have one"; done steps are ticked, the strip
  goes quietly when both are done or skipped, or with ✕
  (`_renderFirstSteps`, `tigertag.firstSteps.<uid>` = on / closed / done and
  `.skip`, `#firstSteps`, `.first-steps*`).
- One window for the whole ecosystem, on a fixed grid so it never jumps from
  one device to the next (`ECO_SHEETS` / `_renderEcoSheet` in
  `renderer/inventory.js`, `#ecoModalOverlay` in `renderer/inventory.html`,
  `.eco-*` in `renderer/css/60-modals.css`): 840 × 760 with zones of constant
  size — six text tabs of equal width (TigerPOD · TigerScale · TigerSpool · Tiger
  Touch · TigerNFC · TigerTag; ← → / Home / End on the tabs), a scan bay (the device
  glowing on a tech grid, NFC waves from its reader, a scan beam, prev / next
  arrows), name + a promise of two lines at most, a live-state line reserved
  even when empty (green only once the device is plugged in or online), three
  one-line benefits, the data path with light packets, "How to get one" in
  three short steps, and a fixed footer: the main action, "See the guide"
  (the device's wiki page) and an "Other links" menu. Below 800 px of height
  (the 900 × 600 window) it is 840 × 552, the bay left and the words right, no
  scrolling. It plays by itself like a website carousel: a thin bar fills
  the open tab (4.5 s) and the next device comes in, held while the mouse is on
  the card, keyboard focus is inside or the links menu is open. Moving
  between devices: the sheet fades out (160 ms), then the next eases in — the
  picture slides 32 px, the words follow a beat later (≈ 0.4 s); still with reduced motion, paused while the window is
  hidden. Sheets: TigerPOD (the TigerPOD Mini; reader icon, first-steps card, "Going
  further"), TigerScale, TigerSpool and Tiger Touch (their header icons while
  the account has none — the old TigerSpool and Tiger Touch discovery windows
  are gone), TigerNFC (the Tiger NFC Connect phone app; the first-steps phone link) and TigerTag (the
  chip, `assets/img/mockups/tigertag-spool.webp`).
- The ecosystem scene (floating iMac, iPhone and Tiger Touch, the TigerPOD
  ⇄ TigerScale ⇄ TigerSpool flip) is drawn by one function into the welcome
  page, the sign-in dialog and the account setup's first step, instead of a
  still picture in the last two (`_fillHeroScenes`, `[data-hero-scene]`,
  `.hero-scene`); still in the account setup, paused while the window is
  hidden (`body.anim-paused`), the flip held ~6 s per device (18 s round).
- After an account is created with an email address (or a sign-in whose
  address isn't confirmed yet), the form steps aside for one "Check your inbox"
  step: an animated envelope, the address, what to do, "I've confirmed, sign in",
  "Send the email again" (once per 30 s) and "Use another address" — instead of
  a long green line under the form (`showCheckMail` / `hideCheckMail` in
  `renderer/inventory.js`, `#lmCheck` in `renderer/inventory.html`,
  `.lm-check*` in `renderer/css/60-modals.css`).
- Account emails (address check on sign-up / resend, password reset) are
  TigerSystem's own: Studio calls the backend's `authMail` function
  (TigerTag_Firebase_Backend `functions/authMail.js`, deployed 2026-10-29), which
  sends a branded mail in the app's language from noreply@tigersystem.io (Brevo)
  with a short `tigersystem.io/auth/<token>` link (TigerHub page). If it cannot
  send, Firebase's default email goes out instead, in the app's language
  (`_authMail`, `_sendVerification`, `_setAuthLang` in `renderer/inventory.js`;
  zh → zh-CN, pt → pt-BR, pt-pt → pt-PT). Firebase
  side (console, 2026-10-29): public name "TigerSystem", sender "TigerSystem
  <noreply@tigersystem.io>" (domain verified: SPF / DKIM / DMARC added on
  tigersystem.io at OVH), reply-to noreply@tigersystem.io; tigertag.io's two
  SPF records merged into one.
- "Get the app" in the Tiger NFC Connect sheet opens tigersystem.io's download
  page in the app's language, like the sidebar Downloads button
  (`_downloadPageUrl` in `renderer/inventory.js`; the store short link is gone).

## Fixed
- The Klipper logo was a plain letter K: it is now Klipper's own mark (the V
  with the line ending in a nozzle, from Klipper3d's `docs/img/klipper.svg`,
  without the word), as a one-colour mask with a thin gap between the line and
  the V — printers view, add-printer flow, chip chooser, welcome page
  (`renderer/printers/klipper/img/logo.svg`).
- The eye of the sign-in / sign-up password fields showed nothing: it toggled
  `-webkit-text-security`, which a real `type="password"` field ignores; it now
  switches the field between `password` and `text` (`makeEyeToggle` in
  `renderer/inventory.js`; the dialog reopens masked).
- A TigerData / TigerData+ whose maker chips (Bambu Lab, Creality…) are linked
  offered no "Burn the TigerTag(+)": it now always does, like any TigerData — a
  spool may carry its maker chips and its own TigerTag chips. Unlinked maker
  chips on the TigerPOD still turn it into "Link" (detail chip banner in
  `renderer/inventory.js`).
- Adding a spool by hand with a reader plugged in offered only "Burn the
  TigerTag" — no way to just create the spool (issue 161) — and unplugging the
  reader left the Burn banners up. The manual panel's foot now follows the
  TigerPOD: no reader → Make; a reader with no chip → Make above the Burn
  banner; a chip on it → Burn (or Link for maker chips) alone. A reader plugged
  or unplugged refreshes every Link / Burn banner, and the catalogue card offers
  "Burn the TigerTag+" only while a reader is plugged in (`_adpRenderFoot`,
  `_renderProductCard`, `onRfidReaderUpdate` in `renderer/inventory.js`,
  `.adp-foot` in `renderer/css/60-modals.css`).
- The "From the catalogue" list rebuilt every row on each letter typed, so the
  photos that stayed reloaded and flickered: rows are now keyed by product id —
  kept rows are moved, only new ones built, and a synced catalogue still
  rebuilds them (`_catalogPickFill`, `_cpkFilledIndex` in `renderer/inventory.js`).

## Removed

## i18n
- `loginCheckTitle`, `loginCheckSent`, `loginCheckHint`, `loginCheckDone`,
  `loginCheckResend`, `loginCheckResent`, `loginCheckChange` added;
  `signinNewGen`, `signinHeadline`, `signinSubline`, `signinBenScanTitle`,
  `signinBenScanText`, `signinBenPrintTitle`, `signinBenPrintText`,
  `signinBenShareTitle`, `signinBenShareText`, `signinCreate`,
  `signinHaveAccount`, `signinNoHardware`, `signinFreeOss`, `signinNeedPaw`,
  `invStartKicker`, `invStartTitle`, `invStartSub`, `invStartSpoolTitle`,
  `invStartSpoolText`, `invStartPodTitle`, `invStartPodText`,
  `invStartGoSpool`, `invStartGoPod`, `invStartGoPrinter`,
  `invStartPodReadyTitle`, `invStartPodReadyText`, `invStartPodReadyWait`,
  `invStartPrinterTitle`, `invStartPrinterText`, `invStartPhone`,
  `invStartFirstSpool` added; `signinHeadline`, `signinSubline` and
  `setupWelcomeTitle` now say "workshop 2.0" / "the workshop of the future";
  `firstStepsTitle`, `firstStepsNotMine`, `firstStepsHide` added;
  Ecosystem sheets: `ecoGetTitle`, `ecoPrev`, `ecoNext`, `ecoInstall`;
  TigerPOD `ecoPodEyebrow`, `ecoPodPitch`, `ecoPodSub`, `ecoPodBadge1`–`3`,
  `ecoPodFlowEnd`, `ecoPodOnTitle`, `ecoPodOnText`, `ecoPodGet1`–`3`, `ecoPodFile`, `ecoPodScan`; TigerScale
  `ecoScaleEyebrow`, `ecoScalePitch`, `ecoScaleSub`, `ecoScaleBadge1`–`3`,
  `ecoScaleFlowEnd`, `ecoScaleOnTitle`, `ecoScaleOnText`, `ecoScaleGet1`–`3`, `ecoScaleParts`, `ecoScaleCase`, `ecoScaleMine`;
  TigerSpool `ecoSpoolOnTitle`, `ecoSpoolOnText`, `ecoSpoolGet1`–`3`, `ecoSpoolMine`; Tiger Touch `ecoTouchFlowStart`,
  `ecoTouchFlowEnd`, `ecoTouchOnTitle`, `ecoTouchOnText`, `ecoTouchGet1`–`3`, `ecoTouchMine`, `ecoTouchCode` added;
  `tigertouchCtaCode`, `tigertouchCtaCodeSub`, `tigertouchInstall`,
  `tigertouchInstallSub` removed; `tigerspoolCtaPrint`,
  `tigerspoolCtaPrintSub`, `tigerspoolCtaWiki`, `tigerspoolCtaWikiSub`,
  `tigerspoolCtaCode`, `tigerspoolCtaCodeSub` removed;
  `tigerPodModalTitle`, `tigerPodModalDesc`, `tigerPodPrintCta`,
  `tigerPodPrintNormalBtn`, `tigerPodPrintMiniBtn`, `tigerPodFeat1`–`4`
  `Title`/`Desc`, `tigerPodCta` removed;
  `invWelcomeTitle`, `invWelcomeSub`, `invQrScanHint` removed;
  `signinWorksWith`, `signinBenDealsTitle`, `signinBenDealsText` added (`signinBenScanText` says any RFID chip scans, not
  only TigerTag); `signinTagline`, `signinFeatScan`, `signinFeatPrinters`,
  `signinFeatShare` removed (11 locales);
  `loginEmailNotVerified`, `loginResendVerif`, `loginVerifyEmailSent` removed
  (11 locales).
