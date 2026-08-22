# Worklog — v2.20.0

## Added
- Header scale icon = one glyph per scale (capped at 2), coloured by its own state (active green / standby blue / offline red / grey none) + hover popover listing every scale with a status dot — `renderer/IoT/tigerscale/*`, `renderer/inventory.html`.
- Standby as a first-class state (blue) with regime-aware offline detection (90 s active / 11 min screen_off).
- iOS-style battery pill on the scale glyph (fill + value inside + charging bolt; charging→low→neutral).
- TigerPOD modal: two print buttons — Standard + Mini (OpenSpool).
- TigerTag+ reference DB refreshed to 12 211 products (`db_update.py` → `assets/db/tigertag/*`).

## Changed
- Scale Wi-Fi = connectivity colour (green online) + realistic bar thresholds; dBm in tooltip.
- `rfidReadersMax` recorded on a successful read + kept at lifetime max (seeded at login).
- Backend cloud indicator hidden unless offline > 3 s (kills the startup flash).
- Tare button confirms success only on a 2xx (firmware CORS open); error state otherwise.
- Debug-mode telemetry instrumentation (power transitions + snapshot→render timing).

## Fixed
- Standby scale wrongly marked offline after 90 s.
- `containerWeight` = -1 (unknown) rendered "-1 g" → now "—".
- Light-theme contrast on the TigerPOD modal (purple header text + orange badge numbers).

## Removed

## i18n
- Added: `scaleStatusStandby`, `scaleHealthStandby`, `scaleHealthRow`, `scaleChipCharging`, `tigerPodPrintCta`, `tigerPodPrintNormalBtn`, `tigerPodPrintMiniBtn`, `tigerPodOwnLabel`, `tigerPodOwnSub` — 9 locales
