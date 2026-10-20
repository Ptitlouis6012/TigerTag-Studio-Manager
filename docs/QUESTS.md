# Tiger Quests — implementation spec

Status: **design validated by the founder (2026-10-20). Phase 1 (backend) written in
`TigerTag_Firebase_Backend` (`functions/quests.js` + `storeTotals`, rules, unit tests), not deployed
and deployed; phase 2 (Studio) built: counters at every action site, `dailyQuest` check-in, sidebar pill,
Quests window (Today / Journey) and celebrations — `renderer/quests/`.** Presentation page shared with
the TigerSquad: https://claude.ai/artifact/J2mDb8rv39G8axF8hWLydy (the numbers below are the source
of truth; the page is an illustration).

Three parts, all server-authoritative: the **daily quest**, the **journey** (ranks → levels →
actions), and the **update bonus**. A fourth, the **chip workshop**, ships separately (it needs
real-hardware testing).

## 0. Principles

- **XP is computed by the backend only** (`TigerTag_Firebase_Backend/functions/supportWebhooks.js`,
  `recomputeXp`). The client never writes XP. New XP lands as new `xpBreakdown` parts:
  `daily`, `updates`, `journey`.
- **Two signal sources**, as today:
  1. **Firestore state** the server can count itself (friends, printers, racks, lists, inventory,
     rfidList, userProfiles, countedChips).
  2. **Client stamps and counters** in `users/{uid}/telemetry/studio` for what only the app sees
     (theme switched, What's New read, camera opened, print finished at 100 %, video recorded…).
     Same trust level as the existing discovery stamps (`firstUsbScaleAt`, `<link>ClickedAt`).
- Counters live in ONE map field so the `telemetry` `hasOnly([...])` whitelist grows by one entry:
  `quest: { <actionId>: <count or 1> }`. Each write is a `FieldValue.increment` or a set to 1.
- Chip counters move **once per physical chip UID** (reuse `countedChips` / `rfidList`); re-programming
  the same chip never advances a counter.
- **Never reward fake data that harms the inventory**; weight-slider moves are accepted as training.
- Rules + deploys follow `.agents/rules/firestore-changes.md`; mass recompute follows
  `.agents/rules/irreversible-actions.md` (explicit go).

## 1. Daily quest — 60 XP / day

- Day = the user's **local** day (client sends its IANA time zone; server validates and stores it on
  `users/{uid}.tz`). The rollover is local midnight; an app left open checks in at the rollover, on
  window focus, and on launch.
- Composition: **open the app 10** + **4 missions × 5** + **full-set bonus 30** = 60.
- The server draws the 4 missions per user per day (deterministic: hash of uid + date), **no re-roll**,
  filtered by what the user owns and has not finished (no Tiger POD mission without a reader, no
  "join the squad" when already a member).
- Pool (free, discovery-style; extend freely): find a filament from brand X in the catalogue (brand
  rotates; Rosa3D is featured), visit a friend's stock, favourite a spool, move a weight slider,
  create a wishlist, put a spool in a rack, add a note, open a printer camera, filter the catalogue
  by a material, sort the inventory table, read What's New, try a demo printer, switch to light mode,
  set a minimum stock, share the friend link.
- Server doc: `users/{uid}/quests/daily` = `{ day, tz, missions: [id×4], baseline: {...counters at
  draw}, done: [bool×4], open, bonusPaid, days, xp, streak, bestStreak, lastFullDay }`. A mission is
  done when its counter exceeds the baseline. Only the `dailyQuest` check-in starts a new day; a day
  the app never reopened just expires.
- Celebration in the app on every mission done and on the full set.
- `xpBreakdown.daily = { n: days, xp: Σ }` (accumulated, never recomputed from state).

## 2. Update bonus

- **+50 XP per update installed**: the first time the server sees a newer `appVersion` in telemetry
  than the last rewarded one (several versions jumped at once = one update).
