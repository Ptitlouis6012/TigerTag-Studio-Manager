#!/usr/bin/env node
/**
 * Regenerate every icon the project ships from the ONE vector master.
 *
 *   node scripts/make-icons.mjs
 *
 * Master: `assets-src/svg/tigersystem_icon.svg` — a full-bleed square (dark plate
 * + white tiger). It is NEVER modified, redrawn or rescaled here: the artwork
 * always fills the whole canvas, edge to edge, exactly as designed.
 *
 * Two outputs, identical artwork, one difference:
 *
 *   • SQUARE (Windows .ico, favicons, in-app SVG) — the master as is.
 *   • ROUNDED (macOS .icns, Linux .png) — the same full-size artwork with its
 *     four corners clipped to a radius. macOS applies no mask of its own, so a
 *     raw square sits in the Dock with hard corners next to every rounded
 *     sibling. Nothing is scaled down and no margin is added — only the corners
 *     change.
 *
 * Rasterising needs a renderer that preserves alpha (the clipped corners are
 * transparent). macOS `qlmanage` flattens onto white and there is no
 * ImageMagick/librsvg here, so we drive headless Chrome with
 * `--default-background-color=00000000`. `app-builder` (shipped with
 * electron-builder) then packs the PNGs into .icns; the .ico is packed here.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT   = path.resolve(import.meta.dirname, "..");
const MASTER = path.join(ROOT, "assets-src/svg/tigersystem_icon.svg");
const OUT_IMG = path.join(ROOT, "assets/img");
const OUT_FAV = path.join(ROOT, "assets/favicon");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ttag-icons-"));

// Corner radius as a share of the icon's side — the proportion Apple's own grid
// uses (185.4 / 824). Applied to the master's full canvas, so the artwork keeps
// its size and only the corners are cut.
const RADIUS_RATIO = 185.4 / 824;
const FAVICONS = { "favicon-16.png": 16, "favicon-32.png": 32, "apple-touch-icon.png": 180,
                   "icon-192.png": 192, "icon-512.png": 512 };
// Every size Windows actually asks for, smallest first — each rendered from the
// vector rather than downscaled, so 16 px stays legible instead of turning to mush.
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

const CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
].find(p => fs.existsSync(p));

const APP_BUILDER = ["arm64", "amd64"]
  .map(a => path.join(ROOT, `node_modules/app-builder-bin/mac/app-builder_${a}`))
  .find(p => fs.existsSync(p));

function die(msg) { console.error(`[make-icons] ${msg}`); process.exit(1); }
if (!fs.existsSync(MASTER)) die(`master not found: ${MASTER}`);
if (!CHROME) die("no Chrome/Chromium/Edge found — needed to rasterise the SVG with alpha.");
if (!APP_BUILDER) die("app-builder-bin not found — run `npm install` first.");

/**
 * The render input: an HTML page showing the master through an `<img>` sized to
 * the viewport.
 *
 * Why an HTML wrapper rather than pointing Chrome at the .svg, or embedding it in
 * another SVG: the master declares only a viewBox and no width/height, and an SVG
 * with no intrinsic size is NOT scaled to fit — screenshotting it at 16 px cropped
 * the top-left corner instead of shrinking the tiger, and an `<image href=…>`
 * inside a sized SVG behaves the same way. An `<img>` given a CSS width/height
 * always scales its source. The master file itself is never touched or rewritten.
 *
 * `rounded` clips the four corners via `border-radius` (macOS/Linux). The artwork
 * keeps its full size either way — nothing is inset or scaled down.
 */
function canvasHTML(rounded) {
  const radius = rounded ? `${(RADIUS_RATIO * 100).toFixed(2)}%` : "0";
  return `<!doctype html><meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  img { display: block; width: 100vw; height: 100vh; border-radius: ${radius}; }
</style>
<img src="file://${MASTER}" alt="">`;
}

/**
 * Screenshot an HTML page at `size`. ONLY ever called at 1024: headless Chrome
 * clamps the window below a platform minimum, so asking for 16 px yields a much
 * larger viewport and the capture comes back cropped, not scaled — which is
 * exactly how the .ico ended up holding seven crops of the tiger's cheek.
 * Everything smaller is downscaled from the 1024 by `resize` instead.
 */
function render(htmlPath, pngPath, size) {
  execFileSync(CHROME, ["--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
    "--default-background-color=00000000", "--force-device-scale-factor=1",
    `--window-size=${size},${size}`, `--screenshot=${pngPath}`, `file://${htmlPath}`],
    { stdio: "ignore" });
  if (!fs.existsSync(pngPath)) die(`Chrome produced no PNG for ${path.basename(htmlPath)}`);
  const png = fs.readFileSync(pngPath);
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
  if (w !== size || h !== size) die(`Chrome returned ${w}x${h} for a ${size}px render`);
}

/** Downscale a PNG, keeping its alpha. */
function resize(srcPng, destPng, size) {
  fs.copyFileSync(srcPng, destPng);
  execFileSync("sips", ["-z", String(size), String(size), destPng], { stdio: "ignore" });
  const png = fs.readFileSync(destPng);
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
  if (w !== size || h !== size) die(`sips returned ${w}x${h} for a ${size}px resize`);
}

