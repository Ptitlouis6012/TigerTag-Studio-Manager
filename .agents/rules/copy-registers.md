# Three copy registers and the brand voice

**Rule.** Every release describes the same changes three times, each in its own voice: `CHANGELOG.md` is technical and exhaustive, `data/release-notes/vX.Y.Z.md` is factual BambuLab style, `data/whatsnew.json` and every in-app string are playful, deadpan, Discord-style. Never write one in another's voice.

**Why.** Founder rule: the changelog is read by experts and agents, the release page by power users, the app by everyone.

**How.**
- Register 1 (changelog): behaviour and mechanism, internal names allowed.
- Register 2 (release note): jargon-free, names the feature / view / printer brand, `Fixed an issue where …`, no file / function / IPC names. It becomes the GitHub Release body verbatim (`scripts/extract-changelog.mjs`).
- Register 3 (in-app + What's New): benefit-first, witty, talks like a mate — not aggressive or trolling; no jargon ("modal", "toggle", "header"); never describes what doesn't exist or our process ("we removed X"). Same voice in all 11 locales and in the mobile app.
- `npm run whatsnew:import` output is a rough draft, never shipped verbatim.
