/**
 * services/demo/faces/bambu-rtsp.js — the camera of the Bambu models that stream
 * RTSP (X1 family, X2D, H2 family, P2S — catalog `camera_transport: "rtsp"`):
 * RTSP over TLS on port 322, `rtsps://bblp:<access code>@host:322/streaming/live/1`,
 * H.264 over RTP interleaved on the TCP connection (clients ask `-rtsp_transport
 * tcp`, Studio's main.js `bambulab:cam-start-rtsp` among them).
 *
 * One ffmpeg per viewer: the machine's camera frames (library.frameFor, JPEG,
 * 5 fps) go in on stdin, H.264 RTP comes out on a local UDP port, and each RTP
 * packet is relayed to the viewer as an interleaved `$` frame. The SDP is the one
 * ffmpeg writes, with the address blanked and a control URL added.
 *
 * Port 322 is below 1024: served through the shared raw-TCP router (common.js).
 */
'use strict';

const tls = require('tls');
const dgram = require('dgram');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { routeLowPortTcp } = require('./common');

const REALM = 'Bambu Lab';

function startViewer({ m, library, ffmpegPath, onRtp }) {
  return new Promise((resolve, reject) => {
    const udp = dgram.createSocket('udp4');
    udp.on('message', pkt => onRtp(pkt));
    udp.bind(0, '127.0.0.1', () => {
      const port = udp.address().port;
      const sdpFile = path.join(os.tmpdir(), `tigertag-demo-rtsp-${process.pid}-${port}.sdp`);
      const ff = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error',
        '-f', 'mjpeg', '-framerate', '5', '-i', 'pipe:0',
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-pix_fmt', 'yuv420p',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-g', '10',
        '-f', 'rtp', '-sdp_file', sdpFile, `rtp://127.0.0.1:${port}?pkt_size=1300`], { windowsHide: true });
      const feed = () => {
        const f = library.frameFor(m);
        if (f && f.type === 'image/jpeg' && ff.stdin.writable) ff.stdin.write(f.data);
      };
      feed();
      const t = setInterval(feed, 200);
      ff.stdin.on('error', () => {});
      const stop = () => {
        clearInterval(t);
        try { ff.stdin.end(); } catch (_) {}
        try { ff.kill('SIGKILL'); } catch (_) {}
        try { udp.close(); } catch (_) {}
        fs.unlink(sdpFile, () => {});
      };
      ff.on('close', stop);
      // ffmpeg writes the SDP once its output is open (first frame in).
      const t0 = Date.now();
      const poll = () => {
        let sdp = '';
        try { sdp = fs.readFileSync(sdpFile, 'utf8'); } catch (_) {}
        if (sdp.includes('m=video')) return resolve({ sdp, stop });
        if (Date.now() - t0 > 5000) { stop(); return reject(new Error('no SDP')); }
        setTimeout(poll, 50);
      };
      poll();
    });
  });
}

/** The SDP as a server hands it out: no address of ours, one controllable track. */
function describeSdp(raw) {
  return raw.replace(/\r?\n/g, '\r\n')
    .replace(/^c=IN IP4 .*$/m, 'c=IN IP4 0.0.0.0')
    .replace(/^m=video \d+ /m, 'm=video 0 ')
    .replace(/(m=video[^\r]*\r\n)/, '$1a=control:trackID=0\r\n')
    .replace(/^s=.*$/m, 's=Bambu Lab demo camera')
    .trimEnd() + '\r\n';
}

/**
 * Serve the RTSPS camera of one demo Bambu on `host` (port 322, shared router).
 * Resolves with close().
 */
async function startBambuRtsp({ host, m, library, accessCode, keys, ffmpegPath }) {
  const sessions = new Set();
  const expected = `Basic ${Buffer.from(`bblp:${accessCode}`).toString('base64')}`;

  const onConnection = raw => {
    const sock = new tls.TLSSocket(raw, { isServer: true, ...keys });
    let buf = '', viewer = null, playing = false;
    const session = Math.random().toString(16).slice(2, 10).toUpperCase();
    const close = () => { viewer?.stop(); viewer = null; sessions.delete(close); try { sock.destroy(); } catch (_) {} };
    sessions.add(close);
    const reply = (cseq, status, headers = {}, body = '') => {
      if (sock.destroyed) return;
      const h = { CSeq: cseq, Server: 'Bambu Lab RTSP', ...headers };
      if (body) h['Content-Length'] = Buffer.byteLength(body);
      sock.write(`RTSP/1.0 ${status}\r\n${Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n${body}`);
    };
    const onRtp = pkt => {
      if (!playing || sock.destroyed) return;
      const hdr = Buffer.from([0x24, 0, pkt.length >> 8, pkt.length & 0xFF]);
      sock.write(Buffer.concat([hdr, pkt]));
    };

    sock.on('data', async d => {
      buf += d.toString('latin1');
      let end;
      for (;;) {
        // RTCP from the viewer arrives as interleaved `$` frames between requests.
        while (buf.charCodeAt(0) === 0x24 && buf.length >= 4) {
          const n = (buf.charCodeAt(2) << 8) | buf.charCodeAt(3);
          if (buf.length < 4 + n) break;
          buf = buf.slice(4 + n);
        }
        if (buf.charCodeAt(0) === 0x24 || (end = buf.indexOf('\r\n\r\n')) < 0) break;
        const head = buf.slice(0, end); buf = buf.slice(end + 4);
        const lines = head.split('\r\n');
        const [method, url] = lines[0].split(' ');
        const hdr = Object.fromEntries(lines.slice(1).map(l => { const i = l.indexOf(':'); return [l.slice(0, i).trim().toLowerCase(), l.slice(i + 1).trim()]; }));
        const cseq = hdr.cseq || '0';
        const len = Number(hdr['content-length'] || 0);
        if (len) buf = buf.slice(len);   // no request body is used
        if (method === 'OPTIONS') { reply(cseq, '200 OK', { Public: 'OPTIONS, DESCRIBE, SETUP, PLAY, TEARDOWN, GET_PARAMETER' }); continue; }
        if (hdr.authorization !== expected) { reply(cseq, '401 Unauthorized', { 'WWW-Authenticate': `Basic realm="${REALM}"` }); continue; }
        switch (method) {
          case 'DESCRIBE':
            if (!/\/streaming\/live\/1\/?$/.test(url || '')) { reply(cseq, '404 Not Found'); break; }
            if (!viewer) {
              try { viewer = await startViewer({ m, library, ffmpegPath, onRtp }); }
              catch (_) { reply(cseq, '503 Service Unavailable'); break; }
            }
            reply(cseq, '200 OK', { 'Content-Type': 'application/sdp', 'Content-Base': `${url.replace(/\/$/, '')}/` }, describeSdp(viewer.sdp));
            break;
          case 'SETUP':
            reply(cseq, '200 OK', { Transport: 'RTP/AVP/TCP;unicast;interleaved=0-1', Session: `${session};timeout=60` });
            break;
          case 'PLAY':
            playing = true;
            reply(cseq, '200 OK', { Session: session, Range: 'npt=0.000-' });
            break;
          case 'GET_PARAMETER': case 'SET_PARAMETER':
            reply(cseq, '200 OK', { Session: session });
            break;
          case 'TEARDOWN':
            reply(cseq, '200 OK', { Session: session });
            close();
            break;
          default: reply(cseq, '405 Method Not Allowed');
        }
      }
    });
    sock.on('close', close);
    sock.on('error', close);
  };

  const unroute = await routeLowPortTcp(322, host, onConnection);
  return () => { unroute(); for (const c of [...sessions]) c(); };
}

module.exports = { startBambuRtsp };
