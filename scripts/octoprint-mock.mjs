#!/usr/bin/env node
/**
 * scripts/octoprint-mock.mjs — a fake OctoPrint (with a Marlin printer behind
 * it) for testing the OctoPrint printer plugin without hardware. No dependency.
 *
 *   npm run octoprint:mock -- [--port 5000] [--api-key KEY] [--tools 1]
 *                             [--auto-print] [--closed] [--approve-after 4]
 *
 *   GET  /plugin/appkeys/probe                 204
 *   POST /plugin/appkeys/request               201 { app_token }
 *   GET  /plugin/appkeys/request/<token>       202 pending → 200 { api_key } after --approve-after s
 *   GET  /api/version /api/connection /api/printer /api/job /api/settings /api/printerprofiles
 *   POST /api/connection /api/job /api/printer/printhead /api/printer/command
 *   GET  /api/files/local/<path>               { thumbnail }
 *   GET  /plugin/prusaslicerthumbnails/thumbnail/<file>.png
 *   GET  /webcam/?action=stream|snapshot       MJPEG / PNG
 *
 * --closed starts with the serial link down (GET /api/printer → 409) until a
 * POST /api/connection { command: "connect" }. Every /api call needs X-Api-Key.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? def : (process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : true); };
const PORT = Number(arg("port", 5000));
const API_KEY = String(arg("api-key", "octomockkey"));
const TOOLS = Math.max(1, Number(arg("tools", 1)) || 1);
const APPROVE_AFTER = Number(arg("approve-after", 4)) * 1000;
const IMG = fs.readFileSync(path.join(ROOT, "assets/img/Panda_Feed_Rack.png"));

const S = {
  link: arg("closed", false) ? "Closed" : "Operational",
  temps: Object.fromEntries([...Array.from({ length: TOOLS }, (_, i) => [`tool${i}`, { actual: 24.2, target: 0 }]), ["bed", { actual: 23.5, target: 0 }]]),
  flags: { printing: false, paused: false, pausing: false, cancelling: false, error: false },
  job: null, completion: null, printTime: 0, pos: { x: 0, y: 0, z: 0 }, homed: new Set(), fan: 0, speed: 100,
};
let timer = null;

function startPrint(file = "benchy.gcode") {
  S.job = { name: file, path: file, origin: "local", estimatedPrintTime: 180 };
  S.completion = 0; S.printTime = 0; Object.assign(S.flags, { printing: true, paused: false, cancelling: false });
  S.temps.tool0.target = 210; S.temps.bed.target = 60; S.homed = new Set(["x", "y", "z"]);
  clearInterval(timer);
  timer = setInterval(() => {
    if (!S.flags.printing || S.flags.paused) return;
    S.printTime += 1;
    S.completion = Math.min(100, S.completion + 100 / 180);
    if (S.completion >= 100) { S.flags.printing = false; S.temps.tool0.target = 0; S.temps.bed.target = 0; clearInterval(timer); }
  }, 1000);
}
setInterval(() => {
  for (const h of Object.values(S.temps)) {
    const goal = h.target > 0 ? h.target : 23;
    h.actual = +(h.actual + (goal - h.actual) * 0.15 + (Math.random() - 0.5) * 0.3).toFixed(2);
  }
}, 1000);
if (arg("auto-print", false)) startPrint();

const tokens = new Map();   // app_token → requestedAt

const send = (res, code, body, type = "application/json") => {
  res.writeHead(code, { "Content-Type": type });
  res.end(type === "application/json" && body !== undefined ? JSON.stringify(body) : body);
};
const readBody = req => new Promise(r => { let b = ""; req.on("data", c => (b += c)); req.on("end", () => { try { r(b ? JSON.parse(b) : {}); } catch { r({}); } }); });
const stateText = () => S.link !== "Operational" ? S.link
  : S.flags.cancelling ? "Cancelling" : S.flags.paused ? "Paused" : S.flags.printing ? "Printing" : "Operational";

function gcode(line) {
  const [cmd] = line.trim().toUpperCase().split(/\s+/);
  const n = re => Number((line.match(re) || [])[1]);
  if (cmd === "M106") S.fan = Math.round((isFinite(n(/S(\d+)/i)) ? n(/S(\d+)/i) : 255) / 2.55);
  else if (cmd === "M107") S.fan = 0;
  else if (cmd === "M220") S.speed = n(/S(\d+)/i) || 100;
  console.log(`  gcode: ${line}  (fan ${S.fan}% speed ${S.speed}%)`);
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`), p = u.pathname, m = req.method;
  if (p === "/webcam/" || p === "/webcam") {
    if (u.searchParams.get("action") === "snapshot") return send(res, 200, IMG, "image/png");
    res.writeHead(200, { "Content-Type": "multipart/x-mixed-replace; boundary=frame" });
    const t = setInterval(() => { res.write(`--frame\r\nContent-Type: image/png\r\nContent-Length: ${IMG.length}\r\n\r\n`); res.write(IMG); res.write("\r\n"); }, 500);
    return req.on("close", () => clearInterval(t));
  }
  if (p === "/plugin/appkeys/probe") return send(res, 204, "");
  if (p === "/plugin/appkeys/request" && m === "POST") {
    const tok = Math.random().toString(36).slice(2, 12); tokens.set(tok, Date.now());
    console.log(`  appkeys: access request ${tok} (auto-approved in ${APPROVE_AFTER / 1000} s)`);
    return send(res, 201, { app_token: tok });
  }
  const tm = p.match(/^\/plugin\/appkeys\/request\/(\w+)$/);
  if (tm) {
    const at = tokens.get(tm[1]);
    if (!at) return send(res, 404, { error: "unknown" });
    return Date.now() - at < APPROVE_AFTER ? send(res, 202, { app_token: tm[1] }) : send(res, 200, { api_key: API_KEY });
  }
  if (/^\/plugin\/prusaslicerthumbnails\/thumbnail\//.test(p)) return send(res, 200, IMG, "image/png");
  if (!p.startsWith("/api/")) return send(res, 404, "not found", "text/plain");
  if (req.headers["x-api-key"] !== API_KEY) return send(res, 403, { error: "Forbidden" });
  const body = m === "POST" ? await readBody(req) : {};

  if (p === "/api/version") return send(res, 200, { api: "0.1", server: "1.10.2", text: "OctoPrint 1.10.2 (mock)" });
  if (p === "/api/connection") {
    if (m === "POST" && body.command === "connect") { S.link = "Operational"; return send(res, 204, ""); }
    return send(res, 200, { current: { state: stateText(), port: "/dev/ttyUSB0", baudrate: 115200, printerProfile: "_default" } });
  }
  if (p === "/api/printer") {
    if (S.link !== "Operational") return send(res, 409, { error: "Printer is not operational" });
    return send(res, 200, { temperature: S.temps, state: { text: stateText(), flags: { operational: true, ready: !S.flags.printing, ...S.flags } } });
  }
  if (p === "/api/job") {
    if (m === "POST") {
      if (body.command === "cancel") { Object.assign(S.flags, { printing: false, paused: false }); S.temps.tool0.target = 0; S.temps.bed.target = 0; }
      else if (body.command === "pause") S.flags.paused = body.action === "resume" ? false : body.action === "toggle" ? !S.flags.paused : true;
      else if (body.command === "start") startPrint(S.job?.path);
      return send(res, 204, "");
    }
    return send(res, 200, { job: { file: S.job ? { name: S.job.name, path: S.job.path, origin: "local" } : { name: null }, estimatedPrintTime: S.job?.estimatedPrintTime ?? null },
      progress: { completion: S.completion, printTime: S.job ? S.printTime : null, printTimeLeft: S.job && S.completion < 100 ? Math.round(180 - S.printTime) : null }, state: stateText() });
  }
  if (p === "/api/settings") return send(res, 200, { webcam: { webcamEnabled: true, streamUrl: "/webcam/?action=stream", snapshotUrl: `http://127.0.0.1:${PORT}/webcam/?action=snapshot`, flipH: false, flipV: false, rotate90: false } });
  if (p === "/api/printerprofiles") return send(res, 200, { profiles: { _default: { id: "_default", name: "Mock Marlin", current: true, default: true, heatedBed: true, heatedChamber: false, extruder: { count: TOOLS } } } });
  if (p === "/api/printer/printhead" && m === "POST") {
    if (S.link !== "Operational") return send(res, 409, { error: "Printer is not operational" });
    if (body.command === "home") { for (const a of body.axes || []) { S.homed.add(a); S.pos[a] = 0; } return send(res, 204, ""); }
    if (body.command === "jog") {
      for (const a of ["x", "y", "z"]) if (body[a] != null) {
        if (!S.homed.has(a)) return send(res, 409, { error: `Axis ${a.toUpperCase()} is not homed` });
        S.pos[a] += Number(body[a]);
      }
      console.log(`  jog → ${JSON.stringify(S.pos)}`);
      return send(res, 204, "");
    }
    return send(res, 400, { error: "unknown command" });
  }
  if (p === "/api/printer/command" && m === "POST") { (body.commands || [body.command]).filter(Boolean).forEach(gcode); return send(res, 204, ""); }
  const fm = p.match(/^\/api\/files\/local\/(.+)$/);
  if (fm) return send(res, 200, { name: decodeURIComponent(fm[1]), path: decodeURIComponent(fm[1]), thumbnail: `plugin/prusaslicerthumbnails/thumbnail/${encodeURIComponent(fm[1])}.png?20240101` });
  return send(res, 404, { error: "not found" });
}).listen(PORT, () => console.log(`OctoPrint mock on http://127.0.0.1:${PORT}  api key: ${API_KEY}  tools: ${TOOLS}`));
