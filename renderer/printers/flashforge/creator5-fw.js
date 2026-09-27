/**
 * renderer/printers/flashforge/creator5-fw.js
 *
 * Creator 5 / 5 Pro "Cloud + LAN" firmware — latest-release resolver.
 *
 * FlashForge built, with TigerTag, an official firmware for the Creator 5 and
 * Creator 5 Pro that keeps FlashForge Cloud AND the local network on at the
 * same time (stock firmware makes you pick one). It is distributed from our
 * own public repo, one GitHub Release per version, both models' files on it:
 *
 *   https://github.com/TigerTag-Project/FlashForge-TigerTag-Creator5-Firmware-Lan-and-Cloud
 *   assets: Creator5-<ver>.tgz   Creator5Pro-<ver>.tgz   tag: v<ver>
 *
 * The files are sealed FlashForge packages (openssl-encrypted, despite the
 * .tgz), installed from the root of a FAT32 USB drive — never unpacked, never
 * renamed. Same design as snapmaker/paxx.js: resolved through the public
 * GitHub API, cached 24 h in localStorage (If-None-Match → a free 304), with a
 * build-time fallback so the download always works.
 *
 * The version the printer reports (`/detail` → firmwareVersion) is compared on
 * its "X.Y.Z-A.B.C" pair: stock firmware is an OLDER pair (e.g. 1.9.7-1.2.9),
 * so "older than the latest release" covers both an outdated Cloud + LAN build
 * and a machine still on stock — both are offered the file.
 */

const C5FW_REPO_URL   = 'https://github.com/TigerTag-Project/FlashForge-TigerTag-Creator5-Firmware-Lan-and-Cloud';
const C5FW_LATEST_API =
  'https://api.github.com/repos/TigerTag-Project/FlashForge-TigerTag-Creator5-Firmware-Lan-and-Cloud/releases/latest';
/** The install walkthrough (USB drive) lives in the repo's README. */
export const C5FW_INSTALL_URL = `${C5FW_REPO_URL}#install`;

const C5FW_LS_KEY = 'tigertag.ffgCreator5Fw.latest';
const C5FW_TTL_MS = 24 * 60 * 60 * 1000;

/** Catalogue model ids (data/printers/ffg_printer_models.json) → asset prefix. */
const C5FW_ASSET_PREFIX = { '5': 'Creator5-', '6': 'Creator5Pro-' };

/** True for the two models this firmware exists for. */
export function c5fwIsCreator5(printer) {
  return !!C5FW_ASSET_PREFIX[String(printer?.printerModelId ?? '')];
}

/**
 * Build-time fallback — the release known when this file was written. Used
 * before the first successful API fetch (fresh install, offline, rate-limited).
 */
const C5FW_FALLBACK = {
  tag: 'v2.0.0-1.3.1-20260920',
  assets: [
    { name: 'Creator5-2.0.0-1.3.1-20260920.tgz',
      url: `${C5FW_REPO_URL}/releases/download/v2.0.0-1.3.1-20260920/Creator5-2.0.0-1.3.1-20260920.tgz` },
    { name: 'Creator5Pro-2.0.0-1.3.1-20260920.tgz',
      url: `${C5FW_REPO_URL}/releases/download/v2.0.0-1.3.1-20260920/Creator5Pro-2.0.0-1.3.1-20260920.tgz` },
  ],
  publishedAt: '2026-09-23T19:47:13Z',
  etag: null,
  fetchedAt: 0,
};

let _c5fwInflight = null;

function _c5fwReadCache() {
  try {
    const rec = JSON.parse(localStorage.getItem(C5FW_LS_KEY) || 'null');
    if (rec && rec.tag && Array.isArray(rec.assets) && rec.assets.length) return rec;
  } catch {}
  return null;
}

/** Best known release record (cache or fallback). Synchronous — safe in render code. */
export function c5fwLatest() {
  return _c5fwReadCache() || C5FW_FALLBACK;
}

/** Refresh the cached record when older than 24 h. Never rejects. */
export function c5fwEnsureLatest() {
  const cached = _c5fwReadCache();
  if (cached && Date.now() - (cached.fetchedAt || 0) < C5FW_TTL_MS) return Promise.resolve(cached);
  if (_c5fwInflight) return _c5fwInflight;

  _c5fwInflight = (async () => {
    const prev = cached || C5FW_FALLBACK;
    try {
      const headers = { Accept: 'application/vnd.github+json' };
      if (prev.etag) headers['If-None-Match'] = prev.etag;
      const res = await fetch(C5FW_LATEST_API, { headers });
      if (res.status === 304) {
        const rec = { ...prev, fetchedAt: Date.now() };
        localStorage.setItem(C5FW_LS_KEY, JSON.stringify(rec));
        return rec;
      }
      if (!res.ok) return prev;
      const json = await res.json();
      const assets = (json.assets || [])
        .filter(a => /\.tgz$/i.test(a.name || '') && a.browser_download_url)
        .map(a => ({ name: a.name, url: a.browser_download_url }));
      if (!json.tag_name || !assets.length) return prev;
      const rec = {
        tag: json.tag_name, assets,
        publishedAt: json.published_at || null,
        etag: res.headers.get('etag') || null,
        fetchedAt: Date.now(),
      };
      localStorage.setItem(C5FW_LS_KEY, JSON.stringify(rec));
      return rec;
    } catch {
      return prev;
    } finally {
      _c5fwInflight = null;
    }
  })();
  return _c5fwInflight;
}

/**
 * The file for THIS printer's model — the two are not interchangeable.
 * `Creator5-` is a prefix of neither `Creator5Pro-` nor the reverse, because
 * each prefix ends on its dash.
 * @returns {{name:string, url:string}|null}
 */
export function c5fwAssetFor(rec, printer) {
  const prefix = C5FW_ASSET_PREFIX[String(printer?.printerModelId ?? '')];
  if (!prefix) return null;
  return (rec?.assets || []).find(a => a.name.startsWith(prefix)) || null;
}

/** "v2.0.0-1.3.1-20260920" / "Firmware_2.0.0-1.3.1" → [2,0,0,1,3,1]; null when absent. */
export function c5fwVersionOf(s) {
  const m = /(\d+)\.(\d+)\.(\d+)-(\d+)\.(\d+)\.(\d+)/.exec(String(s || ''));
  return m ? m.slice(1, 7).map(Number) : null;
}

/** Human label for a release tag: "v2.0.0-1.3.1-20260920" → "2.0.0-1.3.1". */
export function c5fwLabel(tag) {
  const v = c5fwVersionOf(tag);
  return v ? `${v.slice(0, 3).join('.')}-${v.slice(3).join('.')}` : String(tag || '').replace(/^v/, '');
}

/**
 * 'current' — the printer runs the latest release (or newer);
 * 'update'  — it runs an older one, stock firmware included;
 * null      — unknown (no reading yet, or a version string we cannot parse).
 */
export function c5fwStatus(installed, latestTag) {
  const a = c5fwVersionOf(installed);
  const b = c5fwVersionOf(latestTag);
  if (!a || !b) return null;
  for (let i = 0; i < 6; i++) {
    if (a[i] < b[i]) return 'update';
    if (a[i] > b[i]) return 'current';
  }
  return 'current';
}