/** app-builder writes into a directory; lift the single file out of it. */
function pack(pngPath, format, dest) {
  const dir = fs.mkdtempSync(path.join(TMP, `${format}-`));
  execFileSync(APP_BUILDER, ["icon", `--input=${pngPath}`, `--format=${format}`, `--out=${dir}`],
    { stdio: "ignore" });
  const made = fs.readdirSync(dir).find(f => f.endsWith(`.${format}`));
  if (!made) die(`app-builder produced no .${format}`);
  fs.copyFileSync(path.join(dir, made), dest);
}

/**
 * Windows .ico, written here rather than by app-builder: fed one PNG it emits a
 * single 256 px entry and lets Windows downscale, which smears the artwork in the
 * taskbar and in Explorer's small views — the icon it replaced carried all seven
 * sizes. Fed a DIRECTORY of PNGs app-builder panics outright. So we pack the
 * container ourselves; it is a trivial format, and Vista+ reads PNG-compressed
 * entries directly, so each size goes in as the PNG we already rendered at it.
 *   ICONDIR    6 bytes  — reserved, type (1 = icon), image count
 *   ICONDIRENTRY 16 ea. — w, h (0 means 256), palette, reserved, planes,
 *                         bit depth, byte length, offset
 */
function writeIco(pngPaths, dest) {
  const blobs = pngPaths.map(p => fs.readFileSync(p));
  const dir = Buffer.alloc(6 + 16 * blobs.length);
  dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(blobs.length, 4);
  let offset = dir.length;
  blobs.forEach((blob, i) => {
    // Read the size back off the PNG's IHDR rather than trusting the filename.
    const w = blob.readUInt32BE(16), h = blob.readUInt32BE(20);
    if (w > 256 || h > 256) die(`.ico entries cap at 256 px, got ${w}x${h}`);
    const e = 6 + i * 16;
    dir.writeUInt8(w === 256 ? 0 : w, e);
    dir.writeUInt8(h === 256 ? 0 : h, e + 1);
    dir.writeUInt8(0, e + 2); dir.writeUInt8(0, e + 3);
    dir.writeUInt16LE(1, e + 4); dir.writeUInt16LE(32, e + 6);
    dir.writeUInt32LE(blob.length, e + 8);
    dir.writeUInt32LE(offset, e + 12);
    offset += blob.length;
  });
  fs.writeFileSync(dest, Buffer.concat([dir, ...blobs]));
}

fs.mkdirSync(OUT_FAV, { recursive: true });

// 1. The shipped SVG — byte-identical to the master; the app and the websites use it directly.
fs.mkdirSync(path.join(ROOT, "assets/svg"), { recursive: true });
fs.copyFileSync(MASTER, path.join(ROOT, "assets/svg/tigersystem_icon.svg"));
fs.copyFileSync(MASTER, path.join(OUT_FAV, "favicon.svg"));

// 2. Rasterise both treatments at 1024.
const squarePath = path.join(TMP, "square.html");
const roundedPath = path.join(TMP, "rounded.html");
fs.writeFileSync(squarePath, canvasHTML(false));
fs.writeFileSync(roundedPath, canvasHTML(true));

const square1024 = path.join(TMP, "square-1024.png");
const rounded1024 = path.join(TMP, "rounded-1024.png");
render(squarePath, square1024, 1024);
render(roundedPath, rounded1024, 1024);

// 3. App icons. macOS + Linux take the rounded-corner variant, Windows the square.
pack(rounded1024, "icns", path.join(OUT_IMG, "icon.icns"));
writeIco(ICO_SIZES.map(size => {
  const p = path.join(TMP, `ico-${size}.png`);
  resize(square1024, p, size);
  return p;
}), path.join(OUT_IMG, "icon.ico"));
fs.copyFileSync(rounded1024, path.join(OUT_IMG, "icon.png"));

// 4. Favicons — square, downscaled from the 1024 render (sips keeps the alpha).
for (const [name, size] of Object.entries(FAVICONS))
  resize(square1024, path.join(OUT_FAV, name), size);

fs.rmSync(TMP, { recursive: true, force: true });
const kb = p => `${(fs.statSync(p).size / 1024).toFixed(0)} kB`;
console.log(`[make-icons] from ${path.relative(ROOT, MASTER)}
  assets/img/icon.icns          ${kb(path.join(OUT_IMG, "icon.icns"))}  macOS   (full size, rounded corners)
  assets/img/icon.ico           ${kb(path.join(OUT_IMG, "icon.ico"))}  Windows (square, ${ICO_SIZES.length} sizes)
  assets/img/icon.png           ${kb(path.join(OUT_IMG, "icon.png"))}  Linux   (full size, rounded corners)
  assets/svg/tigersystem_icon.svg              in-app / web vector
  assets/favicon/               favicon.svg + ${Object.keys(FAVICONS).join(", ")}`);
