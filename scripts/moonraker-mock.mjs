#!/usr/bin/env node
// Moonraker mock — a fake Klipper printer for developing the Klipper driver
// (renderer/printers/klipper/) without hardware. Node only, no dependencies.
//
//   npm run moonraker:mock                          # plain printer, port 7125
//   npm run moonraker:mock -- --profile happyhare   # Happy Hare MMU, 4 gates
//   npm run moonraker:mock -- --profile afc         # AFC / Box Turtle, 4 lanes
//   npm run moonraker:mock -- --port 7126 --api-key secret --spoolman
//
// Then in Studio: Add printer → Klipper → Enter IP address → 127.0.0.1:7125.
//
// What it answers (shapes from the Moonraker docs — see PROTOCOL.md):
//   GET  /server/info  /printer/info  /machine/system_info  /printer/objects/list
//   GET|POST /printer/objects/query        (query string or {objects:{…}})
//   POST /printer/print/{start|pause|resume|cancel}
//   POST /printer/gcode/script              (MMU_GATE_MAP, AFC SET_* parsed)
//   GET  /server/webcams/list  /webcam/?action=snapshot|stream (MJPEG)
//   GET  /server/files/list  /server/files/metadata  /server/files/gcodes/…
//   GET  /server/spoolman/status            (with --spoolman)
// A print runs for ~3 minutes once started (or on its own with --auto-print);
// temperatures follow their targets. Every request is logged.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : dflt; };
const flag = name => process.argv.includes(`--${name}`);
const PORT = Number(arg("port", 7125));
const PROFILE = arg("profile", "plain");           // plain | happyhare | afc
const API_KEY = arg("api-key", "");
const SPOOLMAN = flag("spoolman");
const AUTO_PRINT = flag("auto-print");

const IMG = fs.readFileSync(path.join(ROOT, "assets/img/Panda_Feed_Rack.png"));

// ── Printer state ───────────────────────────────────────────────────────────
const S = {
  webhooks: { state: "ready", state_message: "Printer is ready" },
  print_stats: { state: "standby", filename: "", print_duration: 0, total_duration: 0, filament_used: 0,
                 message: "", info: { current_layer: null, total_layer: null } },
  display_status: { progress: 0, message: null },
  virtual_sdcard: { progress: 0, file_path: null, is_active: false },
  extruder: { temperature: 24.1, target: 0, power: 0 },
  heater_bed: { temperature: 23.4, target: 0, power: 0 },
  toolhead: { extruder: "extruder", homed_axes: "", position: [0, 0, 0, 0] },
  fan: { speed: 0 },
  gcode_move: { speed_factor: 1, extrude_factor: 1 },
  "filament_switch_sensor runout": { filament_detected: true, enabled: true },
  "output_pin caselight": { value: 0 },             // a light on a plain pin (SET_PIN)
  "led chamber_led": { color_data: [[0, 0, 0, 0]] }, // an LED chain (SET_LED)
};
const BOUNDS = { x: [0, 300], y: [0, 300], z: [0, 250] };
let relative = false;
const COLORS = ["FF0000", "00A86B", "1E90FF", "FFD700"];
const MATS = ["PLA", "PETG", "ASA", "PLA"];
if (PROFILE === "happyhare") {
  S.mmu = {
    enabled: true, num_gates: 4, gate: 0, tool: 0, active_filament: { material: "PLA", color: "FF0000", spool_id: 1 },
    gate_status: [1, 1, 0, 2], gate_material: [...MATS], gate_color: [...COLORS],
    gate_color_rgb: COLORS.map(h => [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255)),
    gate_spool_id: [1, 2, -1, 4], ttg_map: [0, 1, 2, 3], filament: "Loaded", action: "Idle",
  };
}
const LANES = ["lane1", "lane2", "lane3", "lane4"];
if (PROFILE === "afc") {
  S.AFC = { lanes: LANES, units: ["Turtle_1"], current_lane: "lane1", spoolman: SPOOLMAN ? "http://127.0.0.1:7912" : null };
  LANES.forEach((l, i) => {
    S[`AFC_stepper ${l}`] = {
      name: l, unit: "Turtle_1", map: `T${i}`, load: i !== 2, prep: i !== 2, tool_loaded: i === 0,
      material: i === 2 ? "" : MATS[i], color: i === 2 ? "" : `#${COLORS[i]}`, multi_color_hexes: null,
      spool_id: i === 2 ? null : i + 10, weight: i === 2 ? 0 : 850 - i * 120, filament_name: i === 2 ? "" : `Mock ${MATS[i]}`,
      extruder_temp: 210, bed_temp: 60, status: i === 2 ? "None" : (i === 0 ? "Tooled" : "Loaded"), td1_td: null,
    };
  });
}
let activeSpool = 3;

