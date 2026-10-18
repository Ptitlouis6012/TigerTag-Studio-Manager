/**
 * services/demo/faces/common.js — small helpers every face shares: listening,
 * reading a JSON body, the camera (MJPEG stream + snapshot) and the shared
 * low-port router (docs/DEMO-MODE.md §3.4).
 */
'use strict';

const http = require('http');

/** Listen on host:port; resolves with the server, rejects on EADDRINUSE / EADDRNOTAVAIL… */
function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(port), host, () => { server.removeListener('error', reject); resolve(server); });
  });
}

/** The whole request body, parsed as JSON when it is JSON ({} otherwise). Also returns the raw text. */
function readBody(req) {
  return new Promise(resolve => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => { let json = {}; try { json = raw ? JSON.parse(raw) : {}; } catch (_) {} resolve({ json, raw }); });
  });
}

/**
 * Serve the machine's camera as an MJPEG stream on `res` (5 frames a second).
 * `streams` collects open responses so a face can cut them when it closes.
 */
function mjpeg(res, library, machine, streams, extraHeaders = {}) {
  res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=frame', 'Cache-Control': 'no-cache', ...extraHeaders });
  const push = () => {
    const f = library.frameFor(machine);
    if (!f) return;
    res.write(`--frame\r\nContent-Type: ${f.type}\r\nContent-Length: ${f.data.length}\r\n\r\n`);
    res.write(f.data);
    res.write('\r\n');
  };
  push();
  const t = setInterval(push, 200);
  streams.add(res);
  res.on('close', () => { clearInterval(t); streams.delete(res); });   // not req: it closes once its body is read
}

/** One still picture of the machine's camera. */
function snapshot(res, library, machine, extraHeaders = {}) {
  const f = library.frameFor(machine);
  if (!f) { res.writeHead(404, extraHeaders); return res.end(); }
  res.writeHead(200, { 'Content-Type': f.type, 'Cache-Control': 'no-cache', ...extraHeaders });
  res.end(f.data);
}

/**
 * Shared low-port router. macOS lets a normal user bind a port below 1024 only
 * on the wildcard address, so ONE server per low port listens on 0.0.0.0 and
 * hands each request to the demo printer whose address it was sent to
 * (socket.localAddress). Anything not coming from this computer is refused —
 * the demo printers are never exposed to the network.
 */
const _routers = new Map();   // port → { server, handlers: Map<host, fn>, ready: Promise }
async function routeLowPort(port, host, handler) {
  let r = _routers.get(port);
  if (!r) {
    const handlers = new Map();
    const server = http.createServer((req, res) => {
      const remote = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
      const local = String(req.socket.localAddress || '').replace(/^::ffff:/, '');
      const h = handlers.get(local);
      // A printer on a loopback host is Studio's alone; one on this computer's
      // network address is there on purpose for other devices to test against.
      if (!h || (local.startsWith('127.') && !remote.startsWith('127.'))) { res.writeHead(404); return res.end(); }
      h(req, res);
    });
    r = { server, handlers, ready: listen(server, '0.0.0.0', port) };
    _routers.set(port, r);
    r.ready.catch(() => _routers.delete(port));
  }
  await r.ready;
  r.handlers.set(host, handler);
  return () => {
    r.handlers.delete(host);
    if (!r.handlers.size) { _routers.delete(port); r.server.close(); }
  };
}

/**
 * The same low-port routing for a raw TCP service (FTPS, …): ONE net.Server per
 * port on 0.0.0.0, each connection handed to the printer whose address it was
 * sent to. A loopback host answers loopback clients only; a network host anyone.
 */
