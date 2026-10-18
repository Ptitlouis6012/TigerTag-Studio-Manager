# Printer mocks — fake Klipper and OctoPrint printers for interface tests

Two dependency-free Node scripts in this repository stand in for real printers on
the network, so a client — Tiger Studio itself, **Tiger Touch** (the Panda Touch
firmware), the mobile app — can be tested screen by screen without a machine:

| Mock | Script | Stands in for | Default port |
|---|---|---|---|
| Moonraker | `scripts/moonraker-mock.mjs` | a Klipper printer (Moonraker HTTP API) | 7125 |
| OctoPrint | `scripts/octoprint-mock.mjs` | a Marlin printer behind OctoPrint (REST API) | 5000 |

They implement the endpoints the Studio drivers use, with the shapes of the real
APIs — the references are `renderer/printers/klipper/PROTOCOL.md` and
`renderer/printers/octoprint/PROTOCOL.md`. Everything a client sends is logged on the
mock's console, one line per request.

> **For an agent working on another repository** (Tiger Touch included): the mocks
> live HERE, in `TigerTag_Studio_Manager` (a sibling checkout, `../TigerTag_Studio_Manager`).
> Run them from this repository; do not copy them into yours. Tiger Touch's own rules
> forbid fake-printer code in its tree, and no address of the bench machine may be
> committed anywhere — use placeholders like `<computer-ip>` in anything you write.

---

## 1. Run them

Node 18 or newer, no `npm install` needed. From the root of this repository:

```bash
npm run moonraker:mock -- --profile afc --auto-print          # Klipper, AFC box, printing
npm run octoprint:mock -- --port 5080 --auto-print            # OctoPrint
```

Each prints the addresses another device on the network reaches it at
(`From another device on the LAN: <computer-ip>:7125 …`). Both listen on every
interface. On macOS, accept the firewall prompt the first time; **port 5000 is taken
by AirPlay on macOS** — give the OctoPrint mock another port (`--port 5080`).

### Moonraker mock options

| Option | Effect |
|---|---|
| `--profile plain` (default) | one extruder, no filament changer |
| `--profile happyhare` | Happy Hare MMU, 4 gates (`mmu` object: materials, colours, gate 2 empty, gate 3 "unknown") |
| `--profile afc` | AFC / Box Turtle, 4 lanes (`AFC` + `AFC_stepper laneN`, lane 3 empty, lane 1 loaded) |
| `--port N` | listen on N (several printers = several instances on several ports) |
| `--api-key K` | every API call must carry `X-Api-Key: K` (else 401) |
| `--auto-print` | starts a 3-minute print right away |
| `--spoolman` | Moonraker reports a Spoolman component |

Objects always present: `webhooks`, `print_stats`, `display_status`,
`virtual_sdcard`, `extruder`, `heater_bed`, `toolhead`, `fan`, `gcode_move`,
`filament_switch_sensor runout`, two lights — `output_pin caselight` and
`led chamber_led` — and the extra temperatures a real Klipper box reports:
`temperature_sensor mcu_temp`, `temperature_sensor raspberry_pi`,
`temperature_fan chamber_fan` (target 35 °C) and `heater_generic dryer` (takes
`SET_HEATER_TEMPERATURE HEATER=dryer TARGET=n`).

### OctoPrint mock options

| Option | Effect |
|---|---|
| `--port N` | listen on N |
| `--api-key K` | the key every `/api` call needs (default `octomockkey`) |
| `--tools N` | extruders in the printer profile (default 1) |
| `--auto-print` | starts a 3-minute print right away |
| `--closed` | starts with the serial link down: `/api/printer` answers **409** until `POST /api/connection {"command":"connect"}` |
| `--approve-after S` | Application Keys: the access request is approved after S seconds (default 4) |

---

## 2. Put a mock printer on the account

Clients read the account's printers from Firestore, so the mock has to be added
as a printer first. In **Tiger Studio** (2.41.0 or later):

1. Printers → **+** → type the model in *Find your printer* (or pick **Klipper** /
   **OctoPrint** in the brand list).
2. *Enter IP address* → `<computer-ip>:<port>` of the mock (from its start-up line).
3. Klipper: leave the API key empty unless the mock was started with `--api-key`.
   OctoPrint: the *Say yes in OctoPrint* step fetches the key by itself (the mock
   approves after `--approve-after` seconds).
4. Save. One printer per mock instance.

The record lands in `users/{uid}/printers/{brand}/devices/{id}` (`brand` =
`klipper` or `octoprint`):

| Field | Meaning |
|---|---|
| `ip` | `host[:port]` — the port is part of the address (Klipper defaults to 7125, OctoPrint to 80 when absent) |
| `apiKey` | `X-Api-Key` to send (Klipper: may be empty) |
| `printerName`, `printerModelId` | display; the model id indexes the plugin's `models.json` |
| `id`, `isActive`, `sortIndex`, `updatedAt`, `discovery` | bookkeeping |

A device on the same network as the computer reaches the mock at that `ip` as is.
Remove the test printers from the account when done (Tiger Studio → the printer's
settings → delete).

---

## 3. Drive a scenario

Each mock has a small **scenario API** under `/mock/…` — plain GETs, no API key (it is
the test bench speaking, not a client) — to put the printer in the state a screen
must show, then watch the client follow within one poll (2 s).

### Moonraker

