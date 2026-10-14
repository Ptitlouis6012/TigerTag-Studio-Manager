/**
 * printers/klipper/main.cjs — Klipper plugin, MAIN-PROCESS side.
 *
 * Loaded by main.js's printer-plugin loader (every renderer/printers/<id>/main.cjs),
 * which calls register() once with the channel namer for this plugin. The
 * renderer reaches it through preload's generic bridge:
 *   window.printerPlugin.invoke("klipper", "http",  { host, method, path, body, apiKey, binary, timeoutMs })
 *   window.printerPlugin.invoke("klipper", "probe", host, timeoutMs)
 *
 * Why main: Moonraker only answers browser origins listed in `cors_domains`,
 * and the API key travels in a header. Node has neither problem. The handler is
 * NOT a generic proxy — only the Moonraker paths the plugin uses are allowed.
 * Self-contained: requires nothing from another printer plugin.
 */
'use strict';

const DEFAULT_PORT = 7125;
const HTTP_TIMEOUT_MS = 6000;
const ALLOWED = [
  /^\/server\/info$/,
  /^\/printer\/info$/,
  /^\/machine\/system_info$/,
  /^\/printer\/objects\/(list|query)$/,
  /^\/printer\/print\/(start|pause|resume|cancel)$/,
  /^\/printer\/gcode\/script$/,
  /^\/printer\/firmware_restart$/,
  /^\/server\/webcams\/list$/,
  /^\/server\/files\/(list|metadata|thumbnails)$/,
  /^\/server\/files\/gcodes\/[^?#]+$/,
  /^\/server\/spoolman\/(status|spool_id)$/,
  /^\/webcam\d*\/?$/,
];

/** "192.168.1.40" | "192.168.1.40:7126" | "voron.local" → "host:port", or null. */
function normHost(raw) {
  const s = String(raw || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!/^[\w.\-]+(:\d{1,5})?$/.test(s)) return null;
  return /:\d+$/.test(s) ? s : `${s}:${DEFAULT_PORT}`;
}

async function request({ host, method = 'GET', path: p = '', body = null, apiKey = '', binary = false, timeoutMs }) {
  const h = normHost(host);
  if (!h) return { ok: false, status: 0, error: 'invalid host' };
  const m = String(method).toUpperCase();
  if (!['GET', 'POST', 'DELETE'].includes(m)) return { ok: false, status: 0, error: 'method not allowed' };
  const uri = String(p);
  if (!ALLOWED.some(rx => rx.test(uri.split('?')[0]))) return { ok: false, status: 0, error: 'path not allowed' };
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), Math.min(Number(timeoutMs) || HTTP_TIMEOUT_MS, 20000));
  try {
    const headers = { Accept: binary ? '*/*' : 'application/json' };
    if (apiKey) headers['X-Api-Key'] = String(apiKey);
    if (body != null) headers['Content-Type'] = 'application/json';
    const res = await fetch(`http://${h}${uri}`, {
      method: m, headers, body: body != null ? JSON.stringify(body) : undefined, signal: ctl.signal,
    });
    const contentType = res.headers.get('content-type') || '';
    if (binary) {
      const buf = Buffer.from(await res.arrayBuffer());
      return { ok: res.ok, status: res.status, contentType, data: res.ok ? buf.toString('base64') : null };
    }
    let json = null;
    try { json = await res.json(); } catch (_) { /* empty or non-JSON body */ }
    // Moonraker wraps answers as { result } and failures as { error: { message } }.
    const error = res.ok ? null : (json?.error?.message || `HTTP ${res.status}`);
    return { ok: res.ok, status: res.status, json, result: json?.result ?? null, error };
  } catch (e) {
    return { ok: false, status: 0, error: e?.name === 'AbortError' ? 'timeout' : (e?.message || String(e)) };
  } finally {
    clearTimeout(tm);
  }
}

/** Is there a Moonraker at this address? Never sends a credential. */
async function probe(host, timeoutMs) {
  const r = await request({ host, path: '/server/info', timeoutMs: Math.min(Number(timeoutMs) || 2500, 8000) });
  if (r.status === 401 || r.status === 403) return { moonraker: true, needsAuth: true, host: normHost(host) };
  const info = r.result;
  if (!r.ok || !info || (info.klippy_state == null && info.moonraker_version == null)) return { moonraker: false };
  return {
    moonraker: true, needsAuth: false, host: normHost(host),
    klippyState: info.klippy_state || null, version: info.moonraker_version || null,
    components: Array.isArray(info.components) ? info.components : [],
  };
}

module.exports.register = ({ ipcMain, channel }) => {
  ipcMain.handle(channel('http'), (_evt, opts) => request(opts || {}));
  ipcMain.handle(channel('probe'), (_evt, host, timeoutMs) => probe(host, timeoutMs));
};
