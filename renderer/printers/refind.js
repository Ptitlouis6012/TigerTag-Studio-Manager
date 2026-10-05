/**
 * printers/refind.js — follow a LAN printer to its new IP after a DHCP change.
 *
 * When a brand module gives up on a printer (its reconnect attempts failed),
 * it asks for a re-find. We run that brand's own LAN scan silently, look for
 * the printer by its STABLE identity — never by IP or display name — and, when
 * exactly one device matches at a different address, save the new IP and
 * reconnect. The user gets one toast; nothing is asked.
 *
 * Identity per brand (see identity.js for how the missing ones are collected):
 *   bambulab   serialNumber  ↔ scan `serial`
 *   elegoo     sn            ↔ scan `sn`
 *   flashforge serialNumber / macAddress
 *   snapmaker  serialNumber
 *   creality   serialNumber (↔ `deviceSn`), else hostName (weak)
 *   anycubic   macAddress    ↔ scan `usn`
 * plus `macAddress` for any brand, read from the ARP cache of each candidate.
 *
 * Guards: LAN printers only (cloud ones have no address to lose); never a
 * printer the user switched offline on purpose; one scan per brand at a time;
 * a printer is re-searched at most once per cooldown (growing while it stays lost);
 * a weak hostName match is only trusted when it is unique; an IP another
 * printer of the same brand already uses is never taken.
 */
import { ctx } from "./context.js";
import { loadList as getExtraSubnets } from "./extra-subnets.js";
import { macFromUsn } from "./identity.js";
import { bambuScanLan } from "./bambulab/probe.js";
import { elegooScanLan } from "./elegoo/probe.js";
import { ffgScanLan } from "./flashforge/probe.js";
import { snapScanLan } from "./snapmaker/probe.js";
import { creScanLan } from "./creality/probe.js";
import { acuScanLan } from "./anycubic/probe.js";

// A printer that is simply switched off would otherwise be searched for every
// few minutes all day: each fruitless search doubles the wait (5 → 10 → 20 …
// capped at an hour). A successful re-find resets it.
const REFIND_COOLDOWN_MS = 5 * 60 * 1000;
const REFIND_COOLDOWN_MAX_MS = 60 * 60 * 1000;
// Bambu / Anycubic report "offline" from a main-process MQTT client that keeps
// retrying on its own — only search when the printer is STILL down after this.
const STILL_DOWN_MS = 20 * 1000;

// Normalised for comparison: serials upper-cased without separators, MACs as AA:BB:…
const normId  = v => (v == null ? null : String(v).replace(/[^0-9a-z]/gi, "").toUpperCase() || null);
const normMac = v => macFromUsn(v);
const normHost = v => (v == null ? null : String(v).trim().toLowerCase() || null);

const BRANDS = {
  bambulab:   { scan: bambuScanLan,  ipField: "broker",
                strong: c => [normId(c.serial)],             mine: p => [normId(p.serialNumber)] },
  elegoo:     { scan: elegooScanLan, ipField: "ip",
                strong: c => [normId(c.sn)],                 mine: p => [normId(p.sn)] },
  flashforge: { scan: ffgScanLan,    ipField: "ip",
                strong: c => [normId(c.serialNumber), normMac(c.macAddress)],
                mine:   p => [normId(p.serialNumber), normMac(p.macAddress), normMac(p.discovery?.macAddress)] },
  snapmaker:  { scan: snapScanLan,   ipField: "ip",
                strong: c => [normId(c.serialNumber)],
                mine:   p => [normId(p.serialNumber), normId(p.discovery?.derived?.serialNumber)] },
  creality:   { scan: creScanLan,    ipField: "ip",
                strong: c => [normId(c.deviceSn)],
                mine:   p => [normId(p.serialNumber), normId(p.discovery?.deviceSn)],
                weak:   c => normHost(c.hostName),
                mineWeak: p => normHost(p.hostName) || normHost(p.discovery?.hostName) },
  anycubic:   { scan: acuScanLan,    ipField: "ip",
                strong: c => [normMac(c.usn)],
                mine:   p => [normMac(p.macAddress), normMac(p.discovery?.usn)] },
};

const _lastTry = new Map();      // key → { at, misses } of the last search
const _brandScan = new Map();    // brand → in-flight scan Promise<candidates[]>
const _pending = new Map();      // key → still-down timer

const findPrinter = key => (ctx.getState?.().printers || []).find(p => `${p.brand}:${p.id}` === key) || null;

