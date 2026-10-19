# Verify UI changes yourself

**Rule.** Verify every renderer change yourself in the running dev app before reporting it done; do not ask the founder to check or test routine changes.

**Why.** Founder order (2026-09-28): he added the dev-drive switch so the agent can see the app; being nudged "test this" after every tweak is noise.

**How.**
- `npm run start:drive`, then `npm run drive -- wait|eval|click|type|shot|logs|reload` (`scripts/devdrive.mjs`). Screenshots go to the scratchpad, never into the repo.
- Hardware- or data-dependent behaviour (printers, RFID, scales) is the exception: ask for a real-device test, once, at commit time.
- Known trap: the global `button { height: 40px }` in `renderer/css/70-detail-misc.css`.
