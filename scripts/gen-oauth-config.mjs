#!/usr/bin/env node
// Generate `oauth-config.json` — the Google Desktop OAuth credentials the
// packaged app reads at RUNTIME.
//
// WHY THIS EXISTS. `main.js` used to read `process.env.TIGERTAG_GOOGLE_DESKTOP_*`
// directly. That silently broke every shipped build: CI sets those variables at
// BUILD time, but the app reads them at RUNTIME on the user's machine, where
// they do not exist. There is no bundler here, so nothing ever inlined them —
// the loopback OAuth flow reported "not configured" and the renderer fell back
// to signInWithPopup, which Google refuses from an embedded webview.
//
// This script closes that gap: it writes the values into a JSON file that
// electron-builder packs into the app. The file is gitignored, so the client
// secret never lands in the public repository — while still shipping inside the
// binary, which is unavoidable (RFC 8252 §8.5: an installed app cannot keep a
// secret; PKCE is what actually protects the exchange).
//
// Sources, in order: the environment (CI secrets / a local export), then an
// existing file (so a developer who wrote it once keeps working offline).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out  = path.join(root, 'oauth-config.json');

const fromEnv = {
  googleDesktopClientId:     process.env.TIGERTAG_GOOGLE_DESKTOP_CLIENT_ID     || '',
  googleDesktopClientSecret: process.env.TIGERTAG_GOOGLE_DESKTOP_CLIENT_SECRET || '',
};

let existing = {};
try { existing = JSON.parse(fs.readFileSync(out, 'utf8')); } catch { /* first run */ }

const merged = {
  googleDesktopClientId:     fromEnv.googleDesktopClientId     || existing.googleDesktopClientId     || '',
  googleDesktopClientSecret: fromEnv.googleDesktopClientSecret || existing.googleDesktopClientSecret || '',
};

if (!merged.googleDesktopClientId || !merged.googleDesktopClientSecret) {
  // Warn loudly but do NOT fail the build: an unsigned-in app is still usable,
  // and failing here would block a release for a non-blocking feature.
  console.warn(
    '[oauth-config] WARNING — Google Desktop OAuth credentials are missing.\n' +
    '                Sign-in with Google will not work in this build.\n' +
    '                Set TIGERTAG_GOOGLE_DESKTOP_CLIENT_ID and\n' +
    '                TIGERTAG_GOOGLE_DESKTOP_CLIENT_SECRET, or write them into\n' +
    '                oauth-config.json (gitignored) at the repo root.'
  );
}

fs.writeFileSync(out, JSON.stringify(merged, null, 2) + '\n');
const mask = (s) => (s ? `set (${s.length} chars)` : 'MISSING');
console.log(`[oauth-config] wrote ${path.relative(root, out)} — id: ${mask(merged.googleDesktopClientId)}, secret: ${mask(merged.googleDesktopClientSecret)}`);