/**
 * Ask for a re-find of `key` (`brand:id`). Safe to call on every failure — it
 * de-duplicates, rate-limits and never throws. `{ afterStillDown: true }` waits
 * STILL_DOWN_MS and only searches if the printer has not come back meanwhile.
 */
export function requestPrinterRefind(brand, key, { afterStillDown = false } = {}) {
  if (!BRANDS[brand] || !key) return;
  if (afterStillDown) {
    if (_pending.has(key)) return;
    _pending.set(key, setTimeout(() => {
      _pending.delete(key);
      const p = findPrinter(key);
      if (p && !ctx.isPrinterOnline?.(p)) refind(brand, key);
    }, STILL_DOWN_MS));
    return;
  }
  refind(brand, key);
}

async function refind(brand, key) {
  const spec = BRANDS[brand];
  const now = Date.now();
  const last = _lastTry.get(key) || { at: 0, misses: 0 };
  const wait = Math.min(REFIND_COOLDOWN_MS * 2 ** Math.max(0, last.misses - 1), REFIND_COOLDOWN_MAX_MS);
  if (last.at && now - last.at < wait) return;
  if (ctx.isForcedOffline?.(key)) return;   // switched off on purpose — leave it
  _lastTry.set(key, { at: now, misses: last.misses + 1 });
  try {
    const st = ctx.getState?.() || {};
    if (st.friendView) return;
    const p = findPrinter(key);
    if (!p || p.mode === "cloud") return;
    const oldIp = String(p[spec.ipField] || p.ip || "");
    const myIds = spec.mine(p).filter(Boolean);
    const myHost = spec.mineWeak?.(p) || null;
    const myMac = normMac(p.macAddress);
    if (!myIds.length && !myHost) return;   // nothing to recognise it by

    const candidates = await scanBrand(brand);
    // IPs already owned by the brand's OTHER printers are never re-assigned.
    const taken = new Set((st.printers || [])
      .filter(x => x.brand === brand && x.id !== p.id)
      .map(x => String(x[spec.ipField] || x.ip || "")).filter(Boolean));
    const pool = candidates.filter(c => c?.ip && !taken.has(String(c.ip)));

    // Strong match: a scan identifier, or the MAC the OS sees at that address.
    let hits = pool.filter(c => spec.strong(c).some(id => id && myIds.includes(id)));
    if (!hits.length && myMac) {
      const macs = await Promise.all(pool.map(c => window.electronAPI?.arpMac?.(c.ip).catch(() => null)));
      hits = pool.filter((c, i) => macs[i] && normMac(macs[i]) === myMac);
    }
    // Weak match (Creality hostname) — only when nothing strong exists and it is unique.
    if (!hits.length && myHost && spec.weak) {
      const weak = pool.filter(c => spec.weak(c) === myHost);
      if (weak.length === 1) hits = weak;
    }
    const ips = [...new Set(hits.map(c => String(c.ip)))];
    if (ips.length !== 1) {
      if (ips.length > 1) console.warn(`[refind] ${key}: ${ips.length} matches (${ips.join(", ")}) — left alone`);
      return;
    }
    const newIp = ips[0];
    if (newIp === oldIp) return;            // still there — the link itself is the problem

    await ctx.savePrinterField(brand, p.id, spec.ipField, newIp);
    p[spec.ipField] = newIp;
    if (spec.ipField !== "ip" && p.ip) p.ip = newIp;
    console.log(`[refind] ${key}: ${oldIp || "?"} → ${newIp}`);
    _lastTry.delete(key);
    ctx.reconnectPrinter?.(p);
    ctx.onPrinterRefound?.(p, oldIp, newIp);
  } catch (e) {
    console.warn(`[refind] ${key}:`, e?.message || e);
  }
}

// One silent scan per brand at a time; concurrent requests share it.
function scanBrand(brand) {
  if (_brandScan.has(brand)) return _brandScan.get(brand);
  // Some scanners return their list, others only stream it through
  // onCandidate — collect both, one entry per IP.
  const seen = new Map();
  const keep = c => { if (c?.ip && !seen.has(String(c.ip))) seen.set(String(c.ip), c); };
  const job = BRANDS[brand].scan({ getExtraSubnets, onCandidate: keep })
    .then(list => { if (Array.isArray(list)) list.forEach(keep); return [...seen.values()]; })
    .catch(() => [...seen.values()])
    .finally(() => _brandScan.delete(brand));
  _brandScan.set(brand, job);
  return job;
}
