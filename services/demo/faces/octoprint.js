/**
 * services/demo/faces/octoprint.js — a demo printer seen as a Marlin printer
 * behind OctoPrint.
 *
 * Serves the OctoPrint REST endpoints the OctoPrint plugin uses
 * (renderer/printers/octoprint/PROTOCOL.md), built from the engine's Machine on
 * every request. OctoPrint knows no filament identity, so the slots stay
 * invisible here, as on a real one. Every /api call needs the record's key.
 */
'use strict';

const http = require('http');
const { mjpeg, snapshot } = require('./common');

const FILE = id => `${id}.gcode`;

function stateText(m) {
  return m.phase === 'paused' ? 'Paused'
    : m.phase === 'error' ? 'Error'
    : ['heating', 'leveling', 'printing'].includes(m.phase) ? 'Printing'
    : 'Operational';
}

function flags(m) {
  const printing = ['heating', 'leveling', 'printing'].includes(m.phase);
  return {
    operational: true, ready: !printing && m.phase !== 'paused', printing, paused: m.phase === 'paused',
    pausing: false, cancelling: false, error: m.phase === 'error', closedOrError: m.phase === 'error',
  };
}

function temps(m) {
  const t = {};
  m.nozzles().forEach((h, i) => { t[`tool${i}`] = { actual: +h.cur.toFixed(2), target: h.target, offset: 0 }; });
  t.bed = { actual: +m.heaters.bed.cur.toFixed(2), target: m.heaters.bed.target, offset: 0 };
  if (m.heaters.chamber) t.chamber = { actual: +m.heaters.chamber.cur.toFixed(2), target: m.heaters.chamber.target, offset: 0 };
  return t;
}

function start({ machine: m, address, library, record = {} }) {
  const apiKey = record.apiKey || '';
  const [host, port] = address.split(':');
  const send = (res, code, body, type = 'application/json') => {
    res.writeHead(code, { 'Content-Type': type });
    res.end(type === 'application/json' && body !== undefined ? JSON.stringify(body) : body);
  };
  const streams = new Set();

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, `http://${req.headers.host || address}`), p = u.pathname, verb = req.method;
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (_) {}
      if (p === '/webcam/' || p === '/webcam') {
        if (u.searchParams.get('action') === 'stream') return mjpeg(res, library, m, streams);
        return snapshot(res, library, m);
      }
      const th = p.match(/^\/plugin\/prusaslicerthumbnails\/thumbnail\/(.+)\.png$/);
      if (th) {
        const t = library.thumbnail(decodeURIComponent(th[1]).replace(/\.gcode$/, ''));
        return t ? send(res, 200, t, 'image/png') : send(res, 404, { error: 'no thumbnail' });
      }
      if (p === '/plugin/appkeys/probe') return send(res, 404, '', 'text/plain');   // the record already carries its key
      if (!p.startsWith('/api/')) return send(res, 404, 'not found', 'text/plain');
      if (req.headers['x-api-key'] !== apiKey) return send(res, 403, { error: 'Forbidden' });

      if (p === '/api/version') return send(res, 200, { api: '0.1', server: '1.10.2', text: 'OctoPrint 1.10.2 (demo)' });
      if (p === '/api/connection') {
        if (verb === 'POST') return send(res, 204, '');
        return send(res, 200, { current: { state: stateText(m), port: '/dev/ttyUSB0', baudrate: 115200, printerProfile: '_default' } });
      }
      if (p === '/api/printer') return send(res, 200, { temperature: temps(m), state: { text: stateText(m), flags: flags(m) } });
      if (p === '/api/job') {
        if (verb === 'POST') {
          if (body.command === 'cancel') m.stop();
          else if (body.command === 'pause') {
            const want = body.action === 'resume' ? 'resume' : body.action === 'toggle' ? (m.phase === 'paused' ? 'resume' : 'pause') : 'pause';
            want === 'resume' ? m.resume() : m.pause();
          } else if (body.command === 'start') m.start();
          return send(res, 204, '');
        }
        const active = m.print && m.phase !== 'idle';
        return send(res, 200, {
          job: { file: active ? { name: FILE(m.print.id), path: FILE(m.print.id), origin: 'local' } : { name: null }, estimatedPrintTime: active ? m.print.durationReal : null },
          progress: { completion: active ? m.progress * 100 : null, printTime: active ? m.elapsedSec : null, printTimeLeft: active && m.progress < 1 ? m.remainingSec : null },
          state: stateText(m),
        });
      }
      if (p === '/api/settings') return send(res, 200, { webcam: {
        webcamEnabled: true, streamUrl: '/webcam/?action=stream', snapshotUrl: `http://${address}/webcam/?action=snapshot`,
        flipH: false, flipV: false, rotate90: false,
      } });
      if (p === '/api/printerprofiles') return send(res, 200, { profiles: { _default: {
        id: '_default', name: 'Demo Marlin', current: true, default: true, heatedBed: true, heatedChamber: !!m.heaters.chamber,
        extruder: { count: m.nozzles().length },
      } } });
      if (p === '/api/printer/printhead' && verb === 'POST') {
        if (body.command === 'home') { m.home((body.axes || []).join('')); return send(res, 204, ''); }
        if (body.command === 'jog') {
          for (const a of ['x', 'y', 'z']) if (body[a] != null) {
            const e = m.jog(a, Number(body[a]));
            if (e) return send(res, 409, { error: `${e} (${a.toUpperCase()})` });
          }
          return send(res, 204, '');
        }
        return send(res, 400, { error: 'unknown command' });
      }
      if (p === '/api/printer/tool' && verb === 'POST' && body.command === 'target') {
        for (const [k, v] of Object.entries(body.targets || {})) if (!m.setTarget(k.replace(/^tool/, 'nozzle'), v)) return send(res, 400, { error: `Unknown tool ${k}` });
        return send(res, 204, '');
      }
      if ((p === '/api/printer/bed' || p === '/api/printer/chamber') && verb === 'POST' && body.command === 'target') {
        return m.setTarget(p.slice(13), body.target) ? send(res, 204, '') : send(res, 409, { error: 'No such heater' });
      }
      if (p === '/api/printer/command' && verb === 'POST') {
        for (const line of (body.commands || [body.command]).filter(Boolean)) {
          const cmd = String(line).trim().toUpperCase().split(/\s+/)[0], s = Number(String(line).match(/S([\d.]+)/i)?.[1]);
          if (cmd === 'M106') m.setFan((Number.isFinite(s) ? s : 255) / 2.55);
          else if (cmd === 'M107') m.setFan(0);
          else if (cmd === 'M220') m.setSpeed(s || 100);
          else if (cmd === 'M104') m.setTarget('nozzle0', s || 0);
          else if (cmd === 'M140') m.setTarget('bed', s || 0);
        }
        return send(res, 204, '');
      }
      const fm = p.match(/^\/api\/files\/local\/(.+)$/);
      if (fm) {
        const name = decodeURIComponent(fm[1]);
        return send(res, 200, { name, path: name, thumbnail: `plugin/prusaslicerthumbnails/thumbnail/${encodeURIComponent(name)}.png` });
      }
      return send(res, 404, { error: 'not found' });
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(port), host, () => resolve({
      close() { for (const r of streams) { try { r.destroy(); } catch (_) {} } server.close(); },
    }));
  });
}

module.exports = {
  brand: 'octoprint', slotCount: 0, start,
  // The face checks the key the way a real OctoPrint does.
  recordFields: address => ({ ip: address, apiKey: `demo-${require('crypto').randomBytes(6).toString('hex')}` }),
  addressOf: rec => String(rec.ip || ''),
};