const FILES = [
  { path: "benchy.gcode", modified: Date.now() / 1000 - 3600, size: 2_481_234, permissions: "rw" },
  { path: "calibration/cube.gcode", modified: Date.now() / 1000 - 86400, size: 381_220, permissions: "rw" },
];
const META = name => ({
  filename: name, size: 2_481_234, slicer: "OrcaSlicer", slicer_version: "2.2.0",
  estimated_time: 180, filament_total: 4210.5, filament_type: "PLA", filament_colors: ["#FF0000"],
  layer_height: 0.2, first_layer_height: 0.25, object_height: 48,
  thumbnails: [
    { width: 32, height: 32, size: 1200, relative_path: ".thumbs/" + path.basename(name, ".gcode") + "-32x32.png" },
    { width: 300, height: 300, size: IMG.length, relative_path: ".thumbs/" + path.basename(name, ".gcode") + "-300x300.png" },
  ],
});

let printTimer = null;
function startPrint(filename) {
  Object.assign(S.print_stats, { state: "printing", filename, print_duration: 0, total_duration: 0, filament_used: 0,
                                 info: { current_layer: 1, total_layer: 240 } });
  Object.assign(S.virtual_sdcard, { progress: 0, file_path: filename, is_active: true });
  S.extruder.target = 215; S.heater_bed.target = 60; S.toolhead.homed_axes = "xyz"; S.fan.speed = 0.8;
  clearInterval(printTimer);
  printTimer = setInterval(() => {
    if (S.print_stats.state !== "printing") return;
    S.print_stats.print_duration += 1; S.print_stats.total_duration += 1;
    const p = Math.min(1, S.virtual_sdcard.progress + 1 / 180);
    S.virtual_sdcard.progress = p; S.display_status.progress = p;
    S.print_stats.filament_used = Math.round(4210.5 * p);
    S.print_stats.info.current_layer = Math.max(1, Math.round(240 * p));
    if (p >= 1) { S.print_stats.state = "complete"; S.virtual_sdcard.is_active = false; S.extruder.target = 0; S.heater_bed.target = 0; S.fan.speed = 0; }
  }, 1000);
}
setInterval(() => {   // heaters converge to their target
  for (const h of [S.extruder, S.heater_bed]) {
    const goal = h.target > 0 ? h.target : 23;
    h.temperature = +(h.temperature + (goal - h.temperature) * 0.15 + (Math.random() - 0.5) * 0.3).toFixed(2);
    h.power = h.target > 0 ? 0.6 : 0;
  }
}, 1000);
if (AUTO_PRINT) startPrint("benchy.gcode");

