/**
 * printers/octoprint/main.cjs — OctoPrint plugin, MAIN-PROCESS side.
 *
 * Loaded by main.js's printer-plugin loader. The renderer reaches it through
 * preload's generic bridge:
 *   window.printerPlugin.invoke("octoprint", "http",  { host, method, path, body, apiKey, binary, timeoutMs })
 *   window.printerPlugin.invoke("octoprint", "probe", host, timeoutMs)
 *
 * Why main: OctoPrint sends no CORS headers for arbitrary origins, and the API
 * key travels in a header. Not a generic proxy — only the paths the plugin uses
 * are allowed. Self-contained: requires nothing from another printer plugin.
 */
'use strict';

const HTTP_TIMEOUT_MS = 6000;
const ALLOWED = [
  /^\/api\/(version|connection|printer|job|settings|printerprofiles)$/,
  /^\/api\/printer\/(printhead|command|tool|bed|chamber)$/,
  /^\/api\/files\/(local|sdcard)\/[^?#]+$/,
  /^\/plugin\/appkeys\/(probe|request)$/,
  /^\/plugin\/appkeys\/request\/[A-Za-z0-9_-]+$/,
  /^\/plugin\/[A-Za-z0-9_]*thumbnails?\/thumbnail\/[^?#]+$/i,
];

/** "192.168.1.30" | "octopi.local" | "192.168.1.30:5000" → "host[:port]", or null. Port 80 by default (OctoPi). */
function normHost(raw) {
  const s = String(raw || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return /^[\w.\-]+(:\d{1,5})?$/.test(s) ? s : null;
}

async function request({ host, method = 'GET', path: p = '', body = null, apiKey = '', binary = false, timeoutMs }) {
  const h = normHost(host);
  if (!h) return { ok: false, status: 0, error: 'invalid host' };
  const m = String(method).toUpperCase();
  if (!['GET', 'POST', 'DELETE'].includes(m)) return { ok: false, status: 0, error: 'method not allowed' };
  const uri = String(p).startsWith('/') ? String(p) : `/${p}`;
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
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { /* plain-text error page */ }
    const error = res.ok ? null : (json?.error || text.slice(0, 200) || `HTTP ${res.status}`);
    return { ok: res.ok, status: res.status, json, error };
  } catch (e) {
    return { ok: false, status: 0, error: e?.name === 'AbortError' ? 'timeout' : (e?.message || String(e)) };
  } finally {
    clearTimeout(tm);
  }
}

/** Is there an OctoPrint at this address? Never sends a credential. */
async function probe(host, timeoutMs) {
  const t = Math.min(Number(timeoutMs) || 2500, 8000);
  const ak = await request({ host, path: '/plugin/appkeys/probe', timeoutMs: t });
  if (ak.status === 204) return { octoprint: true, appKeys: true, host: normHost(host) };
  const v = await request({ host, path: '/api/version', timeoutMs: t });
  if (v.ok && /octoprint/i.test(String(v.json?.text || v.json?.server || ''))) {
    return { octoprint: true, appKeys: false, host: normHost(host), version: v.json?.server || null };
  }
  // A bare 401/403 is not taken as proof: routers and NAS boxes answer it too.
  return { octoprint: false };
}

module.exports.register = ({ ipcMain, channel }) => {
  ipcMain.handle(channel('http'), (_evt, opts) => request(opts || {}));
  ipcMain.handle(channel('probe'), (_evt, host, timeoutMs) => probe(host, timeoutMs));
};
