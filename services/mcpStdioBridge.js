'use strict';
/**
 * stdio ⇄ HTTP bridge for Tiger Studio Manager's local MCP server.
 *
 * Some MCP clients (Claude Desktop) launch servers as a subprocess and talk
 * JSON-RPC over stdin/stdout. Studio's server is HTTP on 127.0.0.1, so this
 * relays each stdin line to it and writes the reply to stdout. Studio copies
 * this file into its user-data folder and the client runs it with Studio's own
 * binary in Node mode (ELECTRON_RUN_AS_NODE=1) — no separate Node install.
 *
 * Env: TIGER_MCP_URL (http://127.0.0.1:<port>/mcp), TIGER_MCP_TOKEN.
 * Dependency-free on purpose: it runs outside the app bundle.
 */
const http = require('http');
const readline = require('readline');

const url = new URL(process.env.TIGER_MCP_URL || 'http://127.0.0.1:5795/mcp');
const token = process.env.TIGER_MCP_TOKEN || '';

function post(line) {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${token}`,
        'Content-Length': Buffer.byteLength(line),
      },
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', (e) => resolve({ status: 0, body: '', error: e.message }));
    req.end(line);
  });
}

function errorReply(line, message) {
  let id = null;
  try { id = JSON.parse(line).id ?? null; } catch (_) {}
  if (id === null) return null;   // a notification gets no reply
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message } });
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  if (!line.trim()) return;
  const r = await post(line);
  let out;
  if (r.status === 0) out = errorReply(line, 'Tiger Studio Manager is not running, or its AI assistant access is turned off (Settings).');
  else if (r.status === 202 || !r.body) out = null;
  else out = r.body;
  if (out) process.stdout.write(out + '\n');
});
