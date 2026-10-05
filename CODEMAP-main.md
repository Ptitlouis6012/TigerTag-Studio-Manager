# `main.js` — code map

`main.js` is the **Electron main process** (~3,784 lines): app/window lifecycle,
the static file server, NFC/RFID, TD1S sensor, auto-updater, and the per-brand
printer **discovery probes + MQTT/HTTP/camera bridges** (the renderer can't open
raw TLS/UDP/MQTT sockets, so every printer transport lives here behind IPC).

**Anchor-first navigation**: line numbers drift, anchor names don't. Always
`grep -n "anchorName"` (or `grep -n "ipcMain.*'channel'"`) and trust the grep
over the L-number here — the L-ranges are for orientation only.

Keep in sync: `npm run codemap:check` (pre-commit hook) validates that each
section's function anchors fall inside its declared range.

> **IPC channels** are listed for orientation but are NOT range-checked (they
> contain `:` / `-`, so the checker skips them); only the backticked **function
> names** in the Anchors column are verified.

---

## Bird's-eye structure

```
L1-442       App bootstrap — logging, single-instance, static HTTP server, splash, main window
L443-1137    NFC / RFID — reader lifecycle, chip read/write/burn, cloud-encode
             (USB scale HID transport block inlined at L626-716)
L1138-1379   TD1S color sensor — serial watcher, parse, IPC replay
L1380-1553   Auto-updater + migration gate
L1554-1749   Google-auth loopback, shell open, detached camera-wall window
L1750-2471   Printer discovery probes (FlashForge / Creality / Bambu / Elegoo / Snapmaker)
L2473-2628   Infra IPC — image cache, LAN subnets, mDNS, app info, TigerTag DB
L2629-2765   Elegoo MQTT bridge + timelapse download + ffmpeg detection
L2766-3019   Bambu Lab — MQTT (8883) + JPEG-TCP (6000) & RTSP (322) cameras
L3020-3343   Anycubic LAN — MQTT (9883) + slicer-config provisioning + FLV camera (18088)
L3344-3809   Anycubic cloud — signed REST + shared cloud-MQTT (publish + subscribe)
L3810-3870   App lifecycle (whenReady, window-all-closed, activate)
```

---

## App bootstrap, static server, splash & main window (L180-418)

| L | What | Anchors |
|---|---|---|
| 116-235 | Minimal static file server so `location.protocol === 'http:'` (Firebase Auth needs it) | `startRendererServer` |
| 236-310 | Splash window (data-URL HTML) shown before the main window paints | `createSplash`, `revealMainWindow` |
| 311-335 | UID hex→decimal + TigerTag SDK payload builder | `normalizeUid`, `_sdkPayload` |
| 336-442 | `BrowserWindow` creation, preload wiring, CSP, devtools | `createWindow` |

## NFC / RFID reader + chip write (L563-1560)

| L | What | Anchors / IPC |
|---|---|---|
| 443-625 | Reader connect/disconnect lifecycle, card-present events, auto-read | `_onNfcMessage`, `initNFC` |
| 626-716 | USB scale (Dymo M-series) — HID open + hot-plug poll, frame decode, `usb-scale-update` / `usb-scale-data` events, `usb-scale:state` IPC | `_scaleDecode`, `_tryOpenScale`, `initUsbScale` |
| 717-1137 | IPC: `rfid:read-now` / `rfid:write-now` / `rfid:repair` (restore from backup) / `rfid:format` (reinitialize via `TigerTag.asInit`) / `rfid:encode-cloud` / `rfid:burn-one` / `rfid:refresh-api` / `rfid:lookup-product`; surgical page diff before write | `_pagesFromBytes`, `_pagesToWrite` |
| 1281-1333 | IPC `catalog:fetch-all` — pages the WHOLE product catalogue (`product/get/all`, `per_page` 1000, follows `nextPage`) so the renderer can cache and search it offline | `XANO_PRODUCT_ALL_URL` |

## TD1S color sensor (L1505-1746)

