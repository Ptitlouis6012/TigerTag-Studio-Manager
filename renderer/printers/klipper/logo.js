import { ctx } from '../context.js';

export function themeLogoUrl(printer) {
  const raw = String(printer?.ip || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!/^[\w.-]+(:\d{1,5})?$/.test(raw)) return null;
  const host = /:\d+$/.test(raw) ? raw : `${raw}:${Number(printer.port) || 7125}`;
  try { return new URL(`http://${host}/server/files/config/.theme/sidebar-logo.png`).href; }
  catch { return null; }
}

/** A printer-owned theme image, with the bundled Klipper logo as fallback. */
export function renderKlipperLogo(printer) {
  const fallback = '<span class="pt-thumb-logo" data-brand="klipper" role="img" aria-label="Klipper"></span>';
  // The printer serves it over http://: in the HTTPS web version that image
  // would be mixed content and mark the whole page "Not secure" — keep the
  // bundled logo there.
  const url = typeof location !== 'undefined' && location.protocol === 'https:' ? null : themeLogoUrl(printer);
  if (!url) return fallback;
  return `<span class="klipper-theme-logo">
    <img src="${ctx.esc(url)}" alt="Klipper" loading="lazy" referrerpolicy="no-referrer"
      onerror="this.hidden=true;this.nextElementSibling.hidden=false" />
    <span hidden class="pt-thumb-logo" data-brand="klipper" role="img" aria-label="Klipper"></span>
  </span>`;
}
