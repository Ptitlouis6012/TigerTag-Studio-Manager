# Worklog — v2.46.1 (in progress)

## Added

## Changed

- **App icon back to the v2.45.0 tiger** (`assets/img/icon.png`, `icon.ico`, `icon.icns` restored from v2.45.0; the v2.46.0 master `assets-src/svg/icon.svg` removed): on macOS 26 the v2.46.0 icon, artwork on the Apple grid with transparent margins, was put "in jail" — shrunk onto a grey plate in the Dock — while the old full-bleed, fully opaque 1024 image is cut to the icon shape by the system.
## Fixed

- **macOS update now installs when "Update" is clicked** (`main.js`, `wireUpdaterEvents`, `install-update`): electron-updater reports "downloaded" as soon as the zip is cached, while Squirrel.Mac still fetches it again from its local proxy and checks the signature (~27 s for v2.46.0's 300 MB zip); the 6 s forced exit added in v2.32.0 for Windows killed the app before Squirrel had the update, so nothing was installed (seen 2.45.0 → 2.46.0: two clicks, two quits, no update). On macOS "Update" is now offered only once Squirrel.Mac holds it (`nativeAutoUpdater` `update-downloaded`, `_macSquirrelReady`; meanwhile the status stays "downloading" at 100 %), and the forced-exit fallback is armed only from then. Windows unchanged.
## Removed

## i18n