- **+50 XP "Speedrun"** when that update is installed within **3 days** of the release date
  (release dates: GitHub Releases `published_at`, cached server-side).
- `xpBreakdown.updates = { n, xp }`.

## 3. Journey — ranks → levels → actions

- **20 ranks** (exploration theme), each with **5 levels**; each **level = 5 actions**, each action a
  bar (some with a target count). Shipped first: **Discovery 1–5** and **Explorer 1–5**. Ranks #3–20
  are shown as "coming soon" (names below); more levels/ranks can be added without touching old ones.
- Actions advance **in parallel, any order**. A level's **bonus** is paid only when (a) its 5 actions
  are done, (b) every lower level is done, (c) the account XP has reached the level's threshold.
  Otherwise the app shows it "waiting" (lower level open) or "locked" (XP threshold).
- **Discovery needs no RFID chip.** **Explorer uses chips but never TigerTag+ Certified** — Certified
  actions start at rank #3. A Certified chip counts as TigerTag+ AND Certified.

| Level | XP to enter | Bonus | Theme | Actions (target) |
|---|---|---|---|---|
| Discovery 1 | 0 | 50 | First look | display name · profile photo · switch to light mode · open the storage view · find a Rosa3D filament in the catalogue |
| Discovery 2 | 100 | 75 | My stock | create a spool without a chip (TigerData) · update spool weights (5) · spools in racks (5) · a note on a spool · favourite spools (3) |
| Discovery 3 | 200 | 100 | My printers | add your first 3D printer · rename your printer · arrange printers in the grid · open a printer camera · take a camera photo |
| Discovery 4 | 350 | 125 | Shopping & lists | create a wishlist · add a buy link · set a minimum stock · export a .ttag file · filter the catalogue by PETG |
| Discovery 5 | 500 | 150 | Community | share your friend link · add your first friend · join the TigerSquad · visit a friend's stock · read What's New |
| Explorer 1 | 700 | 200 | Organised stock | spools in racks (25) · update spool weights (25) · program TigerTag chips (5) · program a TigerTag+ chip · scan a spool's chip to open it |
| Explorer 2 | 950 | 250 | Printing | try a demo printer · prints finished at 100 % (5) · record a camera video · printers connected (2) · assign a spool to a printer slot |
| Explorer 3 | 1250 | 300 | Social | friends (3) · visits to friends' stocks (5) · share a public list · make your profile public · add a social link |
| Explorer 4 | 1600 | 350 | Chip workshop | recycle a chip · initialise a chip (TigerTag Init) · program TigerTag chips (10) · own TigerTag+ chips (3) · read a chip with the NFC tester |
| Explorer 5 | 2000 | 400 | Collector | brands explored in the catalogue (10) · different materials owned (5) · prints finished at 100 % (10) · spools in racks (50) · daily quest 7 days in a row |

Ranks (role · world), icons in the app: 1 Discovery · Base camp 🏕️, 2 Explorer · The hills 🌄,
3 Mountaineer · The mountains 🏔️, 4 Nomad · The deserts 🏜️, 5 Boatman · The rivers 🛶, 6 Navigator ·
The seas ⛵, 7 Deep diver · The oceans 🌊, 8 Polar explorer · The poles 🧊, 9 Aviator · The skies 🛩️,
10 Test pilot · The stratosphere 🎈, 11 Astronaut · Orbit 🛰️, 12 Moonwalker · The Moon 🌙, 13 Space
voyager · The planets 🌍, 14 Prospector · The asteroid belt ☄️, 15 Pioneer · The gas giants 🪐,
16 Pathfinder · The edge of the solar system 🧭, 17 Star voyager · The stars ⭐, 18 Nebula hunter ·
The nebulae ✨, 19 Galactic explorer · The galaxy 🌌, 20 Legend · The universe ♾️.

- Action XP: each finished action gives a small amount (proposal: 5 in Discovery, 15 in Explorer);
  the level bonus comes on top. `xpBreakdown.journey = { n: actionsDone, xp }`.
