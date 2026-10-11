# Worklog — v2.37.1 (in progress)

## Added
- **TigerSquad flag** — My profile → TigerSquad gains "Team": a searchable country picker (flag + name in the app language, the detected country by default) writing `users/{uid}.squadCountry` (ISO alpha-2; cleared = detected). The server publishes `userProfiles/{uid}.tigerSquad.country` (the pick, else the country the app detects) for the Hub's countries ranking — `renderer/inventory.js` (`_fillSquadCountry`, `_setSquadCountry`), `renderer/tz-country.js` (`COUNTRY_CODES`), `renderer/inventory.html`

## Changed

## Fixed

## Removed

## i18n
