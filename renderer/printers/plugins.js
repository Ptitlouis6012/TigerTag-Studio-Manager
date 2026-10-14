/**
 * printers/plugins.js — the printer-plugin host (renderer side).
 *
 * A printer integration is a SELF-CONTAINED folder, renderer/printers/<id>/,
 * like a Home Assistant integration: its own connection core, cards, camera,
 * add flow, discovery, styles, strings and (optionally) main-process side
 * (`main.cjs`, loaded by main.js). A plugin imports only the host services —
 * this file, registry.js, context.js and the shared helpers (scan-pick,
 * extra-subnets, job-bar, modal-helpers, identity, refind) — NEVER another
 * plugin's files. Contract and how to add one: docs/PRINTER-PLUGINS.md.
 *
 * To add a plugin: drop its folder in renderer/printers/ and add ONE import
 * line below. Static imports keep registration synchronous: every plugin is in
 * the registry before inventory.js reads it (brand list, picker, Firestore
 * subscriptions).
 *
 * The seven historical brands (bambulab, creality, elegoo, flashforge,
 * snapmaker, anycubic, prusa) predate this contract and are still wired by
 * hand in inventory.js; they move to it one at a time.
 */
import { brands, registerBrand } from './registry.js';
import { registerPrinterIdentity } from './identity.js';

/* No module state here on purpose: the plugins imported at the bottom import
   THIS file back, so they run before its body does. Everything is kept in the
   brand registry (registry.js, evaluated first), flagged `plugin: true`. */

/**
 * Called by a plugin's entry file. `def` carries the manifest and the
 * lifecycle hooks (see docs/PRINTER-PLUGINS.md); it also lands in the brand
 * registry, so the generic code paths (picker, settings form, slots, temps,
 * job control) work for it unchanged.
 */
export function registerPrinterPlugin(def) {
  if (!def?.id || !/^[a-z0-9-]+$/.test(def.id)) throw new Error("printer plugin: invalid id");
  registerBrand(def.id, { ...def, plugin: true });
  if (def.identity) registerPrinterIdentity(def.id, def.identity);
  if (def.css) injectCss(def.id, def.css);
}

function injectCss(id, href) {
  if (typeof document === "undefined") return;
  if (document.querySelector(`link[data-printer-plugin="${id}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.dataset.printerPlugin = id;
  document.head.appendChild(link);
}

/** The plugin behind a brand id or a printer, or null for a hand-wired brand. */
export function printerPlugin(brandOrPrinter) {
  const id = typeof brandOrPrinter === "string" ? brandOrPrinter : brandOrPrinter?.brand;
  const b = brands.get(id);
  return b?.plugin ? b : null;
}

export function printerPlugins() { return [...brands.values()].filter(b => b.plugin); }
export function printerPluginIds() { return printerPlugins().map(p => p.id); }

/**
 * Merge every plugin's own strings into the loaded locales. A plugin ships its
 * strings as `i18n: { key: { en, fr, … } }`; English is the fallback for a
 * missing language, like the app's own t().
 */
export function mergePluginStrings(i18n) {
  if (!i18n) return;
  for (const p of printerPlugins()) {
    for (const [key, byLang] of Object.entries(p.i18n || {})) {
      for (const lang of Object.keys(i18n)) {
        const v = byLang[lang] ?? byLang.en;
        if (v != null && i18n[lang][key] == null) i18n[lang][key] = v;
      }
    }
  }
}

/* ── The plugins ─────────────────────────────────────────────────────────── */
import './klipper/plugin.js';
import './octoprint/plugin.js';
