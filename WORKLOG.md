# Worklog — v2.32.1 

## Added

## Changed

## Fixed
- Google sign-in failing with a bare "fetch failed" on some machines: the OAuth token exchange now goes through Electron's `net.fetch` (Chromium stack — system proxy, OS certificate store, same DNS as the browser) instead of Node's `fetch`, and the failure log includes the underlying cause — `main.js`
- Windows: the whole app crawled on some machines (every click, even a window resize, took one to two minutes) — the USB-scale detection enumerated HID devices SYNCHRONOUSLY on the main thread every 5 s (`HID.devices()`), and on slow HID / Bluetooth drivers each call took seconds. It now uses `HID.devicesAsync()` (worker thread) with an in-flight guard, and when a scan takes over 2 s it logs it and slows polling to once a minute. Confirmed by a user log on v2.32.0: the 10 s launch freeze persisted after the TD1S scan was removed — it was this HID enumeration all along (it runs right after the TD1S init) — `main.js`; `CODEMAP-main.md` discovery-probe ranges re-synced

## Removed

## i18n