// ── G-code macros (what the driver writes) ──────────────────────────────────
function params(line) {
  const out = {};
  for (const m of line.matchAll(/(\w+)=("([^"]*)"|\S+)/g)) out[m[1].toUpperCase()] = m[3] ?? m[2];
  return out;
}
function runGcode(script) {
  const lines = String(script || "").split(/\n/).map(s => s.trim()).filter(Boolean);
  for (const line of lines) {
    const cmd = line.split(/\s+/)[0].toUpperCase(), p = params(line);
    if (cmd === "MMU_GATE_MAP" && S.mmu) {
      const gates = p.GATES != null ? p.GATES.split(",").map(Number) : [Number(p.GATE)];
      for (const g of gates) {
        if (!(g >= 0 && g < S.mmu.num_gates)) throw new Error(`Invalid gate ${p.GATE}`);
        if (p.MATERIAL != null) S.mmu.gate_material[g] = p.MATERIAL;
        if (p.COLOR != null) {
          S.mmu.gate_color[g] = p.COLOR.replace(/^#/, "");
          const h = S.mmu.gate_color[g];
          if (/^[0-9a-f]{6}$/i.test(h)) S.mmu.gate_color_rgb[g] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
        }
        if (p.SPOOLID != null) S.mmu.gate_spool_id[g] = Number(p.SPOOLID);
        if (p.AVAILABLE != null) S.mmu.gate_status[g] = Number(p.AVAILABLE);
      }
    } else if (/^SET_(COLOR|MATERIAL|SPOOL_ID|WEIGHT|MAP)$/.test(cmd) && S.AFC) {
      const lane = S[`AFC_stepper ${p.LANE}`];
      if (!lane) throw new Error(`Unknown lane ${p.LANE}`);
      if (cmd === "SET_COLOR") lane.color = `#${String(p.COLOR).replace(/^#/, "")}`;
      if (cmd === "SET_MATERIAL") lane.material = p.MATERIAL;
      if (cmd === "SET_SPOOL_ID") lane.spool_id = p.SPOOL_ID ? Number(p.SPOOL_ID) : null;
      if (cmd === "SET_WEIGHT") lane.weight = Number(p.WEIGHT);
      if (cmd === "SET_MAP") lane.map = p.MAP;
    } else if (cmd === "M104" || cmd === "M109") S.extruder.target = Number(p.S ?? line.match(/S(\d+)/)?.[1] ?? 0);
    else if (cmd === "M140" || cmd === "M190") S.heater_bed.target = Number(line.match(/S(\d+)/)?.[1] ?? 0);
    else if (cmd === "G28") {
      const axes = ["X", "Y", "Z"].filter(a => line.toUpperCase().includes(a));
      for (const a of axes.length ? axes : ["X", "Y", "Z"]) {
        S.toolhead.position["XYZ".indexOf(a)] = 0;
        if (!S.toolhead.homed_axes.includes(a.toLowerCase())) S.toolhead.homed_axes += a.toLowerCase();
      }
      S.toolhead.homed_axes = [..."xyz"].filter(a => S.toolhead.homed_axes.includes(a)).join("");
    }
    else if (cmd === "G90") relative = false;
    else if (cmd === "G91") relative = true;
    else if (cmd === "G1" || cmd === "G0") {
      for (const m of line.toUpperCase().matchAll(/([XYZ])(-?[\d.]+)/g)) {
        const a = m[1].toLowerCase(), i = "xyz".indexOf(a), v = Number(m[2]);
        if (!S.toolhead.homed_axes.includes(a)) throw new Error("Must home axis first: " + line);
        const next = relative ? S.toolhead.position[i] + v : v;
        if (next < BOUNDS[a][0] || next > BOUNDS[a][1]) throw new Error(`Move out of range: ${line}`);
        S.toolhead.position[i] = +next.toFixed(3);
      }
    }
    else if (cmd === "M106") S.fan.speed = Math.max(0, Math.min(255, Number(line.match(/S([\d.]+)/i)?.[1] ?? 255))) / 255;
    else if (cmd === "M107") S.fan.speed = 0;
    else if (cmd === "M220") S.gcode_move.speed_factor = Number(line.match(/S([\d.]+)/i)?.[1] ?? 100) / 100;
    else if (cmd === "SET_PIN") {
      const pin = S[`output_pin ${p.PIN}`];
      if (!pin) throw new Error(`Unknown pin ${p.PIN}`);
      pin.value = Number(p.VALUE);
    }
    else if (cmd === "SET_LED") {
      const led = S[`led ${p.LED}`];
      if (!led) throw new Error(`Unknown LED ${p.LED}`);
      led.color_data = [["RED", "GREEN", "BLUE", "WHITE"].map(k => Number(p[k] ?? 0))];
    }
    else if (cmd === "FIRMWARE_RESTART") Object.assign(S.webhooks, { state: "ready", state_message: "Printer is ready" });
    console.log(`  gcode: ${line}`);
  }
}

// ── Objects query ───────────────────────────────────────────────────────────
function pick(name, fields) {
  const o = S[name];
  if (!o) return undefined;   // Moonraker silently omits unknown objects
  if (!fields || !fields.length) return structuredClone(o);
  const out = {};
  for (const f of fields) if (f in o) out[f] = structuredClone(o[f]);
  return out;
}
function query(objects) {
  const status = {};
  for (const [name, fields] of Object.entries(objects)) {
    const v = pick(name, fields);
    if (v !== undefined) status[name] = v;
  }
  return { eventtime: process.uptime(), status };
}

// ── HTTP ────────────────────────────────────────────────────────────────────
const json = (res, code, body) => {
  res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(body));
};
const ok = (res, result) => json(res, 200, { result });
const err = (res, code, message) => json(res, code, { error: { code, message } });

function readBody(req) {
  return new Promise(r => { let b = ""; req.on("data", c => (b += c)); req.on("end", () => { try { r(b ? JSON.parse(b) : {}); } catch { r({}); } }); });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const p = u.pathname;
  console.log(`${new Date().toISOString().slice(11, 19)} ${req.method} ${p}${u.search}`);
  if (API_KEY && !p.startsWith("/webcam") && req.headers["x-api-key"] !== API_KEY) return err(res, 401, "Unauthorized");
  const body = req.method === "POST" ? await readBody(req) : {};

  if (p === "/server/info") return ok(res, {
    klippy_connected: true, klippy_state: S.webhooks.state, moonraker_version: "v0.9.3-mock", api_version: [1, 5, 0],
    components: ["database", "file_manager", "klippy_apis", "machine", "webcam", "history", ...(SPOOLMAN ? ["spoolman"] : [])],
    failed_components: [], registered_directories: ["config", "gcodes", "logs"], warnings: [],
  });
  if (p === "/printer/info") return ok(res, {
    state: S.webhooks.state, state_message: S.webhooks.state_message, hostname: `mock-${PROFILE}`,
    software_version: "v0.12.0-mock", cpu_info: "4 core ARM", klipper_path: "/home/pi/klipper",
  });
  if (p === "/machine/system_info") return ok(res, { system_info: {
    cpu_info: { cpu_count: 4, model: "Raspberry Pi 4 Model B Rev 1.4", serial_number: `MOCK${PORT}` },
    distribution: { name: "MainsailOS", id: "debian", version: "12" },
    product_info: { machine_type: "Voron 2.4 (mock)", serial_number: `MOCK-${PROFILE}-${PORT}` },
  } });
  if (p === "/printer/objects/list") return ok(res, { objects: Object.keys(S) });
  if (p === "/printer/objects/query") {
    let objects = body.objects;
    if (!objects) {
      objects = {};
      for (const [k, v] of u.searchParams) objects[k] = v ? v.split(",") : null;
    }
    return ok(res, query(objects));
  }
  const pr = p.match(/^\/printer\/print\/(start|pause|resume|cancel)$/);
  if (pr && req.method === "POST") {
    const a = pr[1];
    if (a === "start") startPrint(u.searchParams.get("filename") || body.filename || "benchy.gcode");
    if (a === "pause" && S.print_stats.state === "printing") S.print_stats.state = "paused";
    if (a === "resume" && S.print_stats.state === "paused") S.print_stats.state = "printing";
    if (a === "cancel") { S.print_stats.state = "cancelled"; S.virtual_sdcard.is_active = false; S.extruder.target = 0; S.heater_bed.target = 0; }
    return ok(res, "ok");
  }
  if (p === "/printer/gcode/script" && req.method === "POST") {
    try { runGcode(u.searchParams.get("script") || body.script); return ok(res, "ok"); }
    catch (e) { return err(res, 400, e.message); }
  }
  if (p === "/server/webcams/list") return ok(res, { webcams: [{
    name: "Nozzle cam", service: "mjpegstreamer", enabled: true, icon: "mdiWebcam", target_fps: 2,
    stream_url: `http://127.0.0.1:${PORT}/webcam/?action=stream`, snapshot_url: `http://127.0.0.1:${PORT}/webcam/?action=snapshot`,
    flip_horizontal: false, flip_vertical: false, rotation: 0, aspect_ratio: "4:3", source: "config", uid: "mock-cam-1",
  }] });
  if (p === "/webcam/" || p === "/webcam") {
    if (u.searchParams.get("action") === "stream") {
      res.writeHead(200, { "Content-Type": "multipart/x-mixed-replace; boundary=frame", "Cache-Control": "no-cache" });
      const send = () => { res.write(`--frame\r\nContent-Type: image/png\r\nContent-Length: ${IMG.length}\r\n\r\n`); res.write(IMG); res.write("\r\n"); };
      send();
      const t = setInterval(send, 1000);
      req.on("close", () => clearInterval(t));
      return;
    }
    res.writeHead(200, { "Content-Type": "image/png" });
    return res.end(IMG);
  }
  if (p === "/server/files/list") return ok(res, FILES);
  if (p === "/server/files/metadata") return ok(res, META(u.searchParams.get("filename") || "benchy.gcode"));
  if (p.startsWith("/server/files/gcodes/")) {
    if (/\.png$/i.test(p)) { res.writeHead(200, { "Content-Type": "image/png" }); return res.end(IMG); }
    res.writeHead(200, { "Content-Type": "text/plain" }); return res.end("; mock gcode\nG28\n");
  }
  if (p === "/server/spoolman/status") {
    if (!SPOOLMAN) return err(res, 404, "Spoolman not configured");
    return ok(res, { spoolman_connected: true, pending_reports: [], spool_id: activeSpool });
  }
  if (p === "/server/spoolman/spool_id") {
    if (!SPOOLMAN) return err(res, 404, "Spoolman not configured");
    if (req.method === "POST") activeSpool = body.spool_id ?? null;
    return ok(res, { spool_id: activeSpool });
  }
  return err(res, 404, `Not found: ${p}`);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Moonraker mock — profile "${PROFILE}" on http://127.0.0.1:${PORT}` +
    `${API_KEY ? " (API key required)" : ""}${SPOOLMAN ? " + Spoolman" : ""}`);
  console.log(`Objects: ${Object.keys(S).join(", ")}`);
});