const _tcpRouters = new Map();   // port → { server, handlers: Map<host, fn>, ready }
async function routeLowPortTcp(port, host, onConnection) {
  let r = _tcpRouters.get(port);
  if (!r) {
    const net = require('net');
    const handlers = new Map();
    const server = net.createServer(sock => {
      const remote = String(sock.remoteAddress || '').replace(/^::ffff:/, '');
      const local = String(sock.localAddress || '').replace(/^::ffff:/, '');
      const h = handlers.get(local);
      if (!h || (local.startsWith('127.') && !remote.startsWith('127.'))) return sock.destroy();
      h(sock);
    });
    r = { server, handlers, ready: listen(server, '0.0.0.0', port) };
    _tcpRouters.set(port, r);
    r.ready.catch(() => _tcpRouters.delete(port));
  }
  await r.ready;
  r.handlers.set(host, onConnection);
  return () => {
    r.handlers.delete(host);
    if (!r.handlers.size) { _tcpRouters.delete(port); r.server.close(); }
  };
}

/** KEY=value pairs of a Klipper-style command line (values may be "quoted"). */
function gcodeParams(line) {
  const out = {};
  for (const x of line.matchAll(/(\w+)=("([^"]*)"|\S+)/g)) out[x[1].toUpperCase()] = x[3] ?? x[2];
  return out;
}

/**
 * Run G-code on the machine — the subset every Klipper-flavoured face shares:
 * temperatures (M104 / M140 / M141 / SET_HEATER_TEMPERATURE), part fan
 * (M106 / M107), speed (M220), homing and moves (G28, G90 / G91, G0 / G1),
 * motors off (M84). Anything else goes to `extra(cmd, params, line)`, which
 * returns true when it handled it; unknown commands are accepted and ignored,
 * like a printer running a macro it does not care about. Throws Klipper-like
 * errors on a refused move or an unknown heater. `mode` keeps G90/G91 across calls.
 */
function runGcode(m, script, mode, extra = () => false) {
  for (const line of String(script || '').split('\n').map(s => s.trim()).filter(Boolean)) {
    const cmd = line.split(/\s+/)[0].toUpperCase(), p = gcodeParams(line);
    const num = rx => { const v = Number(line.match(rx)?.[1]); return Number.isFinite(v) ? v : null; };
    if (extra(cmd, p, line)) continue;
    if (cmd === 'SET_HEATER_TEMPERATURE') {
      const h = String(p.HEATER || '');
      const key = h === 'heater_bed' ? 'bed'
        : /chamber/.test(h) ? 'chamber'
        : /^extruder(\d*)$/.test(h) ? `nozzle${h.slice(8) || 0}` : null;
      if (!key || !m.setTarget(key, Number(p.TARGET ?? 0))) throw new Error(`Unknown heater '${h}'`);
    }
    else if (cmd === 'M104' || cmd === 'M109') m.setTarget(`nozzle${num(/T(\d+)/i) ?? 0}`, num(/S([\d.]+)/i) ?? 0);
    else if (cmd === 'M140' || cmd === 'M190') m.setTarget('bed', num(/S([\d.]+)/i) ?? 0);
    else if (cmd === 'M141' || cmd === 'M191') m.setTarget('chamber', num(/S([\d.]+)/i) ?? 0);
    else if (cmd === 'M106') m.setFan((num(/S([\d.]+)/i) ?? 255) / 2.55);
    else if (cmd === 'M107') m.setFan(0);
    else if (cmd === 'M220') m.setSpeed(num(/S([\d.]+)/i) ?? 100);
    else if (cmd === 'M84' || cmd === 'M18') m.homed.clear();
    else if (cmd === 'G28') {
      const axes = ['X', 'Y', 'Z'].filter(a => line.toUpperCase().slice(3).includes(a));
      m.home(axes.length ? axes.join('') : 'xyz');
    }
    else if (cmd === 'G90') mode.relative = false;
    else if (cmd === 'G91') mode.relative = true;
    else if (cmd === 'G0' || cmd === 'G1') {
      for (const x of line.toUpperCase().matchAll(/([XYZ])(-?[\d.]+)/g)) {
        const a = x[1].toLowerCase(), v = Number(x[2]);
        const err = m.jog(a, mode.relative ? v : v - m.position[a]);
        if (err) throw new Error(`${err}: ${line}`);
      }
    }
  }
}

module.exports = { listen, readBody, mjpeg, snapshot, routeLowPort, routeLowPortTcp, gcodeParams, runGcode };
