/**
 * printers/octoprint/probe.js — OctoPrint plugin, discovery (no DOM).
 *
 * One unauthenticated `GET /plugin/appkeys/probe` on port 80 per address of
 * each local /24 (plus the user's extra subnets): OctoPrint answers 204. No
 * credential leaves.
 */
import { opProbe } from './core.js';

const PROBE_TIMEOUT_MS = 700;
const BATCH_LOCAL = 24;
const BATCH_EXTRA = 4;
const GAP_EXTRA_MS = 80;

/** Probe one address ("ip" or "ip:port"). Resolves to a candidate, or null. */
export async function opProbeIp(ip, timeoutMs = 2500) {
  const r = await opProbe(ip, timeoutMs);
  if (!r?.octoprint) return null;
  return { ip, appKeys: !!r.appKeys, version: r.version || null };
}

/** Walk the local /24s (+ extras). onCandidate(c) per printer, onProgress({done,total}). */
export async function opScanLan({ onCandidate, onProgress, signal, getExtraSubnets } = {}) {
  let local = [];
  try { local = (await window.electronAPI?.getLocalSubnets?.()) ?? []; } catch (_) { local = []; }
  const extras = (getExtraSubnets?.() ?? []).filter(p => p && !local.includes(p));
  const jobs = [];
  for (const pre of local)  for (let i = 1; i < 255; i++) jobs.push({ ip: `${pre}.${i}`, extra: false });
  for (const pre of extras) for (let i = 1; i < 255; i++) jobs.push({ ip: `${pre}.${i}`, extra: true });
  const total = jobs.length || 1;
  let done = 0, i = 0;
  const found = [];
  onProgress?.({ done: 0, total });
  while (i < jobs.length) {
    if (signal?.aborted) break;
    const batch = jobs.slice(i, i + (jobs[i].extra ? BATCH_EXTRA : BATCH_LOCAL));
    i += batch.length;
    await Promise.all(batch.map(async ({ ip }) => {
      const c = await opProbeIp(ip, PROBE_TIMEOUT_MS);
      done++;
      if (c && !signal?.aborted) { found.push(c); onCandidate?.(c); }
    }));
    onProgress?.({ done, total });
    if (batch[0]?.extra) await new Promise(r => setTimeout(r, GAP_EXTRA_MS));
  }
  onProgress?.({ done: total, total });
  return found;
}

/** What the printer doc keeps about how it was found. */
export function opDiscoveryRecord(c) {
  return { method: "http-probe", ip: c.ip, server: c.version ? `OctoPrint ${c.version}` : "OctoPrint", foundAt: Date.now() };
}