| L | What | Anchors / IPC |
|---|---|---|
| 1505-1746 | Serial-port watcher, TD/color line parse, state replayed to renderer on reload; IPC `td1s:need` / `td1s:release` | `initTD1S` |

## Auto-updater + migration gate (L1977-2115)

| L | What | Anchors / IPC |
|---|---|---|
| 1977-1999 | Auto-update on/off preference (on disk) | `readAutoUpdatePref`, `writeAutoUpdatePref` |
| 2000-2115 | Updater event wiring; IPC: `migration:set-in-flight`, `install-update`, `update:set-auto` | `wireUpdaterEvents`, `initUpdater` |

## Google auth loopback, shell, detached cam window (L1554-1749)

| L | What | IPC |
|---|---|---|
| 1554-1702 | Google OAuth loopback sign-in (`auth:google-loopback`); `shell:open-external` | — |
| 1893-1939 | Detached camera-wall `BrowserWindow` (`cam:open-detached`); `update:check-now` | — |

## Local MCP server — prefs, renderer relay, IPC (L1694-1880)

| L | What | IPC |
|---|---|---|
| 1694-1880 | Read-only MCP server for AI assistants: `<userData>/mcp.json` prefs (enabledFor [uid] / port 5795 / token; server follows the signed-in account via `mcp:set-account`), stdio bridge copied to `<userData>/mcp/`, `tools/call` relayed to the renderer, started by `initMcp()` at boot. Protocol: `services/mcpServer.js` | `mcp:get-config`, `mcp:set-account`, `mcp:set-enabled`, `mcp:new-token`, `mcp:register-tools`, `mcp:call` / `mcp:result` |

## Printer discovery probes (L2395-3130)

| L | What | Anchors / IPC |
|---|---|---|
| 2395-2531 | FlashForge — HTTP POST bridge (`ffg:http-post`), UDP multicast (`ffg:multicast-discover`) | — |
| 2532-2615 | FlashForge — UDP identity probe port 19000 (`ffg:udp-probe`, returns model+serial credential-free), TCP M115 probe (`ffg:tcp-probe`) | `_ffgParseUdpIdentity` |
| 2616-2700 | Creality — TCP 9999 open-check (`cre:tcp-probe`) | — |
| 2701-2900 | Bambu Lab — SSDP multicast (`bambu:ssdp-discover`) + TLS cert sniff (`bambu:tls-probe`) + print thumbnail via FTPS | `_parseBambuSsdp` |
| 2901-3015 | Elegoo — UDP discovery/probe (`elegoo:udp-discover` / `elegoo:udp-probe`) | `_parseElegooReply` |
| 3016-3065 | Snapmaker — HTTP GET bridge (`snap:http-get`) | — |
| 3066-3130 | Creality — Moonraker HTTP IPC port 7125, live controls (`cre:http`) | — |

## Infra IPC — image cache, subnets, mDNS, app info, DB (L2663-2818)

| L | What | IPC |
|---|---|---|
| 2663-2717 | Image disk cache (`img:get`) | — |
| 2718-2808 | LAN /24 subnet list (`net:get-local-subnets`), MAC behind a LAN IP from the OS ARP cache, directly attached subnets only (`net:arp-mac`), mDNS Snapmaker browse (`mdns:browse-snapmaker`) | — |
| 2808-2818 | App/platform info for diagnostics (`app:info`, `app:renderer-path`); TigerTag DB lookups (`db:*`) | — |

## Elegoo MQTT bridge + timelapse + ffmpeg (L2819-2955)

| L | What | IPC |
|---|---|---|
| 3247-3276 | Timelapse video download (`timelapse:download`) | — |
| 3277-3349 | Elegoo MQTT 1883 bridge (`elegoo:connect` / `disconnect` / `publish`) | — |
| 3350-3404 | Shared `ffmpeg` binary detection (Bambu RTSP + Anycubic FLV cameras) — each candidate is PROBED, not just stat'ed | — |

## Bambu Lab — MQTT + JPEG-TCP/RTSP cameras (L3405-3673)

