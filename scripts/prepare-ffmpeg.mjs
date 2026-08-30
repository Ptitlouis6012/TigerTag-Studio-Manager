#!/usr/bin/env node
/**
 * Stage one ffmpeg binary PER TARGET ARCHITECTURE, before electron-builder runs.
 *
 * Why this exists
 * ---------------
 * `ffmpeg-static` downloads a single binary at `npm ci` time, for the machine
 * doing the install. GitHub's `macos-latest` runners are Apple Silicon, so that
 * binary is arm64 — and the SAME arm64 binary was copied into both the arm64 and
 * the x64 DMG. On an Intel Mac the app therefore shipped a binary its CPU cannot
 * execute: spawn failed with EBADARCH (errno -86, "bad CPU type in executable")
 * and the main process died with a crash dialog, for a camera.
 *
 * What it does
 * ------------
 * Re-runs ffmpeg-static's own installer once per architecture (it honours
 * `npm_config_platform` / `npm_config_arch`), copying each result into
 * `build/ffmpeg/`. `build/afterPack.js` then puts the right one into each
 * packaged app. The installer is reused rather than reimplemented so the gzip
 * handling, the release pinning, the redirects and the proxy support stay theirs.
 *
 * node_modules is left holding the HOST binary, so `npm start` keeps working.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'node_modules', 'ffmpeg-static');
const OUT = path.join(ROOT, 'build', 'ffmpeg');

/* Mach-O CPU types, read from the header rather than shelled out to `file(1)`,
   which does not exist on every build machine. */
const MACHO_MAGIC_64 = 0xfeedfacf;
const CPU_TYPE = { 0x01000007: 'x64', 0x0100000c: 'arm64' };

function machoArch(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(8);
    if (fs.readSync(fd, head, 0, 8, 0) < 8) return null;
    if (head.readUInt32LE(0) !== MACHO_MAGIC_64) return null;   // fat or not Mach-O
    return CPU_TYPE[head.readUInt32LE(4) >>> 0] || null;
  } catch { return null; } finally { if (fd !== undefined) fs.closeSync(fd); }
}

function install(platform, arch) {
  /* The installer skips the download when a binary is already there — WITHOUT
     looking at its architecture ("ffmpeg is installed already"). That is the
     same blindness that shipped an arm64 binary in the Intel build, so the file
     is cleared first to force a real fetch for this architecture. */
  fs.rmSync(path.join(SRC, platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'), { force: true });
  execFileSync(process.execPath, [path.join(SRC, 'install.js')], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, npm_config_platform: platform, npm_config_arch: arch },
  });
}

const platform = process.argv[2] || 'darwin';
const arches = platform === 'darwin' ? ['x64', 'arm64'] : ['x64'];
const exe = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

fs.mkdirSync(OUT, { recursive: true });

for (const arch of arches) {
  console.log(`[prepare-ffmpeg] fetching ${platform}-${arch}`);
  install(platform, arch);
  const staged = path.join(OUT, `ffmpeg-${platform}-${arch}`);
  fs.copyFileSync(path.join(SRC, exe), staged);
  fs.chmodSync(staged, 0o755);

  /* Fail here rather than ship a binary that cannot run. A silently wrong
     download is exactly the failure this script exists to prevent. */
  if (platform === 'darwin') {
    const got = machoArch(staged);
    if (got !== arch) {
      throw new Error(`[prepare-ffmpeg] ${staged} is ${got || 'unrecognised'}, expected ${arch}`);
    }
  }
  console.log(`[prepare-ffmpeg] staged ${staged}`);
}

// Leave node_modules matching this machine so `npm start` still has a usable binary.
if (arches.includes(os.arch()) && platform === os.platform()) {
  install(os.platform(), os.arch());
}
