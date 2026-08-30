'use strict';
/**
 * Put the ffmpeg binary that matches the packaged architecture into the app.
 *
 * electron-builder copies node_modules verbatim, so both the x64 and the arm64
 * macOS builds received whichever single binary `ffmpeg-static` had downloaded
 * on the build machine. `scripts/prepare-ffmpeg.mjs` stages one binary per
 * architecture in build/ffmpeg/; this hook installs the right one.
 *
 * It runs BEFORE code signing, so the replaced binary is signed with the rest of
 * the bundle — which hardenedRuntime requires.
 */
const fs = require('fs');
const path = require('path');

// electron-builder's Arch enum, by value.
const ARCH_NAME = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' };

const MACHO_MAGIC_64 = 0xfeedfacf;
const CPU_TYPE = { 0x01000007: 'x64', 0x0100000c: 'arm64' };

function machoArch(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(8);
    if (fs.readSync(fd, head, 0, 8, 0) < 8) return null;
    if (head.readUInt32LE(0) !== MACHO_MAGIC_64) return null;
    return CPU_TYPE[head.readUInt32LE(4) >>> 0] || null;
  } catch (_) { return null; } finally { if (fd !== undefined) fs.closeSync(fd); }
}

exports.default = async function afterPack(context) {
  const platform = context.electronPlatformName;          // 'darwin' | 'win32' | 'linux'
  const arch = ARCH_NAME[context.arch] || String(context.arch);
  if (platform !== 'darwin') return;                      // win/linux ship x64 only

  const exe = 'ffmpeg';
  const packed = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    'Contents', 'Resources', 'app.asar.unpacked',
    'node_modules', 'ffmpeg-static', exe,
  );
  if (!fs.existsSync(packed)) {
    console.warn(`[afterPack] no bundled ffmpeg at ${packed} — nothing to align`);
    return;
  }

  const staged = path.join(__dirname, 'ffmpeg', `ffmpeg-${platform}-${arch}`);
  if (!fs.existsSync(staged)) {
    /* Nothing staged. Tolerate it only if what is already packed happens to be
       right — never let a mismatched binary through unnoticed a second time. */
    const have = machoArch(packed);
    if (have === arch) {
      console.log(`[afterPack] ${arch}: bundled ffmpeg already matches`);
      return;
    }
    throw new Error(
      `[afterPack] bundled ffmpeg is ${have || 'unrecognised'} but this build is ${arch}, ` +
      `and build/ffmpeg/ffmpeg-${platform}-${arch} is missing. ` +
      `Run "npm run ffmpeg:prepare" before building.`,
    );
  }

  fs.copyFileSync(staged, packed);
  fs.chmodSync(packed, 0o755);

  const got = machoArch(packed);
  if (got !== arch) throw new Error(`[afterPack] staged ffmpeg is ${got || 'unrecognised'}, expected ${arch}`);
  console.log(`[afterPack] ${arch}: ffmpeg replaced with the ${arch} build`);
};
