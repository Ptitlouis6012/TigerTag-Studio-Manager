#!/usr/bin/env node
/**
 * devdrive — drive the running DEV app from the command line (test harness).
 *
 * Start the app with `npm run start:drive` (main.js then opens Chromium's
 * DevTools protocol on 127.0.0.1:9339 — dev builds only, never packaged).
 * Then:
 *
 *   npm run drive -- eval   "<js expression>"        # prints the JSON result (awaits promises)
 *   npm run drive -- click  "<css selector>"         # scrolls into view + clicks
 *   npm run drive -- type   "<css selector>" "text"  # sets the value, fires input + change
 *   npm run drive -- wait   "<css selector>" [ms]    # waits until it exists and is visible
 *   npm run drive -- shot   out.png ["<css selector>"]  # window, or just that element
 *   npm run drive -- logs   [seconds]                # console + uncaught errors for N s
 *   npm run drive -- reload
 *
 * Port: TIGER_DEVDRIVE_PORT (default 9339). Pure Node 22 (global fetch +
 * WebSocket), no dependency.
 */
import fs from 'node:fs/promises';

const PORT = process.env.TIGER_DEVDRIVE_PORT || '9339';
const [cmd, ...args] = process.argv.slice(2);

function die(msg) { console.error(`[devdrive] ${msg}`); process.exit(1); }

async function pageTarget() {
  let list;
  try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); }
  catch { die(`no app on 127.0.0.1:${PORT} — start it with \`npm run start:drive\``); }
  const page = list.find(t => t.type === 'page' && /inventory\.html/.test(t.url))
            || list.find(t => t.type === 'page');
  if (!page) die('no renderer page found');
  return page;
}

async function connect() {
  const page = await pageTarget();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('websocket failed')); });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    } else if (msg.method) listeners.forEach(fn => fn(msg));
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const n = ++id;
    pending.set(n, { res, rej });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  return { send, on: fn => listeners.push(fn), close: () => ws.close() };
}

async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true, userGesture: true,
  });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  }
  return r.result.value;
}

const sel = s => JSON.stringify(s);

async function main() {
  if (!cmd) die('usage: eval | click | type | wait | shot | logs | reload  (see the header of scripts/devdrive.mjs)');
  const cdp = await connect();
  try {
    switch (cmd) {
      case 'eval': {
        const v = await evaluate(cdp, args[0]);
        console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
        break;
      }
      case 'click': {
        const ok = await evaluate(cdp, `(() => { const el = document.querySelector(${sel(args[0])});
          if (!el) return false; el.scrollIntoView({ block: 'center' }); el.click(); return true; })()`);
        if (!ok) die(`not found: ${args[0]}`);
        console.log('clicked');
        break;
      }
      case 'type': {
        const ok = await evaluate(cdp, `(() => { const el = document.querySelector(${sel(args[0])});
          if (!el) return false; el.focus(); el.value = ${sel(args[1] ?? '')};
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
        if (!ok) die(`not found: ${args[0]}`);
        console.log('typed');
        break;
      }
      case 'wait': {
        const ms = Number(args[1] || 5000);
        const ok = await evaluate(cdp, `new Promise(res => { const t0 = Date.now(); (function tick() {
          const el = document.querySelector(${sel(args[0])});
          if (el && el.getClientRects().length) return res(true);
          if (Date.now() - t0 > ${ms}) return res(false); setTimeout(tick, 100); })(); })`);
        if (!ok) die(`timed out after ${ms} ms: ${args[0]}`);
        console.log('present');
        break;
      }
      case 'shot': {
        const out = args[0] || 'devdrive.png';
        const params = { format: 'png' };
        if (args[1]) {
          const r = await evaluate(cdp, `(() => { const el = document.querySelector(${sel(args[1])});
            if (!el) return null; el.scrollIntoView({ block: 'center' });
            const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; })()`);
          if (!r) die(`not found: ${args[1]}`);
          params.clip = { ...r, scale: 1 };
        }
        const { data } = await cdp.send('Page.captureScreenshot', params);
        await fs.writeFile(out, Buffer.from(data, 'base64'));
        console.log(out);
        break;
      }
      case 'logs': {
        const secs = Number(args[0] || 5);
        cdp.on(({ method, params }) => {
          if (method === 'Runtime.consoleAPICalled') {
            const text = params.args.map(a => a.value ?? a.description ?? '').join(' ');
            console.log(`[${params.type}] ${text}`);
          } else if (method === 'Runtime.exceptionThrown') {
            console.log(`[exception] ${params.exceptionDetails.exception?.description || params.exceptionDetails.text}`);
          }
        });
        await cdp.send('Runtime.enable');
        await new Promise(r => setTimeout(r, secs * 1000));
        break;
      }
      case 'reload': {
        await cdp.send('Page.reload');
        console.log('reloaded');
        break;
      }
      default: die(`unknown command: ${cmd}`);
    }
  } finally { cdp.close(); }
}

main().catch(e => die(e.message));
