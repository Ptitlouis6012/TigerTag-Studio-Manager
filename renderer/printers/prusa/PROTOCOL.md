# Prusa — PrusaLink protocol (agent skill)

Self-contained reference for the Prusa integration in Tiger Studio Manager.
Status: **beta** — built against Prusa's published OpenAPI spec
(`prusa3d/Prusa-Link-Web` → `spec/openapi.yaml`) and a local mock; to be
confirmed on real hardware (see §9).

## 1. Which printers

One local REST API — **PrusaLink** — for every current Prusa:

| Printer | Where PrusaLink runs | Notes |
|---|---|---|
| MK4 / MK4S, MK3.9 / MK3.9S, Core One | Buddy firmware (on the printer) | MMU3 optional |
| XL (1, 2 or 5 toolheads) | Buddy firmware | tool count from the model catalog |
| MINI / MINI+ | Buddy firmware | |
| MK3S+ / MK2.5S | Raspberry Pi (PrusaLink image) | MMU2S/MMU3 optional, USB camera possible |

PrusaLink must be enabled on the printer: *Settings → Network → PrusaLink*. That
screen shows the user (`maker`) and the password. A Pi install lets the owner
choose another user name (optional `username` field).

Prusa Connect (the cloud) has no public API and is **not** used.

## 2. Transport

- HTTP on port **80** (an explicit `host:port` is accepted for non-standard setups).
- **HTTP Digest auth** (MD5, `qop=auth`) — realm `Printer API` on Buddy.
  Older PrusaLink builds also accept `X-Api-Key`; the driver sends it instead
  when `printer.apiKey` is set.
- No CORS headers → every request goes through the main process:
  `ipcMain.handle('prusa:http', { host, method, path, user, password, apiKey, body, binary, timeoutMs })`
  → `{ ok, status, json | data(base64), contentType, error }`.
  The challenge is cached per host, so a poll costs one request; a stale nonce
  costs one 401 + retry.
- **Path allowlist** in main (never a generic proxy): `/api/version`,
  `/api/v1/{status,info,storage,job,cameras}`, `/api/v1/job/<id>[/pause|resume|continue]`,
  `/api/v1/cameras[/<id>]/snap`, `/api/v1/files/…`, `/api/thumbnails/…`, `/thumb/{s,l}/…`.
  Methods: GET, PUT, DELETE, HEAD.

## 3. Endpoints used

| Call | When | Used for |
|---|---|---|
| `GET /api/v1/status` | every 2 s | state, temps, progress, time left, fans, speed/flow, job id, camera id |
| `GET /api/v1/job` | new job id, then every 10 s | file display name, thumbnail ref, G-code metadata |
| `GET /api/v1/info` | once per connection | `mmu`, `serial`, `name`, `nozzle_diameter`, `active_camera` |
| `GET /api/version` | once per connection | firmware / PrusaLink version (debug) |
| `GET <refs.thumbnail>` | when the ref changes | print preview (binary → data URL) |
| `PUT /api/v1/job/<id>/pause` · `/resume` | user, hold 1.2 s | pause / resume (204) |
| `DELETE /api/v1/job/<id>` | user, hold 1.5 s | stop (204) |
| `GET /api/v1/cameras/snap` | every 2 s while shown | PrusaLink-side camera (Pi) |

`status.printer.state` → Studio state: `PRINTING→printing`, `PAUSED→paused`,
`FINISHED→complete`, `STOPPED→cancelled`, `ERROR→error`, `ATTENTION→attention`
(printer waits for a human: runout, MMU failure… — counted as a running job),
`BUSY→busy`, `IDLE→idle`, `READY→ready`.
`status.job.progress` is 0–100; `time_remaining` / `time_printing` are seconds.
`temp_chamber` / `target_chamber` are read when present (Core One, XL).
`status_printer.ok === false` → its `message` is shown as a banner.

## 4. Filament slots

PrusaLink **does not report loaded filament**. Slots are derived:

- `info.mmu === true` → 5 slots (MMU bays 1–5), one "MMU" unit on the board;
- else the model catalog `tools` (`data/printers/prusa_printer_models.json`,
  XL 2T/5T) → T1…Tn;
- else a single `E1`.

While a job runs (and once it is finished) each slot shows what the job
**expects**, from the G-code metadata: `filament_type` and `extruder_colour` /
`filament_colour` (`;`-separated per tool). Otherwise slots are empty. No slot
editing (PrusaLink has no command for it).

## 5. Camera

Two sources, `prusaCameraMode(printer)`:

1. **`rtsp`** — `printer.cameraIp` is set: a **Buddy3D** camera at its own IP,
   `rtsp://<camera-ip>/live`, once *RTSP stream on local network* is switched on
   in the Prusa app / Prusa Connect. No credentials. Main decodes it with the
   bundled ffmpeg into JPEG frames (`prusa:cam-start-rtsp` / `prusa:cam-stop-rtsp`,
   frames on `prusa:cam-frame`).
2. **`snap`** — PrusaLink reports a camera (`status.camera.id` or
   `info.active_camera`): `GET /api/v1/cameras/snap` every 2 s (PNG/JPEG).

One feed per printer for every surface (side card, board, in-app camera wall):
each is an `<img data-prusa-cam="<key>">`; the feed stops itself when none is
left in the document. The detached camera window does not show Prusa yet.

## 6. Discovery

No reliable announce protocol, so the scan sweeps each local /24 (+ the shared
extra subnets) with **one unauthenticated `GET /api/version`** per address
(`prusa:probe`): a 401 Digest challenge (realm "Printer API"), a `Server`
header mentioning PrusaLink, or a 200 with a PrusaLink version = a Prusa.
No credential is sent during a scan. Batches of 24 (local) / 4 (extra), 700 ms
per probe.

## 7. Identity & IP changes

- `info.serial` is saved as `serialNumber` on first connect (authenticated).
- `ensurePrinterIdentity("prusa", …)` adds the ARP `macAddress`.
- A re-find (`printers/refind.js`) matches scan hits by ARP MAC — the scan is
  unauthenticated, so it never sees the serial.

## 8. Errors shown to the user

| Condition | Key |
|---|---|
| 401/403 after the digest retry | `prusaErrAuth` |
| 404 on `/api/v1/status` (pre-v1 PrusaLink) | `prusaErrOldApi` |
| pause/resume/stop refused | `prusaErrCommand` |
| `ATTENTION` state | `prusaAttention` banner |

Debug mode shows every request + answer in the side card's request log.

## 9. To confirm on real hardware (beta checklist)

- Digest realm / qop on Buddy firmware 6.x and on the Pi image.
- `refs.thumbnail` path form on Buddy (`/thumb/l/usb/…`) vs Pi (`/api/thumbnails/…`).
- Metadata key names for per-tool type/colour in `.bgcode` jobs.
- `temp_chamber` naming on Core One / XL.
- Buddy3D RTSP URL and frame rate.
- MMU3 on MK4S / Core One: `info.mmu` true.
