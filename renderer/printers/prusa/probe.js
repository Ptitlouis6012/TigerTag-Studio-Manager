/**
 * printers/prusa/probe.js — Prusa discovery (no DOM).
 *
 * PrusaLink has no discovery protocol worth relying on, so the scan walks each
 * /24 the computer is on (plus the user's extra subnets) with ONE
 * unauthenticated `GET /api/version` per address (main: `prusa:probe`). A
 * PrusaLink printer answers 401 with a Digest challenge, or 200 with its
 * version when auth is off — both say "Prusa" without any credential leaving.
 */

const PROBE_TIMEOUT_MS = 700;
const BATCH_LOCAL = 24;
const BATCH_EXTRA = 4;
const GAP_EXTRA_MS = 80;

/** Probe one address. Resolves to a candidate, or null. */
export async function prusaProbeIp(ip, timeoutMs = 2500) {
  if (!window.prusa?.probe) return null;
  try {
    const r = await window.prusa.probe(ip, timeoutMs);
    if (!r?.prusa) return null;
    return { ip, needsAuth: !!r.needsAuth, server: r.server || "", version: r.version || null };
  } catch (_) { return null; }
}

/**
 * Walk the local /24s (+ extras). Calls onCandidate(c) per printer found and
 * onProgress({ done, total }) as it goes. Honours an AbortSignal.
 */
export async function prusaScanLan({ onCandidate, onProgress, signal, getExtraSubnets, logPush } = {}) {
  let local = [];
  try { local = (await window.electronAPI?.getLocalSubnets?.()) ?? []; } catch (_) { local = []; }
  const extras = (getExtraSubnets?.() ?? []).filter(p => p && !local.includes(p));
  const jobs = [];
  for (const pre of local)  for (let i = 1; i < 255; i++) jobs.push({ ip: `${pre}.${i}`, extra: false });
  for (const pre of extras) for (let i = 1; i < 255; i++) jobs.push({ ip: `${pre}.${i}`, extra: true });
  logPush?.("info", `HTTP /api/version sweep — subnets [${local.join(", ")}]${extras.length ? ` + extra [${extras.join(", ")}]` : ""}`);
  const total = jobs.length || 1;
  let done = 0;
  const found = [];
  onProgress?.({ done: 0, total });
  let i = 0;
  while (i < jobs.length) {
    if (signal?.aborted) break;
    const batchSize = jobs[i].extra ? BATCH_EXTRA : BATCH_LOCAL;
    const batch = jobs.slice(i, i + batchSize);
    i += batch.length;
    await Promise.all(batch.map(async ({ ip }) => {
      const c = await prusaProbeIp(ip, PROBE_TIMEOUT_MS);
      done++;
      if (c && !signal?.aborted) { found.push(c); onCandidate?.(c); logPush?.("info", `PrusaLink at ${ip}`); }
    }));
    onProgress?.({ done, total });
    if (batch[0]?.extra) await new Promise(r => setTimeout(r, GAP_EXTRA_MS));
  }
  onProgress?.({ done: total, total });
  return found;
}

/** What the printer doc keeps about how it was found. */
export function prusaBuildDiscoveryRecord(c) {
  return { method: "http-probe", ip: c.ip, server: c.server || null, foundAt: Date.now() };
}
