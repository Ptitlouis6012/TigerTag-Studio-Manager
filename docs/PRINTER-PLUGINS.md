# Printer plugins

A printer integration is a **self-contained folder**, `renderer/printers/<id>/`,
in the spirit of a Home Assistant integration: its own connection core, cards,
camera, discovery, add flow, styles, model catalogue, strings and — when it needs
one — its own main-process side. Studio only hosts it.

**The rule:** a plugin imports **host services only**. It never imports, calls or
reuses another plugin's or brand's files. Two Moonraker printers (Klipper and
Snapmaker) each carry their own Moonraker code on purpose: one can change, break
or be removed without touching the other.

> Status: **Klipper** and **OctoPrint** (Marlin) are plugins. The seven historical brands
> (bambulab, creality, elegoo, flashforge, snapmaker, anycubic, prusa) predate
> this contract and are still wired by hand in `inventory.js`; they move to it
> one at a time.

## Anatomy

```
renderer/printers/<id>/
  plugin.js     entry point — calls registerPrinterPlugin({...})      (required)
  main.cjs      main-process side, loaded by main.js at start-up      (optional)
  PROTOCOL.md   the protocol reference an agent reads before editing  (expected)
  *.js          whatever the plugin needs (core, cards, camera, add flow, probe)
  *.css         injected by the host (`css` in the manifest)
  models.json   model catalogue; `image` paths are relative to this file
  img/          pictures, logo
```

## Host services a plugin may import

| Module | What for |
|---|---|
| `../plugins.js` | `registerPrinterPlugin` |
| `../context.js` | `ctx` — `t`, `esc`, `toast`, `getState`, `getActivePrinter`, `setupHoldToConfirm`, `openPrinterSettings`, `openBrandPicker`, `onPrinterGridChange`, `onGridJobsChange`, `onPrinterStatusChange`, `requestPrinterRefind`, `isForcedOffline`, `printerImageUrl(For)`, `findPrinterModel`, `snapTextColor`, `SNAP_ICON_*` |
| `../registry.js` | `brands` (read-only) |
| `../modal-helpers.js` | `schemaWidget(schema)` — the settings form |
| `../scan-pick.js` | tick-several-then-add scan results |
| `../extra-subnets.js` | the user's extra subnets to scan |
| `../job-bar.js` | `jobBar`, `jobBarFill` — the shared progress bar memory |
| `../identity.js` | `ensurePrinterIdentity` — ARP MAC for a re-find after a DHCP change |
| `../beta-badge.js` | `betaBadgeHtml()` — the Beta tag + ⓘ bubble at the top of a beta printer's live block |

Shared CSS classes (`snap-*`, `pba-*`, `pp-*`, `ffg-chip`, `cre-action-btn`) are
the host's card vocabulary; use them so every printer reads the same.

## The manifest — `registerPrinterPlugin(def)`

```js
registerPrinterPlugin({
  id: "klipper",                       // [a-z0-9-]+ ; also the Firestore brand id
  meta:   { label, accent, connection, beta },
  schema, helper,                      // settings form + "before you start" box
  css:    new URL('x.css', import.meta.url).href,
  models: new URL('models.json', import.meta.url).href,
  logo:   true,                        // the CSS defines .pt-thumb-logo / .pba-brand-logo [data-brand=id]
  i18n:   { key: { en, fr, de, es, it, zh, pt, "pt-pt", pl, ru, nl } },
  identity: { field, fromDiscovery, probe },   // see identity.js

  // lifecycle — called generically by the host
  key(p), getConn(p), status(p), isOnline(p),          // isOnline: true | false | null (unknown)
  connect(p), disconnect(p), reconnect(p), ping(p), stopAll(),
  job(p),   // → { conn, state, pct 0-100, filename, remainSec, thumbUrl, layer, layerTotal, paused } | null

  // UI
  renderLive(p), wireLive(root, p),    // host div id `<id>Live`
  renderLog(p), logCount(p),           // debug mode only, host div id `<id>Log`
  renderOnlineBadge(p, "card"|"side"),
  renderCamBanner(p, wall), hasCamera(p),
  openAddFlow(),                        // from the brand picker

  // the registry hooks every brand has
  controlJob(p, "pause"|"resume"|"stop"), getTempHtml(p), getSlots(p), getUnits(p),
  renderJobCard, renderTempCard, renderFilamentCard, renderSettingsWidget,
});
```

Strings: plugin keys are merged into the loaded locales (`mergePluginStrings`),
never overriding an app key; English is the fallback. Prefix them with the
plugin id. Same brand voice as the rest of the app (register 3), all 11 locales.

## Main-process side — `main.cjs`

```js
module.exports.register = ({ ipcMain, channel }) => {
  ipcMain.handle(channel('http'), (_e, opts) => request(opts));   // → "printer:<id>:http"
};
```

`main.js` loads every `renderer/printers/*/main.cjs` at start-up; a failure is
logged and skipped, never fatal. The renderer reaches it through preload's
generic bridge, `window.printerPlugin.invoke(id, name, ...args)`, which only
forwards `printer:<id>:<name>`. **Never write a generic proxy** — allow-list the
exact paths the protocol needs (see `klipper/main.cjs`). No credential is ever
logged or sent during discovery.

## Adding a plugin

1. Create the folder and its `PROTOCOL.md`.
2. Write `plugin.js` (+ `main.cjs` if the printer needs the main process).
3. Add **one** import line at the bottom of `renderer/printers/plugins.js`.
4. Test without hardware when you can (a mock like `scripts/moonraker-mock.mjs`).
5. Backend: add the id to `PRINTER_BRANDS` in the backend repo's functions
   (printer XP achievement, community stats) and deploy.

Firestore needs nothing: `users/{uid}/printers/{brand}/devices/{id}` is covered
by the generic rule, whatever the brand.