```bash
M=http://<computer-ip>:7125
curl "$M/mock/print?file=benchy.gcode"                     # fresh 3-minute print
curl "$M/mock/set?print=printing&progress=42"               # mid-print, 42 %, layer follows
curl "$M/mock/set?print=paused"
curl "$M/mock/set?print=complete"
curl "$M/mock/set?print=cancelled"
curl "$M/mock/set?print=error&message=Heater%20extruder%20not%20heating"
curl "$M/mock/set?print=standby"                            # idle, no file
curl "$M/mock/set?klippy=startup"                            # Moonraker up, Klipper not ready
curl "$M/mock/set?klippy=error&message=MCU%20'mcu'%20shutdown"
curl "$M/mock/set?klippy=ready"
curl "$M/mock/set?tool=215&bed=60"                           # heating (temperatures converge)
curl "$M/mock/state"                                         # everything, as JSON
```

### OctoPrint

```bash
O=http://<computer-ip>:5080
curl "$O/mock/print?file=benchy.gcode"
curl "$O/mock/set?print=printing&progress=42"
curl "$O/mock/set?print=paused"
curl "$O/mock/set?print=complete"
curl "$O/mock/set?print=cancelling"
curl "$O/mock/set?print=error"
curl "$O/mock/set?print=idle"
curl "$O/mock/set?link=Closed"            # OctoPrint up, printer unplugged → /api/printer 409
curl "$O/mock/set?link=Operational"
curl "$O/mock/set?tool=210&bed=60"
curl "$O/mock/state"
```

### A test matrix that covers the screens

| Screen state | How |
|---|---|
| Idle / standby | fresh start, or `print=standby` / `print=idle` |
| Printing, progress, layers, remaining time | `--auto-print` or `/mock/print`; `progress=` to jump |
| Paused | `print=paused`, or the client's own pause button |
| Finished | `print=complete` (or wait 3 minutes) |
| Cancelled | `print=cancelled` / `cancelling`, or the client's stop button |
| Printer error with a message | `print=error&message=…` (Moonraker), `print=error` (OctoPrint) |
| Firmware not ready (Klipper) | `klippy=startup` / `klippy=error&message=…` |
| Printer not plugged into OctoPrint | `link=Closed`, or start with `--closed` |
| Wrong / missing key | start with `--api-key` and give the client another key → 401 (Klipper) / 403 (OctoPrint) |
| Unreachable | stop the mock (Ctrl-C); start it again to watch the reconnection |
| Filament changer | `--profile happyhare` (4 gates, one empty, one unknown) or `--profile afc` (4 lanes, one empty) |
| Multi-tool | OctoPrint `--tools 2` |
| Several printers at once | several instances, one port each |
| Temperature setpoint change | the client's own setpoint (Tiger Studio: click a temperature), or `tool=` / `bed=` on `/mock/set`; the actual value ramps to the new target |
| Lights (Klipper) | the client's light button → `SET_PIN PIN=caselight` / `SET_LED LED=chamber_led`; check `/mock/state` |

---

## 4. What the mocks accept from a client

| Action | Moonraker | OctoPrint |
|---|---|---|
| Pause / resume / stop | `POST /printer/print/pause` · `/resume` · `/cancel` | `POST /api/job` `{"command":"pause","action":"pause"\|"resume"}` · `{"command":"cancel"}` |
| G-code | `POST /printer/gcode/script {"script":"…"}` — `M104`/`M140`, `M106`/`M107`/`M220`, `G28`, `G90`/`G91`, `G1` (homing required, bounds 300×300×250), `SET_PIN`, `SET_LED`, `MMU_GATE_MAP`, AFC `SET_COLOR` / `SET_MATERIAL` / `SET_SPOOL_ID` / `SET_WEIGHT` / `SET_MAP`, `FIRMWARE_RESTART` | `POST /api/printer/command {"commands":[…]}` — `M106`, `M107`, `M220` |
| Temperature target | `SET_HEATER_TEMPERATURE HEATER=extruder\|heater_bed TARGET=n`, or `M104` / `M140` | `POST /api/printer/tool {"command":"target","targets":{"tool0":n}}` · `POST /api/printer/bed {"command":"target","target":n}` |
| Moves | via G-code | `POST /api/printer/printhead` `{"command":"jog","x":10}` (homing required) · `{"command":"home","axes":["x","y"]}` |
| Camera | `GET /server/webcams/list` → MJPEG `/webcam/?action=stream`, snapshot `/webcam/?action=snapshot` | `GET /api/settings` → `webcam.streamUrl` (relative) / `snapshotUrl` |

A refused command answers with an error message (Moonraker `{"error":{"message":…}}`,
OctoPrint `{"error":…}`) — e.g. a jog on an axis that is not homed — which is how a
client's error path gets exercised.

---

## 5. Limits

- The camera is a still picture sent as an MJPEG stream (one frame a second).
- A print is a 3-minute simulation: progress, layers (240), heaters converging to
  their targets; there is no real G-code file.
- HTTP only: no Moonraker WebSocket (Snapmaker's driver needs one — not covered),
  no TLS, no OctoPrint SockJS push.
- The scenario API has no key on purpose; never expose a mock beyond a trusted
  network.
- Not a conformance test: a behaviour seen against a mock is "seen against the
  mock", never "works on a real printer" — say so in any compatibility table.