- Action ids are stable strings (`d1.displayName`, `e2.prints100`…); the definition table lives in
  ONE shared module the server and the app both read (the app only displays; the server decides).
- Server doc: `users/{uid}/quests/journey` = `{ actions: {id: count}, levelsDone, bonusesPaid,
  waiting, locked, n, xp }`, rebuilt by `recomputeXp`. Counts keep their best value (a reset counter
  never takes progress back), except the TigerSquad action, which follows membership. A paid bonus
  stays paid while its level stays complete.
- Update bonus doc: `users/{uid}/quests/updates` = `{ version, n, speedruns, xp }`; the current
  version is the highest in `telemetry/studio.versionsUsed`; only a version with a published GitHub
  release counts (release dates cached in `appReleases/{version}`). The first version seen is the
  baseline and pays nothing.

### Counter keys the app writes (phase 2)

All under `telemetry/studio.quest`. **Counters** (`FieldValue.increment(1)` at the action site):
`lightMode` (switched to light), `storageView`, `weightUpdate`, `spoolNote`, `favorite`, `rackPut`,
`printerRename`, `printerArrange`, `cameraOpen`, `cameraPhoto`, `cameraVideo`, `listCreate`,
`listShare`, `buyLink`, `minStock`, `ttagExport`, `tableSort`, `friendLinkShare`, `friendVisit`,
`whatsNewRead`, `demoPrinter`, `print100`, `slotAssign`, `chipScanOpen`, `chipRecycle`, `chipInit`,
`nfcTesterRead`, `brand_<id_brand>` (catalogue searched/filtered by that brand), `material_<id_material>`
(catalogue filtered by that material). **Gauges** (set to the current value): `spoolsInRacks`,
`materialsOwned`. Everything else (display name, photo, printers, friends, lists, chips, TigerData
spools, public profile, socials, TigerSquad) is read by the server from state.

## 4. Rarity rebalance (state-based achievements)

A perfect day is 60 XP, so devices are rescaled to stay "legendary". Values in `ACH_XP`:

| Rarity | Items |
|---|---|
| Common 5–10 | daily missions, simple discoveries, community links (5), each friend (10) |
| Uncommon 20–50 | each printer (20), first rack, first list |
| Rare 100–200 | TigerSquad membership 150 (was 50), RFID reader 100 (was 20; a Tiger POD validates it too), USB scale |
| Epic 300 | mobile app (was 100), TD1S (was 30) |
| Legendary 800–1000 | Tiger POD 800 (was 50; two ACR122U readers), Tiger Spool 800 (was 75), Tiger Touch 800 (was 100), Tiger Scale 1000 (was 200) |

Chip points are unchanged (TigerTag 1, TigerTag+ 2, Certified 10, once per physical chip). State-based
values are recomputed, so owners get the new values on their next recompute; a one-off recompute of
every account needs an explicit go.

## 5. Chip workshop (separate release, real-hardware test)

Recycle into TigerTag / TigerTag+, initialise to **TigerTag Init** (`id_version` 1816240865), convert
to standard **NDEF** (open question: blank, or carrying a user link). A certified chip loses its
signature when rewritten: clear warning + hold-to-confirm; the XP it earned stays.

## 6. Phases

1. **Backend**: action table module, telemetry `quest` map (rule + `hasOnly`), `recomputeXp` parts
   `daily` / `updates` / `journey`, daily draw (callable `dailyQuest`), update/Speedrun bonus, rarity
   values. Unit tests on the evaluator. Deploy on go.
2. **Studio**: emit the client stamps/counters at each action site; Quests panel (daily card +
   journey with rank/level/action bars, states won / waiting / locked); celebrations; 11 locales.
3. **Docs**: `docs/firestore-schema.md`, backend README, integration guide, TigerHub (§ firestore
   propagation rule).
4. **Chip workshop** (after hardware test). Later: mobile app and Tiger Touch read the same quests.
