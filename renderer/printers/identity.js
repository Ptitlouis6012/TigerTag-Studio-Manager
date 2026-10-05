/**
 * printers/identity.js — make every LAN printer recognisable WITHOUT its IP.
 *
 * A printer's IP is whatever the router handed out last; the only way to find
 * it again after a DHCP change is a stable identifier that a LAN scan also
 * reports. Bambu Lab, Elegoo and FlashForge store one from day one. Creality,
 * Snapmaker and Anycubic only had it when the printer was added through a scan
 * (`discovery.*`) — a printer typed in by IP had nothing to be matched on.
 *
 * This fills that gap: the first time such a printer is seen connected in a
 * session, its identifier is copied from the `discovery` record when one
 * exists, otherwise read by probing the printer at its current IP (the same
 * probe the Add flow uses), and saved on the printer doc:
 *
 *   creality   → `serialNumber`  (the WebSocket hello's `deviceSn`)
 *   snapmaker  → `serialNumber`  (Moonraker / product info `serial_number`)
 *   anycubic   → `macAddress`    (from `/info` `usn` = "uuid:fdm:<MAC>")
 *   creality, when it has neither → `hostName` (weak, unique-match only)
 *
 * On top of that, `macAddress` is read from the OS neighbour (ARP) cache, which
 * learns it the moment we talk to the printer. It is the safety net for
 * printers whose firmware reports no serial (e.g. Ender-3 V4) — but only on a
 * directly attached subnet; across a router the main process returns null.
 *
 * Same field names as Bambu Lab / FlashForge (`serialNumber`) and FlashForge's
 * scan (`macAddress`), so a re-find can match every brand the same way.
 * Cloud printers are skipped — they have no LAN address to lose.
 */
import { ctx } from "./context.js";
import { creProbeIp } from "./creality/probe.js";
import { snapProbeIp } from "./snapmaker/probe.js";
import { acuProbeIp } from "./anycubic/probe.js";

// "uuid:fdm:70-68-71-9A-FA-00" → "70:68:71:9A:FA:00". Null when no MAC in it.
export function macFromUsn(usn) {
  const m = /([0-9a-f]{2}[-:]){5}[0-9a-f]{2}/i.exec(String(usn || ""));
  return m ? m[0].replace(/-/g, ":").toUpperCase() : null;
}

const clean = v => (v == null ? null : String(v).trim() || null);

// One Creality WebSocket hello per IP serves both the serial and the hostname.
const _creHello = new Map();
const creHello = ip => {
  if (!_creHello.has(ip)) {
    _creHello.set(ip, creProbeIp(ip, null, { directWs: true }).catch(() => null));
    setTimeout(() => _creHello.delete(ip), 60000);
  }
  return _creHello.get(ip);
};

const IDENTITY = {
  creality: {
    field: "serialNumber",
    fromDiscovery: p => clean(p.discovery?.deviceSn),
    probe: async ip => clean((await creHello(ip))?.deviceSn),
    // Last resort when neither a serial nor the MAC can be had (Ender-3 V4 on a
    // routed subnet): Creality suffixes the hostname per unit ("Ender-3_V4-574A").
    // Weak — a re-find may only trust it when exactly one device answers to it.
    hostName: async (p, ip) => clean(p.discovery?.hostName)
      || clean((await creHello(ip))?.hostName),
  },
  snapmaker: {
    field: "serialNumber",
    fromDiscovery: p => clean(p.discovery?.derived?.serialNumber),
    probe: async ip => clean((await snapProbeIp(ip))?.serialNumber),
  },
  anycubic: {
    field: "macAddress",
    fromDiscovery: p => macFromUsn(p.discovery?.usn),
    probe: async ip => macFromUsn((await acuProbeIp(ip, null, { directInfo: true }))?.usn),
  },
};

// Once per printer per session — a printer that does not report an identifier
// (older firmware) is not probed again on every reconnect.
const _checked = new Set();
// Let the fresh connection settle before opening a second channel to it.
const PROBE_DELAY_MS = 4000;

/**
 * Called by a brand module when its LAN connection to `key` (`brand:id`) goes
 * live. Fire-and-forget: never throws, never blocks the connection.
 */
export function ensurePrinterIdentity(brand, key, ip) {
  const spec = IDENTITY[brand];
  if (!spec || !key || !ip || _checked.has(key)) return;
  _checked.add(key);
  setTimeout(async () => {
    try {
      const st = ctx.getState?.() || {};
      if (st.friendView) return;   // a friend's printers are not ours to write
      const p = (st.printers || []).find(x => `${x.brand}:${x.id}` === key);
      if (!p || p.mode === "cloud") return;
      if (p.ip !== ip) return;     // moved meanwhile — the next connect retries
      const patch = {};
      if (!clean(p[spec.field])) {
        const id = spec.fromDiscovery(p) || await spec.probe(ip);
        if (id) patch[spec.field] = id;
      }
      if (!clean(p.macAddress) && !patch.macAddress) {
        const mac = await window.electronAPI?.arpMac?.(ip);
        if (mac) patch.macAddress = mac;
      }
      if (spec.hostName && !clean(p.hostName) && !patch[spec.field] && !clean(p[spec.field])
          && !patch.macAddress && !clean(p.macAddress)) {
        const host = await spec.hostName(p, ip);
        if (host) patch.hostName = host;
      }
      for (const [field, value] of Object.entries(patch)) {
        await ctx.savePrinterField(brand, p.id, field, value);
        p[field] = value;          // the snapshot echo follows; no second probe meanwhile
      }
    } catch (e) {
      console.warn(`[identity] ${key}:`, e?.message || e);
    }
  }, PROBE_DELAY_MS);
}
