# Worklog — v2.35.0 (in progress — Prusa beta on branch feat/prusa)

## Added
- **Prusa printers (beta)** — every Prusa running PrusaLink (MK4/MK4S, MK3.9/MK3.9S, Core One, XL 1/2/5 tools, MINI/MINI+, MK3S+ / MK2.5S via Raspberry Pi), with or without MMU, with or without a camera. LAN only (Prusa Connect has no public API).
  - Transport in main: `prusa:http` (HTTP Digest auth with a cached challenge, optional `X-Api-Key`, tight path allowlist, GET/PUT/DELETE/HEAD, binary for thumbnails/snapshots) + `prusa:probe` (one unauthenticated `GET /api/version` — 401 Digest "Printer API" / PrusaLink server header / version body) — `main.js`, `preload.js` (`window.prusa`)
  - Driver `renderer/printers/prusa/index.js`: 2 s `/api/v1/status` poll (state map incl. `ATTENTION`, nozzle/bed/chamber temps, progress, time left, fans, speed/flow), `/api/v1/job` on a new job + every 10 s (display name, thumbnail → data URL, G-code metadata), `/api/v1/info` + `/api/version` once (MMU, serial, camera, firmware); reconnect backoff + re-find; auth / old-API / command errors as banners + one toast; debug-mode request log
  - Slots: MMU → 5 bays (one "MMU" board unit), XL → T1…Tn from the model catalog `tools`, else E1; filled from the job's `filament_type` / `extruder_colour` metadata while it runs (PrusaLink reports no loaded filament)
  - Controls: pause / resume / stop on the side card and the printer board (`controlJob`), hold-to-confirm 1.2 s / 1.5 s
  - Camera (`widget_camera.js`): Buddy3D at its own IP over local RTSP (`rtsp://<ip>/live`, ffmpeg → JPEG frames, `prusa:cam-start-rtsp`) or the PrusaLink-side camera (`/api/v1/cameras/snap` every 2 s); one feed per printer for side card, board and in-app camera wall, stopped when no surface shows it (not in the detached camera window yet)
  - Add flow (`add-flow.js`, `probe.js`): network scan (HTTP sweep of the local /24s + shared extra subnets, tickable results) or manual IP (`host[:port]`), then the settings form (PrusaLink password, optional user, optional Buddy3D camera address)
  - Wiring: brand list, picker, model catalog `data/printers/prusa_printer_models.json` (placeholder images), job normalisation, online state, connect/disconnect, camera dispatch, re-find (`refind.js`, ARP MAC) + identity (`identity.js`), AI-assistant data guide brand list — `renderer/inventory.js`, `renderer/inventory.html`, `renderer/css/40-printers.css`, `renderer/printers/prusa/prusa.css`
  - `PROTOCOL.md` for the brand; `ATTENTION` counts as a running job in the shared job bar (`job-bar.js`)
  - Placeholder brand mark `assets/svg/icons/logo_prusa.svg` (a "P", not the official logo) and placeholder model image `assets/img/prusa_printers/no_printer.png` — real artwork to come

## Changed

## Fixed

## Removed

## i18n
- Added: `printerHintPrusaIP`, `printerLblPrusaPassword`, `printerHintPrusaPassword`, `printerLblPrusaUser`, `printerHintPrusaUser`, `printerLblPrusaCamera`, `printerHintPrusaCamera`, `printerHelperPrusaTitle`, `printerHelperPrusaBullets`, `prusaAddChoiceTitle`, `prusaScanEmpty`, `prusaManualNoReply`, `prusaErrAuth`, `prusaErrOldApi`, `prusaErrCommand`, `prusaAttention`, `prusaState_attention`, `prusaSpeed`, `prusaFlow` — 11 locales