| L | What | Anchors / IPC |
|---|---|---|
| 3405-3465 | MQTTS 8883 control bus (`bambulab:connect` / `disconnect` / `publish`) | — |
| 3466-3555 | JPEG-TCP camera, port 6000 (`bambulab:cam-start` / `cam-stop`) — 80-byte auth packet, retry/timeout | `_bambuCamAuthPacket` |
| 3556-3673 | RTSP camera via ffmpeg, port 322 (`bambulab:cam-start-rtsp` / `cam-stop-rtsp`) — 30 fps + low-latency flags; the spawn is guarded (it throws synchronously on a bad CPU type) | — |

## Bambu Lab cloud — REST + shared cloud MQTT (L3674-4220)

| L | What | Anchors / IPC |
|---|---|---|
| 3674-3766 | Tolerant REST helper over ELECTRON's `net` — Chromium's stack on purpose, because the login sits behind Cloudflare, which reads the TLS fingerprint | `_bblFetch`, `_bblHeaders` |
| 3767-3890 | Auth: `cloud-send-code`, `cloud-login` (code / password, `verifyCode` + `tfa` branches), `cloud-tfa` (token arrives in a COOKIE), `cloud-uid` (token is NOT a JWT), `cloud-bind` (machines + their LAN access codes), `cloud-device-version` | — |
| 3891-3991 | ONE cloud-MQTT client per ACCOUNT: `cloud-connect` (us→eu fallback), `cloud-subscribe` (+ `pushall`), `cloud-publish`, `cloud-unsubscribe`, `cloud-disconnect`. Telemetry is emitted on the LAN `bambulab:message` channel — same payload, same parser | `_bblCloudOpen`, `_bblCloudPushAll` |

## Anycubic LAN — MQTT, provisioning, FLV camera (L4211-4547)

| L | What | Anchors / IPC |
|---|---|---|
| 3210-3296 | MQTTS 9883 control bus, TLS 1.2 (`anycubic:connect` / `disconnect` / `publish`) | — |
| 3297-3402 | FLV camera via ffmpeg, port 18088 (`anycubic:cam-start` / `cam-stop`) — URL-aware (`/flv` or `/live/<token>`) | — |
| 3403-3425 | Slicer on-disk credential reader (`anycubic:read-slicer-config`) — keyless deobfuscation | `_acuDeobfuscate`, `_acuConfCandidates` |
| 3426-3533 | LAN scan: TCP probe (`anycubic:tcp-probe`), FLV liveness (`anycubic:flv-probe`, accepts 200/206), `/info` (`anycubic:http-info`) | — |

## Anycubic cloud — REST + cloud MQTT (L4548-5023)

| L | What | Anchors / IPC |
|---|---|---|
| 3534-3606 | Signed REST helpers (`Xx-Signature` md5, `XX-Token`) | `_cloudHeaders`, `_cloudFetch` |
| 3607-3718 | Web login (`anycubic:cloud-web-login`) + CDP token grab (`anycubic:cloud-cdp-token`) from a bridge-mode slicer | `_cdpEvaluate` |
| 3719-3857 | REST: `cloud-get-printers`, `cloud-printer-info` (temps + thumbnail + latest project), `cloud-verify`, `cloud-send-order`, `cloud-camera-open` (order 1001 → Agora "shengwang" creds) | — |
| 3858-3894 | Cloud-uploaded files (§9c): `cloud-files-list` (POST `/work/index/files`), `cloud-file-delete` (POST `/work/index/delFiles`); print reuses `cloud-send-order` order 1 | — |
| 3895-3999 | Shared cloud-MQTT client (one per user): `cloud-connect` / `subscribe` / `publish` / `unsubscribe`; RSA-encrypted token login | `_buildCloudLogin`, `_routeCloudMessage`, `_ensureCloudClient` |

## App lifecycle (L5024-5089)

| L | What |
|---|---|
| 5024-5089 | `app.whenReady` (img cache dir, server, window, NFC/TD1S/updater init), `window-all-closed`, `activate` |
