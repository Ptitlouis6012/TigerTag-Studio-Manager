/**
 * printers/elegoo/probe.js — Network discovery layer for Elegoo printers.
 *
 * Pure data layer — no DOM, no UI. Calls main-process IPC:
 *   - elegooUdpDiscover(prefixes) — single-shot UDP unicast spray of
 *     {"id":0,"method":7000} to ip:52700 across each /24 prefix. Returns all
 *     candidates after the 2.4 s listen window. Mirrors the Flutter scanner.
 *   - elegooUdpProbe(ip)          — targeted single-IP probe (two sends 60 ms
 *     apart, 1.4 s listen) for manual "Add by IP".
 *
 *   - elegooSdcpDiscover / elegooSdcpProbe — the SAME two gestures for SDCP
 *     printers (Centauri Carbon 1): `M99999` on UDP 3000. Run in parallel with
 *     the MQTT probe; each candidate carries `protocol: "mqtt" | "sdcp"`.
 *
 * Discovery is keyed on the source IP of the reply; the sn (mainboard serial)
 * is REQUIRED for MQTT connection later, so we surface it in the candidate.
 * An SDCP printer needs nothing but its IP (its MainboardID comes with it).
 */

const ELG_SCAN_EXPECTED_MS = 3500;   // for the smooth progress animation
const ELG_COMMON_SUBNETS   = ['192.168.1', '192.168.40'];

let _elgScanLastEnv = null;

/** Returns the env snapshot captured during the most recent scan. */
export function getLastElgScanEnv() { return _elgScanLastEnv; }

// ── Model resolution ────────────────────────────────────────────────────────
// Catalog (data/printers/eleg_printer_models.json): "1" Centauri Carbon 2
// (MQTT), "2" Centauri Carbon (SDCP, beta), "0" placeholder. The PROTOCOL the
// printer answered on decides it: both report "Centauri Carbon" as a name, so
// a name match alone would call a CC1 a CC2 (issue #41).
export const ELEGOO_MODEL_ID = { CC2: '1', CC1: '2' };

/**
 * @param {string|null} model    - model name from the discovery reply.
 * @param {string}      protocol - "mqtt" (default) | "sdcp".
 * @returns {string} Catalog id.
 */
export function elegooModelIdFromMachineModel(model, protocol = 'mqtt') {
  const m = String(model || '').toLowerCase();
  if (protocol === 'sdcp') return m.includes('centauri') ? ELEGOO_MODEL_ID.CC1 : '0';
  if (m.includes('centauri') || m.includes('centaury')) return ELEGOO_MODEL_ID.CC2;
  return '0';
}

// ── Single-IP probe (manual "Add by IP") ─────────────────────────────────────

export async function elegooProbeIp(ip, _signal, { logPush } = {}) {
  if (!ip) return null;
  // Ask both ways at once: a CC2 answers the MQTT probe, a CC1 the SDCP one.
  const [mqtt, sdcp] = await Promise.all([
    _elegooMqttProbeIp(ip, logPush),
    _elegooSdcpProbeIp(ip, logPush),
  ]);
  return mqtt || sdcp;
}

async function _elegooSdcpProbeIp(ip, logPush) {
  if (typeof window.electronAPI?.elegooSdcpProbe !== 'function') return null;
  let res;
  try { res = await window.electronAPI.elegooSdcpProbe(ip); } catch (_) { return null; }
  if (!res?.ok || !res.candidate) { logPush?.('ambiguous', `${ip} — no SDCP response on :3000`, res); return null; }
  const c = { ...res.candidate, modelId: elegooModelIdFromMachineModel(res.candidate.machineModel, 'sdcp') };
  logPush?.('found', `${ip} → ${c.machineModel || 'Elegoo'} (SDCP ${c.protocolVersion || ''}, fw ${c.firmwareVersion || '?'})`, c);
  return c;
}

async function _elegooMqttProbeIp(ip, logPush) {
  if (typeof window.electronAPI?.elegooUdpProbe !== 'function') {
    logPush?.('err', 'elegooUdpProbe IPC bridge missing — fully quit and relaunch the app');
    return null;
  }
  let res;
  try { res = await window.electronAPI.elegooUdpProbe(ip); }
  catch (e) { logPush?.('err', `UDP probe failed: ${e?.message || e}`); return null; }
  if (!res?.ok || !res.candidate) {
    logPush?.('ambiguous', `${ip} — no Elegoo response on :52700`, res);
    return null;
  }
  const c = res.candidate;
  const modelId = elegooModelIdFromMachineModel(c.machineModel);
  const candidate = { ...c, protocol: 'mqtt', modelId };
  logPush?.('found', `${ip} → ${c.machineModel || c.hostName || 'Elegoo'}${c.sn ? ' (sn:' + c.sn + ')' : ''}`, candidate);
  return candidate;
}

// ── LAN scan (UDP spray) ─────────────────────────────────────────────────────

