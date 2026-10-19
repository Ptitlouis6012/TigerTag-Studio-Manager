# Product images

**Rule.** Request the CDN rendition that fits the slot: `cdnImg(url, cssPx)` for every `cdn.tigertag.io/img` link.

**Why.** `/img` defaults to `large` (512 px, ~33 kB): 28 px table chips were downloading 512 px images.

**How.** `cdnImg` picks the first rendition covering the slot at the screen density (ladder in `_cdnSizeFor`); `master` (1024 px) only on demand. User-uploaded photos and `data:` URIs are left untouched. Details: the *Product images* section of `CLAUDE.md`.
