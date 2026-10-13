// Tiger Studio Web — browser stand-in for the Electron preload bridge.
//
// The renderer talks to the native side only through `window.electronAPI`
// (and the per-brand bridges: bambulab, elegoo, anycubic, td1s, mcpBridge,
// studio), all injected by preload.js. In Electron that object already exists
// when this script runs, so it does nothing. In a plain browser it defines a
// web `electronAPI` that implements the methods a browser CAN honour, with
// the same names and the same return shapes as the IPC handlers in main.js.
//
// Everything native (RFID readers, USB scales, LAN printers, updater, MCP,
// file dialogs) is deliberately ABSENT: the renderer already feature-detects
// each method with `?.`, and the few "is this the desktop app" checks use
// `HAS_NATIVE` (inventory.js), which is false here because of `isWeb`.
// A later transport (brand cloud APIs, a relay) can add methods here without
// touching the call sites.
//
// Loaded as a classic script BEFORE inventory.js (see inventory.html).
(function () {
  if (window.electronAPI) return;            // desktop: preload already did it

  // Hides every `[data-desktop-only]` element (rule in css/00-base.css).
  document.documentElement.classList.add("is-web");

  // NO LAN FROM THE WEB. Some printer modules talk to the machines straight from
  // the page (Creality ws://<ip>:9999, Snapmaker http://<ip>:7125 — the other
  // brands go through the desktop's main process, absent here), and their
  // background pings start as soon as the printer list loads. From an https page
  // that is mixed content: Chrome flags the whole site "Not secure" and asks for
  // local-network access, for something that can't work anyway. So an insecure
  // WebSocket or fetch is refused right here — the callers already treat a
  // failure as "printer unreachable". (Printers on the web will come through a
  // secure relay, never the LAN — docs/STUDIO-WEB-PLAN.md.)
  if (location.protocol === "https:") {
    const insecure = (u) => {
      try { return /^(ws|http):$/.test(new URL(String(u), location.href).protocol); } catch { return false; }
    };
    const NativeWS = window.WebSocket;
    window.WebSocket = function (url, protocols) {
      if (insecure(url)) throw new DOMException("LAN connections are desktop-only", "SecurityError");
      return protocols === undefined ? new NativeWS(url) : new NativeWS(url, protocols);
    };
    window.WebSocket.prototype = NativeWS.prototype;
    Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : input;
      if (insecure(url)) return Promise.reject(new TypeError("LAN connections are desktop-only"));
      return nativeFetch(input, init);
    };
  }

  // Install as an app (PWA): Chrome / Edge / Android announce it once, possibly
  // before the renderer module has loaded — keep the event for the sidebar's
  // "Install the app" button (inventory.js) and tell it the moment it lands.
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    window.__studioInstallPrompt = e;
    document.dispatchEvent(new Event("studio:installable"));
  });

  // Replaced by scripts/build-web.mjs with package.json's version.
  const APP_VERSION = "__STUDIO_WEB_VERSION__";
  // Web hotfix number on top of that release (0 = the release itself).
  const WEB_BUILD = Number("__STUDIO_WEB_BUILD__") || 0;

  // No version drift with the desktop app: a tab (or the installed app) left
  // open across a release must not keep running the old code. When the page
  // comes back into view — at most every 10 min — compare the deployed
  // version.json (written by scripts/build-web.mjs, next to index.html) with
  // the version this page was built as, and reload onto the new one. Never in
  // the middle of something: an open window or a field being typed in defers
  // it to the next time the page comes back.
  if (!APP_VERSION.startsWith("__")) {
    let lastCheck = 0;
    const busy = () => document.querySelector(".modal-overlay.open")
      || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
    const check = async () => {
      if (document.visibilityState !== "visible" || Date.now() - lastCheck < 10 * 60 * 1000) return;
      lastCheck = Date.now();
      try {
        const r = await fetch(new URL("../version.json", document.baseURI), { cache: "no-store" });
        const v = r.ok ? await r.json() : null;
        const changed = v && (v.version !== APP_VERSION || (v.webBuild || 0) !== WEB_BUILD);
        if (changed && !busy()) location.reload();
        else if (changed) lastCheck = 0;   // retry next time
      } catch { /* offline: try again later */ }
    };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
  }

  const XANO = "https://api.tigertag.io/api:tigertag";

  async function getJson(url, opts = {}, timeoutMs = 7000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { ...opts, signal: controller.signal });
      if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
      return { ok: true, json: await resp.json() };
    } catch (e) {
      return { ok: false, error: e?.message || "network_error" };
    } finally {
      clearTimeout(timer);
    }
  }

  window.electronAPI = {
    isWeb: true,

    openExternal(url) {
      if (!url) return;
      window.open(String(url), "_blank", "noopener,noreferrer");
    },

    async getAppInfo() {
      return {
        appVersion: APP_VERSION.startsWith("__") ? "dev"
                  : WEB_BUILD ? `${APP_VERSION} · web ${WEB_BUILD}` : APP_VERSION,
        platform:   "web",
        electron:   "n/a",
        chrome:     navigator.userAgent,
      };
    },

    // Same contract as main.js `rfid:lookup-product` (fake uid, no chip needed).
    async lookupProduct(productId) {
      if (!productId || productId === 0xFFFFFFFF) return { ok: false, error: "invalid_id" };
      const r = await getJson(`${XANO}/product/get?uid=123456789&product_id=${productId}`);
      return r.ok ? { ok: true, api: r.json } : r;
    },

    // Same contract as main.js `rfid:refresh-api` (uid sent in decimal).
    async refreshApiData(rawDoc) {
      if (!rawDoc?.id_product || !rawDoc?.uid) return { ok: false, error: "missing_fields" };
      let uidDecimal;
      try { uidDecimal = BigInt("0x" + rawDoc.uid).toString(); }
      catch { return { ok: false, error: "bad_uid" }; }
      const r = await getJson(`${XANO}/product/get?uid=${uidDecimal}&product_id=${rawDoc.id_product}`);
      return r.ok ? { ok: true, api: r.json } : r;
    },

    // Same contract as main.js `catalog:fetch-all` (paged until nextPage is null).
    async fetchCatalogAll() {
      const PAGE_CAP = 100, PER_PAGE = 1000;
      const items = [];
      let page = 1, itemsTotal = 0;
      for (let guard = 0; guard < PAGE_CAP; guard++) {
        const req = () => getJson(`${XANO}/product/get/all`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ per_page: PER_PAGE, page }),
        }, 30000);
        // One retry: an upstream hiccup comes back WITHOUT CORS headers, which
        // the browser reports as an opaque "Failed to fetch" (seen in testing).
        let r = await req();
        if (!r.ok) r = await req();
        if (!r.ok) return r;
        const env = r.json;
        if (!env || !Array.isArray(env.items)) return { ok: false, error: "bad_envelope" };
        items.push(...env.items);
        if (Number.isFinite(env.itemsTotal)) itemsTotal = env.itemsTotal;
        if (env.nextPage == null) break;
        page = env.nextPage;
      }
      return { ok: true, items, itemsTotal: itemsTotal || items.length };
    },

    // Browser download instead of the native Save dialog.
    async downloadImage(url, filename) {
      try {
        let href = String(url), revoke = null;
        if (!href.startsWith("data:")) {
          const resp = await fetch(href);
          if (!resp.ok) return { ok: false, reason: `HTTP ${resp.status}` };
          href = URL.createObjectURL(await resp.blob());
          revoke = href;
        }
        const a = document.createElement("a");
        a.href = href;
        a.download = filename || "qr-code.png";
        document.body.appendChild(a);
        a.click();
        a.remove();
        if (revoke) setTimeout(() => URL.revokeObjectURL(revoke), 10000);
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: e?.message || "error" };
      }
    },
  };
})();
