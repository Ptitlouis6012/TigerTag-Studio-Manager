/**
 * services/demo/addresses.js — where each demo printer lives (docs/DEMO-MODE.md §3.4).
 *
 * Two kinds of brands:
 *   - the record takes a port (Klipper, OctoPrint, Prusa, FlashForge):
 *       127.0.0.1:<port>, one port per printer — nothing to set up anywhere;
 *   - the driver dials fixed ports (Creality 9999, Snapmaker 7125…):
 *       a loopback address of its own, 127.0.0.<n> (n ≥ 10), so two printers of
 *       the same brand, or two brands sharing a port, never collide.
 *
 * Windows and Linux answer on the whole 127/8 already. macOS has only
 * 127.0.0.1: the missing aliases are created in ONE administrator prompt
 * (macOS's own dialog, the user types their password), and they vanish at
 * reboot — the next start asks again. Refused → those printers stay offline.
 */
'use strict';

const net = require('net');
const os = require('os');
const { execFile } = require('child_process');

const PORT_BASE = { klipper: 47100, octoprint: 47200, prusa: 47300, flashforge: 47400 };
const FIRST_HOST = 10;

const portFree = (host, port) => new Promise(r => {
  const s = net.createServer();
  s.once('error', () => r(false));
  s.listen(port, host, () => s.close(() => r(true)));
});

/** A free address for a new demo printer of `brand`; `used` = addresses already taken by demo records. */
async function allocate(brand, used = []) {
  const taken = new Set(used.map(String));
  const base = PORT_BASE[brand];
  if (base) {
    for (let port = base + 1; port < base + 100; port++) {
      const a = `127.0.0.1:${port}`;
      if (!taken.has(a) && await portFree('127.0.0.1', port)) return a;
    }
    return null;
  }
  const hosts = new Set([...taken].map(a => a.split(':')[0]));
  for (let n = FIRST_HOST; n < 255; n++) {
    const h = `127.0.0.${n}`;
    if (!hosts.has(h)) return h;
  }
  return null;
}

/** Loopback hosts that exist on this machine right now. */
function existingHosts() {
  const out = new Set(['127.0.0.1']);
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) {
    if (a.family === 'IPv4' && a.address.startsWith('127.')) out.add(a.address);
  }
  return out;
}

/**
 * Make sure every host in `hosts` can be bound. No-op outside macOS.
 * Resolves { ok, missing[] } — ok false when the user declined the prompt.
 */
function ensureHosts(hosts) {
  if (process.platform !== 'darwin') return Promise.resolve({ ok: true, missing: [] });
  const have = existingHosts();
  const missing = [...new Set(hosts)].filter(h => /^127\.0\.0\.\d+$/.test(h) && !have.has(h));
  if (!missing.length) return Promise.resolve({ ok: true, missing: [] });
  const cmd = missing.map(h => `/sbin/ifconfig lo0 alias ${h} up`).join(' && ');
  const prompt = 'Tiger Studio wants to add local addresses for its demo printers.';
  const script = `do shell script ${JSON.stringify(cmd)} with prompt ${JSON.stringify(prompt)} with administrator privileges`;
  return new Promise(resolve => {
    execFile('/usr/bin/osascript', ['-e', script], { timeout: 120000 }, err => {
      const now = existingHosts();
      resolve({ ok: !err && missing.every(h => now.has(h)), missing: missing.filter(h => !now.has(h)) });
    });
  });
}

/**
 * This computer's own network addresses (IPv4, not loopback). A demo record on
 * one of them is served on the local network — for devices that test against
 * the simulator (Tiger Touch, the mobile app), not only for Studio itself.
 */
function lanHosts() {
  const out = new Set();
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) {
    if (a.family === 'IPv4' && !a.internal) out.add(a.address);
  }
  return out;
}

/** Can the simulator serve this address? loopback, or one of this computer's own addresses. */
function servable(address) {
  const host = String(address || '').split(':')[0];
  return /^127\.\d+\.\d+\.\d+$/.test(host) || lanHosts().has(host);
}

module.exports = { allocate, ensureHosts, portFree, lanHosts, servable };
