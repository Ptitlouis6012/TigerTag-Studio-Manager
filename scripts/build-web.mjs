#!/usr/bin/env node
// Build Tiger Studio Web — a static copy of the renderer that runs in a browser.
//
// There is no bundler: the renderer is plain ES modules + the Firebase compat
// SDK, so the "build" is a filtered copy that keeps the repo's tree layout
// (renderer/ next to assets/ and data/), because the renderer reaches its
// data with relative paths such as `../assets/db/tigertag/` and `../data/`.
//
//   dist-web/
//     index.html          → the app page, with <base href="<base>renderer/">
//     renderer/ data/ assets/   (desktop-only and doc files left out)
//     manifest.webmanifest → makes it installable as an app (PWA)
//     version.json        → { version } for the host / support
//
// The Hub (TigerTag_Hub) builds this folder into its public/studio/ with
// --base /studio/ and serves the page at the ROOT of studio.tigersystem.io (the
// subdomain rewrites "/" to /studio/index.html; tigersystem.io/studio redirects
// there).
// Usage: npm run web:build  [-- --out <dir>] [--base /studio/] [--web-build N]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.indexOf("--out");
const OUT = path.resolve(ROOT, outArg > -1 ? process.argv[outArg + 1] : "dist-web");
// Public path the folder is served under, with a trailing slash ("/studio/" on the Hub).
const baseArg = process.argv.indexOf("--base");
const BASE = (baseArg > -1 ? process.argv[baseArg + 1] : "/").replace(/\/?$/, "/");
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
// Web hotfix number on top of the desktop release (tag web-vX.Y.Z.N → N; 0 =
// the release itself). The X.Y.Z never moves without a desktop release — see
// docs/WEB_HOTFIX.md.
const wbArg = process.argv.indexOf("--web-build");
const WEB_BUILD = wbArg > -1 ? Math.max(0, parseInt(process.argv[wbArg + 1], 10) || 0) : 0;

// Top-level folders shipped to the browser.
const INCLUDE = ["renderer", "data", "assets"];

// Paths (relative to ROOT, forward slashes) never shipped: docs, marketing
// artwork the app never loads, maintenance scripts.
const EXCLUDE_PREFIX = [
  "assets/img/screenshots/",
  "assets/img/tiger_studio_and_tiger_rfid_connect_mockup.png",
  "assets/img/ndef_asset/",
  "assets/db/tigertag/db_update.py",
];
const EXCLUDE_EXT = [".md", ".py", ".DS_Store"];

let files = 0, bytes = 0;

function copyTree(rel) {
  const src = path.join(ROOT, rel);
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    for (const name of fs.readdirSync(src)) copyTree(path.posix.join(rel, name));
    return;
  }
  if (EXCLUDE_PREFIX.some(p => rel === p || rel.startsWith(p))) return;
  if (EXCLUDE_EXT.some(e => rel.endsWith(e))) return;
  const dst = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  files++; bytes += st.size;
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const dir of INCLUDE) copyTree(dir);

// Stamp the version into the web bridge (shown in Settings → About).
const bridge = path.join(OUT, "renderer/web-bridge.js");
fs.writeFileSync(bridge, fs.readFileSync(bridge, "utf8")
  .replace("__STUDIO_WEB_VERSION__", VERSION)
  .replace("__STUDIO_WEB_BUILD__", String(WEB_BUILD)));

// Entry point: the app page itself, at the folder's root — on the Hub it is
// served at "/" of studio.tigersystem.io, an address that is NOT the folder the
// files live in (/studio/). A <base> pointing at renderer/ makes every relative
// URL of the page — stylesheets, scripts, fetch("../data/…") — resolve exactly as
// it does from renderer/inventory.html. It must be absolute for that reason: a
// relative "renderer/" would resolve against wherever the page is served. The
// page has no #anchors, which a <base> would break.
//
// Installable app (PWA): a web manifest + the home-screen tags iOS reads. Its
// scope is the folder WITHOUT the trailing slash, so a page served at the bare
// folder address stays inside it. The Hub then sets id / start_url / scope to
// "/" after the build (scripts/fetch-studio-web.mjs), because there the
// installed app lives at the root of studio.tigersystem.io.
// No service worker: Chrome no longer requires one to install, and an offline
// cache of a 38k-line app would serve a stale version after every release.
const SCOPE = BASE === "/" ? "/" : BASE.replace(/\/$/, "");
const manifest = {
  name: "Tiger Studio",
  short_name: "Tiger Studio",
  description: "Every spool you own, weighed, sorted and impossible to lose.",
  id: SCOPE,
  start_url: SCOPE,
  scope: SCOPE,
  display: "standalone",
  background_color: "#0f1117",
  theme_color: "#0f1117",
  icons: [
    { src: `${BASE}assets/favicon/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
    { src: `${BASE}assets/favicon/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
  ],
};
fs.writeFileSync(path.join(OUT, "manifest.webmanifest"), JSON.stringify(manifest, null, 2) + "\n");
const PWA_HEAD = [
  `<link rel="manifest" href="${BASE}manifest.webmanifest">`,
  `<meta name="theme-color" content="#0f1117">`,
  `<link rel="apple-touch-icon" href="${BASE}assets/favicon/apple-touch-icon.png">`,
  `<meta name="apple-mobile-web-app-capable" content="yes">`,
  `<meta name="mobile-web-app-capable" content="yes">`,
  `<meta name="apple-mobile-web-app-title" content="Tiger Studio">`,
  `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`,
].map(l => "  " + l).join("\n");

// The Agora SDK (Anycubic cloud camera — desktop-only) is copied from
// node_modules at install time and is not in git, so a clean checkout has no
// file to serve; its <script> would 404. agora-cam.js already copes with a
// missing `window.AgoraRTC`.
const page = fs.readFileSync(path.join(ROOT, "renderer/inventory.html"), "utf8")
  .replace(/^\s*<script src="lib\/agora\/[^"]+"><\/script>\s*\n/m, "");
if (!/<head>/i.test(page)) throw new Error("inventory.html: no <head> to inject <base> into");
fs.writeFileSync(path.join(OUT, "index.html"),
  page.replace(/<head>/i, `<head>\n  <base href="${BASE}renderer/">\n${PWA_HEAD}`));
fs.writeFileSync(path.join(OUT, "version.json"), JSON.stringify({ version: VERSION, webBuild: WEB_BUILD }) + "\n");

console.log(`web build v${VERSION}${WEB_BUILD ? ` · web ${WEB_BUILD}` : ""} (base ${BASE}) → ${path.relative(ROOT, OUT) || OUT}/  (${files} files, ${(bytes / 1048576).toFixed(1)} MB)`);
