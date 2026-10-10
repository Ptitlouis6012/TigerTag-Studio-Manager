# Worklog — v2.36.1 (in progress)

## Added
- **Support the project: Buy Me a Coffee, Ko-fi or PayPal.** Every coffee button (sidebar, About, What's New, the requests card's coffee cards) opens a small chooser anchored next to it — Buy Me a Coffee (card, Apple / Google Pay), Ko-fi (`ko-fi.com/tigersystemio`, card or PayPal, one-off or monthly) or PayPal (`paypal.me/tigersystemio`) — for supporters who can't or won't use BMC; closes on pick, outside click or Esc. The repo's GitHub **Sponsor** button lists all three (`.github/FUNDING.yml`) — `renderer/inventory.js` (`_openCoffee`, `PAYPAL_URL`, `KOFI_URL`), `renderer/report/index.js`, `renderer/css/10-settings.css`, `assets/svg/logos/logo_paypal.svg`, `assets/svg/logos/logo_kofi.svg`

## Changed
- "Support the project" section (Buy Me a Coffee, Ko-fi + PayPal, personal open-source project) in the README and `llms.txt` — `README.md`, `llms.txt`

## Fixed

## Removed

## i18n
- Added: `supportBmcSub`, `supportKofiSub`, `supportPaypalSub` — 11 locales
