# OctoPrint (Marlin 2 and friends) — protocol reference

Marlin has no network stack of its own: it speaks G-code over USB serial. The
common way to put a Marlin printer on the network is **OctoPrint** — usually
OctoPi on a Raspberry Pi wired to the printer's USB port. Studio talks to
OctoPrint's REST API; OctoPrint talks to the firmware. The same plugin therefore
serves any firmware OctoPrint drives (Marlin 1/2, Prusa-Firmware, RepRap,
Smoothie…), which is why it is named after the server, not the firmware.

Self-contained printer plugin (`docs/PRINTER-PLUGINS.md`): nothing here is
shared with another brand's files.

## 1. Transport

- HTTP REST, JSON. OctoPi serves it behind haproxy on **port 80** (`/api/…`);
  a bare `octoprint serve` listens on **5000**. The address field accepts
  `host[:port]`.
- No CORS for arbitrary origins → every call goes through the plugin's
  `main.cjs` (`printer:octoprint:http`), which allow-lists the paths below.
- Polling, 2 s: `GET /api/printer` + `GET /api/job`. (OctoPrint also has a
  SockJS push socket; polling is simpler, and what most integrations do.)

## 2. Authentication

Every API call carries `X-Api-Key: <key>`. Two ways to get a key:

1. **Application Keys** (bundled since OctoPrint 1.5) — no typing:
   - `GET  /plugin/appkeys/probe` → **204** when the workflow is available (no auth).
   - `POST /plugin/appkeys/request` `{ "app": "Tiger Studio" }` → **201**
     `{ "app_token": "…" }`; OctoPrint pops an *Access request* dialog to every
     logged-in user.
   - `GET  /plugin/appkeys/request/<app_token>` → **202** while pending,
     **200** `{ "api_key": "…" }` once allowed, **404** when denied or expired.
2. Pasted by hand: *User settings → Application Keys* (or the global API key).

`401`/`403` on a call = missing / wrong key.

## 3. Connection flow

1. Probe: `GET /plugin/appkeys/probe` (204) or `GET /api/version` (200 with a
   key, 401/403 without) — either says "OctoPrint is here".
2. `GET /api/version` → `{ api, server, text: "OctoPrint 1.10.2" }`.
3. `GET /api/connection` → `{ current: { state, port, baudrate, printerProfile } }`.
   `state` is `Operational`, `Printing`, `Paused`, `Closed`, `Offline`,
   `Error: …`… OctoPrint up but printer not connected = `Closed`/`Offline`.
4. `GET /api/printerprofiles` → current profile: `extruder.count`, `heatedBed`,
   `heatedChamber`, `volume`.
5. `GET /api/settings` → `webcam.{ streamUrl, snapshotUrl, flipH, flipV, rotate90, webcamEnabled }`.
6. Poll (§1). `GET /api/printer` answers **409** while the printer is not
   operational — not an error of ours, it means "connect the printer".

## 4. Status

`GET /api/printer` →
```json
{ "temperature": { "tool0": { "actual": 214.8, "target": 215 },
                   "bed":   { "actual": 59.9,  "target": 60 } },
  "state": { "text": "Printing",
             "flags": { "operational": true, "printing": true, "paused": false,
                        "pausing": false, "cancelling": false, "error": false, "ready": false } } }
```
`GET /api/job` →
```json
{ "job": { "file": { "name": "benchy.gcode", "path": "benchy.gcode", "origin": "local" },
           "estimatedPrintTime": 5420 },
  "progress": { "completion": 42.1, "printTime": 2280, "printTimeLeft": 3100 },
  "state": "Printing" }
```
State mapping: `printing` → printing, `paused`/`pausing` → paused,
`cancelling` → cancelled, `error` → error, operational & idle → idle; a job at
100 % that just ended → complete (`state: "Operational"` + completion 100).

OctoPrint core does **not** report fan speed, speed factor or toolhead
position — they live only in the serial log. The control card sets them and
shows the last value *we* sent (never a made-up reading).

## 5. Commands

| What | Call |
|---|---|
| Pause / resume | `POST /api/job` `{ "command": "pause", "action": "pause" \| "resume" }` |
| Cancel | `POST /api/job` `{ "command": "cancel" }` |
| Jog | `POST /api/printer/printhead` `{ "command": "jog", "x": 10 }` (relative, mm) |
| Home | `POST /api/printer/printhead` `{ "command": "home", "axes": ["x","y"] }` |
| Fan / speed / any G-code | `POST /api/printer/command` `{ "commands": ["M106 S128", "M220 S110"] }` |
| Connect serial | `POST /api/connection` `{ "command": "connect" }` |

## 6. Files & thumbnail

`GET /api/files/local/<path>` → `{ thumbnail: "plugin/prusaslicerthumbnails/thumbnail/x.png?…" }`
when a thumbnail plugin (PrusaSlicer Thumbnails, Cura Thumbnails) extracted
one. The path is relative to OctoPrint's root, fetched with the key.

## 7. Camera

`webcam.streamUrl` (MJPEG, usually `/webcam/?action=stream`, relative to port
80) into an `<img>`; `snapshotUrl` when the stream is not MJPEG.
`flipH` / `flipV` / `rotate90` applied as CSS transforms.

## 8. Discovery

OctoPrint announces `_octoprint._tcp` over Zeroconf, but the scan does what
works everywhere: `GET /plugin/appkeys/probe` on port 80 across the local /24s
(+ extra subnets). 204 = OctoPrint. No credential leaves.

## 9. Mapping onto Studio

- Plugin id **`octoprint`**, Firestore `users/{uid}/printers/octoprint/devices/{id}`
  (generic rule), `apiKey` is a `secret` field.
- No filament slots and no filament card: OctoPrint keeps no filament identity,
  so there is nothing true to show.
- Model catalogue: the Marlin machines of OrcaSlicer's profiles
  (`gcode_flavor: marlin | marlin2`), Bambu Lab excluded.
- Beta badge until proven on real hardware.
- Test bench: `npm run octoprint:mock` (`scripts/octoprint-mock.mjs`).

## 10. To confirm on real hardware

- [ ] Application Keys flow on OctoPi 1.9 / 1.10 (dialog wording, timeout).
- [ ] Relative vs absolute `streamUrl`; multi-webcam setups (1.9 webcam plugins).
- [ ] Thumbnail paths for PrusaSlicer Thumbnails vs Cura Thumbnails.
- [ ] `409` handling while the serial port is closed; auto-connect.

## Sources

- OctoPrint REST API docs — https://docs.octoprint.org/en/master/api/
- Application Keys workflow — https://docs.octoprint.org/en/master/bundledplugins/appkeys.html
- Home Assistant OctoPrint integration (uses the same endpoints + app keys).
