/**
 * services/demo/faces/bambu-ftps.js — the Bambu Lab printer's file server, as a
 * client sees it: implicit FTPS on port 990 (TLS from the first byte), user
 * "bblp" + the access code, passive mode, the print files as `.3mf` archives.
 *
 * What clients do with it (Studio: main.js `bambulab:fetch-thumbnail`, see
 * renderer/printers/bambulab/PROTOCOL.md §11): look for the current job's .3mf in
 * /model, /cache, /, /data, /data/Metadata by name, else LIST and match, then pull
 * `Metadata/plate_N.png` out of it. So every library print exists here as
 * `<id>.gcode.3mf` (in /model and /cache, like a real printer keeps the live slice
 * and the older ones) — a ZIP whose `Metadata/plate_1.png` is the print's thumbnail.
 *
 * Iso quirks kept on purpose: PASV answers host 0.0.0.0 (the real firmware does;
 * clients rewrite it to the control host), data connections are TLS (PROT P).
 * Port 990 is below 1024: served through the shared raw-TCP router.
 */
'use strict';

const net = require('net');
const tls = require('tls');
const { routeLowPortTcp } = require('./common');

// ── A minimal ZIP writer (stored entries) — a .3mf is a ZIP ───────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function zip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8'), crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8); ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, data);
    centrals.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** The .3mf of a library print: its plate thumbnail, as Bambu Studio lays it out. */
function threeMf(library, print) {
  const png = library.thumbnail(print.id);
  const entries = [
    { name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="png" ContentType="image/png"/><Default Extension="gcode" ContentType="text/x.gcode"/></Types>\n') },
    { name: 'Metadata/plate_1.gcode', data: Buffer.from(`; demo print ${print.id}\nG28\n`) },
  ];
  if (png) entries.push({ name: 'Metadata/plate_1.png', data: png });
  return zip(entries);
}

const DIRS = ['/model', '/cache'];
const ls = (date, size, name) => `-rw-r--r--    1 0        0        ${String(size).padStart(10)} ${date} ${name}`;

/**
 * Serve the FTPS of one demo Bambu on `host` (port 990, shared router).
 * Resolves with close(); rejects if port 990 cannot be bound at all.
 */
async function startBambuFtps({ host, library, accessCode, keys }) {
  const fileFor = path => {
    const m = String(path || '').match(/^\/?(?:(model|cache|data|data\/Metadata)\/)?([^/]+)\.gcode\.3mf$/) ||
              String(path || '').match(/^\/?(?:(model|cache|data|data\/Metadata)\/)?([^/]+)\.3mf$/);
    const print = m && library.get(m[2]);
    return print ? threeMf(library, print) : null;
  };
  const sessions = new Set();

  const onConnection = raw => {
    const ctl = new tls.TLSSocket(raw, { isServer: true, ...keys });
    sessions.add(ctl);
    let user = null, authed = false, cwd = '/', pasv = null;
    const reply = line => { if (!ctl.destroyed) ctl.write(`${line}\r\n`); };
    // Passive data channel: a TLS listener on this host, one connection.
    const openPassive = () => new Promise(resolve => {
      if (pasv) { try { pasv.server.close(); } catch (_) {} }
      const waiters = [];
      const server = net.createServer(sock => {
        const data = new tls.TLSSocket(sock, { isServer: true, ...keys });
        pasv.socket = data;
        waiters.splice(0).forEach(w => w(data));
        server.close();
      });
      pasv = { server, socket: null, next: () => new Promise(r => (pasv.socket ? r(pasv.socket) : waiters.push(r))) };
      server.listen(0, host, () => resolve(server.address().port));
    });
    const send = async (buf, label) => {
      if (!pasv) return reply('425 Use PASV first.');
      reply(`150 Opening BINARY mode data connection for ${label}.`);
      const data = await Promise.race([pasv.next(), new Promise(r => setTimeout(() => r(null), 8000))]);
      if (!data) { pasv = null; return reply('425 Can\'t open data connection.'); }
      data.end(buf, () => reply('226 Transfer complete.'));
      pasv = null;
    };

    reply('220 Bambu Lab FTP Server');
    let buf = '';
    ctl.on('data', async d => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        const sp = line.indexOf(' ');
        const cmd = (sp < 0 ? line : line.slice(0, sp)).toUpperCase(), arg = sp < 0 ? '' : line.slice(sp + 1);
        if (cmd === 'USER') { user = arg; reply('331 Password required.'); continue; }
        if (cmd === 'PASS') {
          authed = user === 'bblp' && arg === accessCode;
          reply(authed ? '230 User logged in.' : '530 Login incorrect.');
          continue;
        }
        if (cmd === 'QUIT') { reply('221 Goodbye.'); ctl.end(); continue; }
        if (!authed) { reply('530 Please login with USER and PASS.'); continue; }
        switch (cmd) {
          case 'SYST': reply('215 UNIX Type: L8'); break;
          case 'FEAT': reply('211-Features:\r\n PASV\r\n SIZE\r\n UTF8\r\n PBSZ\r\n PROT\r\n211 End'); break;
          case 'PWD': reply(`257 "${cwd}" is the current directory.`); break;
          case 'CWD': cwd = arg.startsWith('/') ? arg : `${cwd.replace(/\/$/, '')}/${arg}`; reply('250 Directory changed.'); break;
          case 'TYPE': case 'STRU': case 'MODE': case 'OPTS': case 'NOOP': reply('200 OK.'); break;
          case 'PBSZ': reply('200 PBSZ=0'); break;
          case 'PROT': reply('200 Protection level set to P.'); break;
          case 'PASV': {
            const port = await openPassive();
            reply(`227 Entering Passive Mode (0,0,0,0,${port >> 8},${port & 255}).`);   // 0.0.0.0, like the real firmware
            break;
          }
          // No EPSV: clients fall back to PASV, the path they take with the real firmware.
          case 'SIZE': { const f = fileFor(arg); reply(f ? `213 ${f.length}` : '550 File not found.'); break; }
          case 'RETR': { const f = fileFor(arg); if (!f) { reply('550 File not found.'); break; } await send(f, arg); break; }
          case 'LIST': case 'NLST': case 'MLSD': {
            const dir = (arg.replace(/^-\S+\s*/, '') || cwd).replace(/\/$/, '') || '/';
            const files = DIRS.includes(dir) ? library.list().map(p => ({ name: `${p.id}.gcode.3mf`, size: threeMf(library, p).length })) : [];
            const text = files.map(f => (cmd === 'NLST' ? f.name : ls('Oct 15 12:00', f.size, f.name))).join('\r\n');
            await send(Buffer.from(text ? `${text}\r\n` : ''), dir);
            break;
          }
          default: reply('502 Command not implemented.');
        }
      }
    });
    const end = () => { sessions.delete(ctl); if (pasv) { try { pasv.server.close(); } catch (_) {} } };
    ctl.on('close', end);
    ctl.on('error', end);
  };

  const unroute = await routeLowPortTcp(990, host, onConnection);
  return () => { unroute(); for (const s of sessions) s.destroy(); };
}

module.exports = { startBambuFtps };
