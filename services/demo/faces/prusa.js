/**
 * services/demo/faces/prusa.js — a demo printer seen as a Prusa on PrusaLink
 * (a CORE One with an MMU3, 5 slots).
 *
 * Serves what the Prusa driver uses (renderer/printers/prusa/PROTOCOL.md):
 * /api/version, /api/v1/{status,info,job}, the job thumbnail, the camera
 * snapshot, and the job pause / resume / stop — behind HTTP Digest
 * (user "maker", realm "Printer API", qop auth, MD5), checked like PrusaLink.
 */
'use strict';

const http = require('http');
const crypto = require('crypto');
const { snapshot, listen } = require('./common');

const STATE = {   // engine phase → PrusaLink printer.state
  idle: 'IDLE', heating: 'PRINTING', leveling: 'PRINTING', printing: 'PRINTING',
  paused: 'PAUSED', complete: 'FINISHED', cancelled: 'STOPPED', error: 'ERROR',
};
const REALM = 'Printer API';
const md5 = s => crypto.createHash('md5').update(s).digest('hex');
const SHORT = id => `${id.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase()}~1.BGC`;   // the SD 8.3 name

function parseDigest(h) {
  const out = {};
  for (const x of String(h || '').replace(/^Digest\s+/i, '').matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g)) out[x[1]] = x[2] ?? x[3];
  return out;
}

function start({ machine: m, address, library, record = {}, model }) {
  const [host, port] = address.split(':');
  const user = record.username || 'maker', pass = String(record.password || '');
  const nonce = crypto.randomBytes(12).toString('hex');

  const authorized = req => {
    if (record.apiKey && req.headers['x-api-key'] === record.apiKey) return true;
    const d = parseDigest(req.headers.authorization);
    if (d.username !== user || d.nonce !== nonce || d.uri !== req.url) return false;
    const ha1 = md5(`${user}:${REALM}:${pass}`), ha2 = md5(`${req.method}:${d.uri}`);
    const want = d.qop ? md5(`${ha1}:${d.nonce}:${d.nc}:${d.cnonce}:${d.qop}:${ha2}`) : md5(`${ha1}:${d.nonce}:${ha2}`);
    return d.response === want;
  };
  const send = (res, code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json', Server: 'PrusaLink' });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, `http://${address}`), p = u.pathname;
    if (!authorized(req)) {
      res.writeHead(401, { 'WWW-Authenticate': `Digest realm="${REALM}", nonce="${nonce}", qop="auth"`, Server: 'PrusaLink', 'Content-Type': 'application/json' });
      return res.end('{"title":"Unauthorized"}');
    }
    const active = m.print && m.phase !== 'idle';
    if (p === '/api/version') return send(res, 200, { api: '2.0.0', server: '2.1.2', text: 'PrusaLink', printer: 'COREONE', firmware: '6.2.0-demo' });
    if (p === '/api/v1/info') return send(res, 200, { mmu: m.slots.length > 1 && m.nozzles().length === 1, serial: `DEMO${m.id.slice(0, 8).toUpperCase()}`, name: model?.name || 'CORE One', nozzle_diameter: 0.4, active_camera: true });
    if (p === '/api/v1/status') {
      const n = m.nozzles()[0], bed = m.heaters.bed;
      return send(res, 200, {
        printer: {
          // A runout is PrusaLink's ATTENTION (the printer waits for a hand on it).
          state: m.event?.kind === 'runout' ? 'ATTENTION' : (STATE[m.phase] || 'IDLE'),
          temp_nozzle: +n.cur.toFixed(1), target_nozzle: n.target,
          temp_bed: +bed.cur.toFixed(1), target_bed: bed.target,
          fan_print: m.fan, fan_hotend: m.phase === 'idle' ? 0 : 100, speed: m.speedPct, flow: 100,
          status_printer: m.phase === 'error' || m.event ? { ok: false, message: m.message || 'Error' } : { ok: true, message: '' },
        },
        ...(active ? { job: { id: m.jobId, progress: +(m.progress * 100).toFixed(1), time_remaining: m.remainingSec, time_printing: m.elapsedSec } } : {}),
        camera: { id: 'demo-cam' },
      });
    }
    const jm = p.match(/^\/api\/v1\/job(?:\/(\d+))?(?:\/(pause|resume|continue))?$/);
    if (jm) {
      if (!jm[1]) {
        if (!active) return send(res, 204);
        const short = SHORT(m.print.id);
        return send(res, 200, {
          id: m.jobId, state: STATE[m.phase], progress: +(m.progress * 100).toFixed(1),
          time_remaining: m.remainingSec, time_printing: m.elapsedSec,
          file: {
            display_name: `${m.print.id}.bgcode`, name: short, path: '/usb',
            refs: { thumbnail: `/thumb/l/usb/${short}`, icon: `/thumb/s/usb/${short}` },
            meta: {
              filament_type: m.print.slots.map(s => s.material).join(';'),
              extruder_colour: m.print.slots.map(s => s.color).join(';'),
              estimated_print_time: m.print.durationReal,
            },
          },
        });
      }
      if (Number(jm[1]) !== m.jobId) return send(res, 404, { title: 'Not Found' });
      if (req.method === 'DELETE') { m.stop(); return send(res, 204); }
      if (jm[2] === 'pause') return m.pause() ? send(res, 204) : send(res, 409, { title: 'Conflict' });
      if (jm[2] === 'resume' || jm[2] === 'continue') return m.resume() ? send(res, 204) : send(res, 409, { title: 'Conflict' });
      return send(res, 405);
    }
    const th = p.match(/^\/thumb\/[sl]\/usb\/(.+)$/);
    if (th) {
      const pr = library.list().find(x => SHORT(x.id) === decodeURIComponent(th[1]));
      const t = pr && library.thumbnail(pr.id);
      if (!t) return send(res, 404);
      res.writeHead(200, { 'Content-Type': 'image/png', Server: 'PrusaLink' }); return res.end(t);
    }
    if (p === '/api/v1/cameras/snap' || /^\/api\/v1\/cameras\/[^/]+\/snap$/.test(p)) return snapshot(res, library, m);
    if (p === '/api/v1/cameras') return send(res, 200, { camera_list: [{ camera_id: 'demo-cam', config: { name: 'Demo cam' }, connected: true }] });
    return send(res, 404, { title: 'Not Found' });
  });
  return listen(server, host, port).then(() => ({ close() { server.close(); } }));
}

module.exports = {
  brand: 'prusa', slotCount: 5, start,
  recordFields: address => ({ ip: address, username: 'maker', password: crypto.randomBytes(5).toString('hex') }),
  addressOf: rec => String(rec.ip || '').replace(/^https?:\/\//i, '').replace(/\/+$/, ''),
};