export async function elegooScanLan({ onCandidate, onProgress, signal, logPush, getExtraSubnets } = {}) {
  if (typeof window.electronAPI?.elegooUdpDiscover !== 'function') {
    logPush?.('err', 'elegooUdpDiscover IPC bridge missing — fully quit and relaunch the app to enable the Elegoo LAN scan');
    onProgress?.({ done: 100, total: 100, prefixes: [] });
    return [];
  }
  const startMs = Date.now();

  // Build prefix list — local NIC subnets + always-include Elegoo common subnets + user extras.
  let primary = [];
  try { primary = (await window.electronAPI.getLocalSubnets()) ?? []; }
  catch { primary = []; }
  for (const p of ELG_COMMON_SUBNETS) if (!primary.includes(p)) primary.push(p);
  if (!primary.length) primary = [...ELG_COMMON_SUBNETS];
  const extras = (getExtraSubnets?.() ?? []).filter(p => p && !primary.includes(p));
  const prefixes = [...primary, ...extras];
  logPush?.('info', `UDP spray :52700 — subnets [${primary.join(', ')}]${extras.length ? ` + extra [${extras.join(', ')}]` : ''}`);

  // Progress animation — the IPC is single-shot.
  let progressTimer = null;
  const stopProgress = () => { if (progressTimer) clearInterval(progressTimer); progressTimer = null; };
  onProgress?.({ done: 0, total: 100, prefixes });
  progressTimer = setInterval(() => {
    if (signal?.aborted) { stopProgress(); return; }
    const elapsed = Date.now() - startMs;
    const pct = Math.min(95, Math.round((elapsed / ELG_SCAN_EXPECTED_MS) * 100));
    onProgress?.({ done: pct, total: 100, prefixes });
  }, 120);

  // MQTT (CC2, :52700) and SDCP (CC1, :3000) sweeps run side by side.
  const sdcpSweep = typeof window.electronAPI?.elegooSdcpDiscover === 'function'
    ? window.electronAPI.elegooSdcpDiscover(prefixes).catch(e => ({ ok: false, error: e?.message || String(e), candidates: [] }))
    : Promise.resolve({ ok: true, candidates: [] });
  let result, sdcpResult;
  try { [result, sdcpResult] = await Promise.all([window.electronAPI.elegooUdpDiscover(prefixes), sdcpSweep]); }
  catch (e) {
    stopProgress();
    logPush?.('err', `UDP discovery failed: ${e?.message || e}`);
    onProgress?.({ done: 100, total: 100, prefixes });
    return [];
  }
  stopProgress();
  if (signal?.aborted) return [];

  const raw = Array.isArray(result?.candidates) ? result.candidates : [];
  if (result?.ok === false) logPush?.('warn', `UDP error: ${result.error || 'unknown'}`);
  const rawSdcp = Array.isArray(sdcpResult?.candidates) ? sdcpResult.candidates : [];
  if (sdcpResult?.ok === false) logPush?.('warn', `SDCP error: ${sdcpResult.error || 'unknown'}`);
  const mqttIps = new Set(raw.map(c => c.ip));

  const out = [
    ...raw.map(c => ({ ...c, protocol: 'mqtt', modelId: elegooModelIdFromMachineModel(c.machineModel) })),
    ...rawSdcp.filter(c => !mqttIps.has(c.ip))
      .map(c => ({ ...c, score: 10, modelId: elegooModelIdFromMachineModel(c.machineModel, 'sdcp') })),
  ].sort((a, b) => (b.score || 0) - (a.score || 0) ||
    String(a.ip || '').localeCompare(String(b.ip || ''), undefined, { numeric: true, sensitivity: 'base' }));

  for (const c of out) {
    if (signal?.aborted) break;
    onCandidate?.(c);
  }
  onProgress?.({ done: 100, total: 100, prefixes });
  logPush?.('info', `UDP scan complete — ${out.length} Elegoo printer(s) in ${Math.round((Date.now() - startMs) / 100) / 10}s`);

  _elgScanLastEnv = {
    method: 'udp-spray', port: '52700 + 3000 (sdcp)', prefixes, sdcpFound: rawSdcp.length,
    durationMs: Date.now() - startMs, found: out.length,
  };
  return out;
}

// ── Discovery record builder ─────────────────────────────────────────────────

export function elegooBuildDiscoveryRecord(c) {
  return {
    method:          'lan-scan',
    transport:       c?.protocol === 'sdcp' ? 'udp-3000-sdcp' : 'udp-52700',
    protocol:        c?.protocol || 'mqtt',
    mainboardId:     c?.mainboardId     || null,
    firmwareVersion: c?.firmwareVersion || null,
    ip:              c?.ip              || null,
    sn:              c?.sn              || null,
    machineModel:    c?.machineModel    || null,
    hostName:        c?.hostName        || null,
    protocolVersion: c?.protocolVersion || null,
    otaVersion:      c?.otaVersion      || null,
    tokenStatus:     c?.tokenStatus     ?? null,
    lanStatus:       c?.lanStatus       ?? null,
    scannedAt:       Date.now(),
  };
}
