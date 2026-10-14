/**
 * printers/bambulab/failover.js — automatic Cloud ⇄ LAN failover.
 *
 * A printer added through the Bambu account (doc id `cloud_<devId>`) can be
 * reached both ways (see mode-switch.js). When the way it is set to stops
 * answering, the other one is tried quietly, and the printer is moved over only
 * if that one answers:
 *
 *   Cloud down → LAN probe: a throw-away local MQTT session (key `probe:<key>`)
 *                with the stored address, serial and access code; a report back
 *                within PROBE_MS means the local broker works.
 *   LAN down   → Cloud probe: the account's device list (`cloud-bind`) says
 *                whether the cloud sees the machine online.
 *
 * A printer the account no longer lists (switching it to LAN-only mode on its
 * screen unbinds it from the Bambu cloud) is flagged instead: Cloud cannot work
 * until it is bound again in Bambu Handy / Bambu Studio, and the live block says
 * so (bambuCloudUnbound).
 *
 * While on Cloud, the record is kept in step with what the account reports — on
 * every new connection, then every CODE_SYNC_MS: the name, the access code (the
 * printer issues a new one when its LAN mode is toggled, and the local camera
 * and any later LAN fallback need the current one), the model. The address
 * comes from the printer's own telemetry (index.js, _bblAdoptLanAddress). The
 * user never has to type any of it (syncFromCloud).
 *
 * "Down" = not connected for DOWN_MS in a row (a report is what makes a Bambu
 * connection "connected", so a cloud subscription to a printer in LAN-only mode
 * stays down). A printer the user disconnected by hand is left alone, and after
 * a switch the printer is not moved again for COOLDOWN_MS — no ping-pong while a
 * network is flapping.
 */
import { ctx } from '../context.js';
import { bambuKey, bambuGetConn, bambuConnect, bambuDisconnect, bambuIsCloud, bambuUsesJpegCam, bambuStopCam } from './index.js';
import { bambuCanSwitchMode } from './mode-switch.js';
import { bambuModelIdFromCode } from './probe.js';

const TICK_MS = 10_000;
const DOWN_MS = 45_000;
const PROBE_MS = 10_000;
const RETRY_MS = 60_000;      // between two probes of the same printer
const COOLDOWN_MS = 180_000;  // after a switch
const CODE_SYNC_MS = 300_000; // account re-read while connected, per printer

const _down = new WeakMap();      // conn → first tick it was seen down
const _lastProbe = new Map();     // key → ms
const _lastSwitch = new Map();    // key → ms
const _busy = new Set();          // keys being probed / switched
const _unbound = new Set();       // keys the account's device list no longer holds
const _codeSync = new Map();      // key → last account read (ms)
const _synced = new WeakSet();    // connections already read once

/** Does the Bambu account no longer list this printer (so Cloud cannot reach it)? */
export const bambuCloudUnbound = key => _unbound.has(key);

function setUnbound(p, yes) {
  const key = bambuKey(p);
  if (yes === _unbound.has(key)) return;
  if (yes) _unbound.add(key); else _unbound.delete(key);
  ctx.onPrinterStatusChange?.(key, bambuGetConn(key)?.status ?? null);
}

// ── LAN probe: a separate MQTT session, answered on the shared IPC channel ──
const _probes = new Map();        // "probe:<key>" → resolve
if (typeof window !== "undefined" && window.bambulab) {
  window.bambulab.onMessage(key => { const done = _probes.get(key); if (done) done(true); });
  window.bambulab.onStatus((key, status) => {
    const done = _probes.get(key);
    if (done && /^error/.test(String(status))) done(false);
  });
}

function probeLan(p) {
  const ip = String(p.broker || p.ip || "").trim(), serial = p.serialNumber || "", password = p.password || "";
  if (!ip || !serial || !password || !window.bambulab?.connect) return Promise.resolve(false);
  const key = `probe:${bambuKey(p)}`;
  return new Promise(resolve => {
    let settled = false;
    const finish = ok => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      _probes.delete(key);
      try { window.bambulab.disconnect(key); } catch (_) {}
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), PROBE_MS);
    _probes.set(key, finish);
    window.bambulab.connect({ key, ip, serial, password });
    // A report only comes when asked for one.
    setTimeout(() => {
      try { window.bambulab.publish(key, { pushing: { sequence_id: "0", command: "pushall" } }); } catch (_) {}
    }, 1500);
  });
}

/** → { listed, online, accessCode }, or null when the account could not be asked. */
async function probeCloud(p) {
  const sess = await ctx.getBambuCloudSession?.();
  if (!sess?.accessToken || !window.bambulab?.cloud?.bind) return null;
  try {
    const r = await window.bambulab.cloud.bind({ token: sess.accessToken, region: sess.region });
    if (!r?.ok) return null;
    const d = (r.devices || []).find(x => x.devId === p.serialNumber);
    return { listed: !!d, online: !!d?.online, accessCode: d?.accessCode || "", name: d?.name || "", modelCode: d?.modelCode || "" };
  } catch (_) { return null; }
}

/**
 * Bring the record in line with the account: every field that differs is
 * written in one go. A new access code also restarts an open camera with it.
 */
