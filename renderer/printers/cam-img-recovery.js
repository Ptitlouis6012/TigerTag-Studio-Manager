/**
 * printers/cam-img-recovery.js — a camera <img> that fails is dimmed, and comes
 * back by itself.
 *
 * The Klipper and OctoPrint camera banners used `onerror="this.style.opacity='.15'"`:
 * one failed picture (a snapshot refused while the streamer was busy, an MJPEG
 * connection reset) dimmed the frame for good, because nothing ever put the
 * opacity back, and an MJPEG <img> is never reloaded by anything else. It read as
 * "the camera showed, then disappeared".
 *
 * Now: a picture that loads clears the dimming; one that fails dims the frame and
 * asks for the same URL again after 3 s, then 6, 12, 24, 30 s while it keeps
 * failing. The URL to ask again is the one the banner was drawn with
 * (`data-cam-src`); the retries stop once the <img> has left the page or lost its src.
 * Listeners sit on the document (load / error do not bubble, hence the capture),
 * so a banner redrawn by innerHTML needs no wiring.
 */
const RETRY_FIRST_MS = 3000;
const RETRY_MAX_MS = 30000;

export function installCamImgRecovery(selector) {
  document.addEventListener('load', e => {
    const img = e.target;
    if (!img?.matches?.(selector)) return;
    img.style.opacity = '';
    img.dataset.camRetry = '0';
  }, true);
  document.addEventListener('error', e => {
    const img = e.target;
    if (!img?.matches?.(selector)) return;
    img.style.opacity = '.15';
    const n = Number(img.dataset.camRetry) || 0;
    img.dataset.camRetry = String(n + 1);
    setTimeout(() => {
      const url = img.dataset.camSrc;
      if (!img.isConnected || !img.getAttribute('src') || !url) return;
      img.src = `${url}${url.includes('?') ? '&' : '?'}_t=${Date.now()}`;
    }, Math.min(RETRY_FIRST_MS * 2 ** n, RETRY_MAX_MS));
  }, true);
}
