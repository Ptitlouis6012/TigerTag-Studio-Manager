# Worklog — v2.27.1 (in progress)

## Added

## Changed

## Fixed
- **Searching the catalogue stopped its pictures loading — for good.** The image loader caps how many requests are in flight, and the counter only came back down when an image fired `load` or `error`. An element destroyed mid-flight fires NEITHER, and the catalogue search wipes and rebuilds its grid on every keystroke: six images torn down that way held all six slots permanently, the queue jammed at the cap, and not one picture loaded again for the rest of the session — hence "never again" rather than "sometimes". In-flight images are now held in a SET rather than counted, so the pump can see the ones that left the DOM and take their slots back. Reported from real use; the mechanism matches the symptom exactly, but the fix was confirmed by the reporter rather than by measurement here — an Electron window left in the background reports `visibilityState: "hidden"`, and Chromium throttles IntersectionObserver there, so every automated reading was zero regardless of the code — `renderer/inventory.js`
- **The macOS release build could no longer sign itself.** `security set-key-partition-list -k` was being handed the CERTIFICATE's import password, but that flag authenticates against the KEYCHAIN — two different secrets. macOS used not to check; the runner image that ships macOS 26 does, so v2.27.0 failed with `SecKeychainUnlock: The user name or passphrase you entered is not correct` while nothing on our side had moved: same certificate (valid to 2031), same secrets (untouched since May), same electron-builder (26.15.3) — only the image, 20260728 → 20260907. It is electron-builder's bug, fixed upstream in PR #10101, which sits in `27.0.0-alpha.8` and in NO stable release (26.15.7 and 26.16.1 both lack it). So the workflow builds the signing keychain itself — create, import, authorise codesign with the keychain's OWN password — and hands `CSC_KEYCHAIN` to electron-builder, which then skips the broken path. `CSC_LINK` is deliberately unset: passing it makes electron-builder rebuild its own keychain and take that path again. The keychain password is generated per run and never leaves the runner. The step carries its own removal condition — delete it once the fix reaches a stable electron-builder — `.github/workflows/build.yml`

## Removed

## i18n
- Pending cleanup, carried over from v2.23.1: `scaleNoActivity` and `scaleReader` are orphaned — still shipped in all 9 locales, no longer referenced anywhere in `renderer/`
