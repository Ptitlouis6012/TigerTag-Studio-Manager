# Tiger Studio Web — web hotfixes

How to ship a fix to **Tiger Studio Web** (`studio.tigersystem.io`) **without a
desktop build** — and without the web and desktop version numbers drifting apart.

## The rule

The version number `X.Y.Z` belongs to the **desktop release**. The web always runs
the latest published release's `X.Y.Z`. A web hotfix adds a **web build number**
on top: the web shows `X.Y.Z · web N`, the desktop stays on `X.Y.Z`. `X.Y.Z` itself
only ever moves with a full desktop release.

| Change | How it ships |
|---|---|
| Web-only fix (browser bridge, web build, a bug only the web hits) | **Web hotfix** — `npm run web:hotfix`, live in ~2 min, no installers |
| Anything a desktop user would also get (shared UI, data, behaviour) | **Normal release** (`vX.Y.Z` tag, CI builds the installers), web follows automatically |

**The limit to keep in mind:** a hotfix tag builds whatever is on `main` at that
commit, so the web gets every commit since the release — shared code included. Use
a hotfix when `main` holds only web-side changes since the release (or changes that
are harmless on the web); when it holds desktop work too, cut a normal release.

## Shipping one

1. Commit and push the fix to `main` (as usual, on the founder's order).
2. `npm run web:hotfix` (`-- --dry-run` to see what it would do). It checks that the
   commit is on `origin/main` and that `package.json` at that commit is the latest
   release's version, then tags it `web-vX.Y.Z.N` (next free `N`) and pushes the tag.
3. The tag triggers **Web sync** (`.github/workflows/web-sync.yml`): it refuses a tag
   whose `X.Y.Z` is not the latest release, deploys the Hub, and waits until
   `studio.tigersystem.io/studio/version.json` shows `{ "version": "X.Y.Z",
   "webBuild": N }`. A red run means the web is not on that build.
4. Open pages and installed apps reload onto it the next time they come into view.
5. Note it in `WORKLOG.md` under the next version, *"(shipped to the web as
   web-vX.Y.Z.N)"* — it reaches the desktop with that release.

The desktop build (`build.yml`) only runs on `v*` tags, never on `web-v*`.

## How the pieces read it

- `scripts/build-web.mjs --web-build N` stamps `N` into `version.json` and into
  `renderer/web-bridge.js` (Settings → About shows `X.Y.Z · web N`; the reload check
  compares version **and** web build).
- The Hub (`TigerTag_Hub` → `scripts/fetch-studio-web.mjs`) takes the latest release,
  lists `web-v<release>.*` tags with `git ls-remote`, builds the highest one, and
  fails the build if the result is not exactly that release and that `N`. Hotfix tags
  of an older release are ignored as soon as a new release is published.
