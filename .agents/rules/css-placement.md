# CSS conventions

**Rule.** Put each new rule in the `renderer/css/` section file that matches the feature (or the module's own CSS under `renderer/IoT/<module>/`), use theme tokens for new colours, size masked SVG icons on one dimension with `aspect-ratio`, and beat a global rule by doubling the class selector, not with `!important`.

**Why.** Founder rules; a distorted icon and a cascade of `!important` overrides were the recurring bugs.

**How.**
- Files load in order: `00-base` … `70-detail-misc` (see the file map in `CLAUDE.md`). Asset URLs use `url('../../assets/svg/icons/…')`.
- Icons: `height: 18px; aspect-ratio: W / H` from the SVG `viewBox` (`head -1 icon.svg`), `-webkit-mask-size: contain`.
- `input[type="text"]` (0,1,1) is beaten by `.a .b` (0,2,0).
- Colours: every new colour is a theme token; `npm run theme:check` reports the raw colours still in the CSS (a backlog of ~500, not a gate).
- No JS inline in `renderer/inventory.html`.