async function syncFromCloud(p, cloud) {
  if (!cloud?.listed) return;
  const key = bambuKey(p);
  const conn = bambuGetConn(key);
  const patch = {};
  if (cloud.name && cloud.name !== p.printerName) patch.printerName = cloud.name;
  if (cloud.accessCode && cloud.accessCode !== p.password) patch.password = cloud.accessCode;
  if (cloud.modelCode && cloud.modelCode !== p.modelCode) patch.modelCode = cloud.modelCode;
  const modelId = bambuModelIdFromCode(cloud.modelCode, p.serialNumber);
  if (modelId && modelId !== "0" && String(modelId) !== String(p.printerModelId)) patch.printerModelId = String(modelId);
  if (!Object.keys(patch).length) return;
  await ctx.savePrinterFields?.("bambulab", p.id, patch);
  if (patch.password && conn) {
    conn.password = patch.password;
    const active = ctx.getActivePrinter?.();
    if (conn.ip && active && bambuKey(active) === key) {
      bambuStopCam(key);
      if (bambuUsesJpegCam(p)) window.bambulab?.camStart({ key, ip: conn.ip, password: patch.password });
      else window.bambulab?.camStartRtsp({ key, ip: conn.ip, password: patch.password });
    }
  }
}

// ── The switch itself ────────────────────────────────────────────────────
async function switchTo(p, mode) {
  const key = bambuKey(p);
  await ctx.saveBambuMode?.(p, mode);
  _lastSwitch.set(key, Date.now());
  bambuDisconnect(key);
  // Reconnect once the snapshot carries the new mode (the settings form's path).
  const start = Date.now();
  let fresh = null;
  while (Date.now() - start < 4000) {
    fresh = (ctx.getState?.().printers || []).find(x => bambuKey(x) === key);
    if (fresh && bambuIsCloud(fresh) === (mode === "cloud")) break;
    await new Promise(r => setTimeout(r, 100));
  }
  if (fresh) bambuConnect(fresh);
  const name = p.printerName || p.name || "Bambu Lab";
  try { ctx.toast?.(ctx.t(mode === "lan" ? "bblAutoSwitchLan" : "bblAutoSwitchCloud", { name }), "info"); } catch (_) {}
  ctx.onPrinterStatusChange?.(key, null);
}

async function check(p) {
  const key = bambuKey(p);
  const conn = bambuGetConn(key);
  if (!conn || _busy.has(key) || ctx.isForcedOffline?.(key)) return;
  const now = Date.now();
  if (conn.status === "connected") {
    _down.delete(conn);
    if (conn.cloud) {
      setUnbound(p, false);
      // Right after each new connection, then every CODE_SYNC_MS.
      if (!_synced.has(conn) || now - (_codeSync.get(key) || 0) >= CODE_SYNC_MS) {
        _synced.add(conn);
        _codeSync.set(key, now);
        _busy.add(key);
        try { await syncFromCloud(p, await probeCloud(p)); } finally { _busy.delete(key); }
      }
    }
    return;
  }
  if (!_down.has(conn)) { _down.set(conn, now); return; }
  if (now - _down.get(conn) < DOWN_MS) return;
  if (now - (_lastSwitch.get(key) || 0) < COOLDOWN_MS) return;
  if (now - (_lastProbe.get(key) || 0) < RETRY_MS) return;
  _lastProbe.set(key, now);
  _busy.add(key);
  try {
    const target = conn.cloud ? "lan" : "cloud";
    // Whichever way it is set, ask the account whether it still holds the machine.
    const cloud = await probeCloud(p);
    if (cloud) setUnbound(p, !cloud.listed);
    // A new code from the account is what the LAN probe needs, too.
    if (cloud?.listed) { await syncFromCloud(p, cloud); if (cloud.accessCode) p = { ...p, password: cloud.accessCode }; }
    const ok = target === "lan" ? await probeLan(p) : !!cloud?.online;
    // Still down, still the same connection, and the other way answered.
    const still = bambuGetConn(key);
    if (ok && still === conn && still.status !== "connected" && !ctx.isForcedOffline?.(key)) await switchTo(p, target);
    // Stuck on a Cloud that cannot see the machine, and no LAN to fall back on: say why, once.
    else if (conn.cloud && _unbound.has(key)) {
      const name = p.printerName || p.name || "Bambu Lab";
      try { ctx.toast?.(ctx.t("bblCloudUnbound", { name }), "error"); } catch (_) {}
    }
  } finally {
    _busy.delete(key);
  }
}

setInterval(() => {
  for (const p of ctx.getState?.().printers || []) if (bambuCanSwitchMode(p)) check(p);
}, TICK_MS);

/* Debug handle, same spirit as window.__bbl: read-only state + the two probes. */
if (typeof window !== "undefined") window.__bblFailover = { lastProbe: _lastProbe, lastSwitch: _lastSwitch, busy: _busy, unbound: _unbound, probeLan, probeCloud,
  cloudList: async () => { const s = await ctx.getBambuCloudSession?.(); if (!s?.accessToken) return { session: false, keys: Object.keys(s || {}) }; const r = await window.bambulab.cloud.bind({ token: s.accessToken, region: s.region }); return { ok: r?.ok, error: r?.error, devices: (r?.devices || []).map(d => ({ devId: d.devId, online: d.online, name: d.name })) }; } };
