# Worklog — v2.21.1 (in progress)

## Added

## Changed

## Fixed
- **Every spool in a back row was unranked on launch** — a two-deep rack came back with only its front row filled, and the rest sitting in "Not stored". Storage runs a self-heal that finds two spools sharing one slot and evicts the extras, and its slot key was `rack | level | position` — **without the depth**. A spool behind therefore shared a key with the spool in front of it, so a full two-deep column read as a pile of duplicates and everything but the front one was written back to `rack: null`. Caught in the app's own log: `[racks] self-heal: 57 spool(s) in already-occupied slots → unranked`. The depth is part of the slot now: two rows deep is not a collision, it is the feature. It happened behind the "What's New" window, which opens 2.5 s after launch, so the damage was only discovered when that window was dismissed. — `renderer/inventory.js`
- **One half of a twin pair was unranked on launch, at random.** A twin pair is ONE physical spool wearing two chips, so both halves legitimately share a slot — and the duplicate-slot heal knows it, grouping them before it counts. But only one of the two documents carries the field that links them (which is exactly why `_markTwinPairs` flags both sides rather than trusting it), and the lookup that resolves a twin only ever read that one direction. So the pair read as a legitimate couple or as two rivals depending on which half the heal happened to visit first — a coin toss, every launch. The lookup reads both ways now. It was not confined to the heal: **nine** places resolve a twin, including the slot write, which therefore reached only one of the two documents depending on the direction. Fixed at the source, in the one function. — `renderer/inventory.js`
- **Two heuristics that write `rack: null` on real spools now refuse to run when they would clear a large share of the stock.** The duplicate-slot heal and the orphan-reference sweep both act on a guess — "you are on top of someone" / "your rack is gone" — and a guess that erases where a user put a quarter of their collection has misread something rather than found that much genuine mess. Both now step aside and say so in the log instead of writing the mistake to every document they can reach. The orphan sweep additionally waits for a racks snapshot **confirmed by the server**: a cold start is served from a local cache that may name fewer racks than exist, and acting on it unranks everything living in the racks it forgot. — `renderer/inventory.js`

## Removed

## i18n
