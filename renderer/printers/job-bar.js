/**
 * renderer/printers/job-bar.js — the colour and length of a print's progress bar.
 *
 * One rule for the six brands and every place a job bar is drawn (printers
 * table, printer cards, dashboard widget, each brand's side card):
 *
 *   • printing (any running word: printing, paused, heating…) → blue, live %
 *   • finished                                                  → green, 100 %
 *   • error / failed                                            → red, frozen at
 *     the % the bar had when it was still blue
 *   • cancelled                                                 → grey, frozen too
 *
 * Why the freeze: most firmwares zero their progress when a job dies, so a red
 * bar drawn from the live value would always be empty — and "it failed at 76 %"
 * is exactly what the owner needs to read. The last running % is remembered per
 * CONNECTION (a WeakMap on the conn object), so the table and the side card
 * share one memory and it goes away with the connection.
 */

const RUN  = new Set(["printing", "running", "paused", "pausing", "resuming", "heating",
  "preparing", "prepare", "leveling", "checking", "busy", "slicing", "attention"]);
const DONE = new Set(["finished", "finish", "complete", "completed", "success"]);
const FAIL = new Set(["error", "failed", "failure", "fail"]);
const STOP = new Set(["cancelled", "canceled", "cancel", "stopped", "aborted"]);

const _lastRun = new WeakMap();   // conn → last % seen while running

/** "run" · "done" · "fail" · "stop" · "idle" for a brand's state word. */
export function jobTone(state) {
  const s = String(state || "").toLowerCase();
  if (RUN.has(s))  return "run";
  if (DONE.has(s)) return "done";
  if (FAIL.has(s)) return "fail";
  if (STOP.has(s)) return "stop";
  return "idle";
}

/**
 * @param {object} conn    the brand connection object (memory key); may be null
 * @param {string} state   the brand's state word
 * @param {number} rawPct  the firmware's progress, 0–100, NOT masked by state
 * @returns {{ tone: string, pct: number }}
 */
export function jobBar(conn, state, rawPct) {
  const tone = jobTone(state);
  const raw  = Math.max(0, Math.min(100, Math.round(+rawPct || 0)));
  const key  = conn && typeof conn === "object" ? conn : null;
  if (tone === "run") {
    if (key) _lastRun.set(key, raw);
    return { tone, pct: raw };
  }
  if (tone === "done") {
    if (key) _lastRun.delete(key);
    return { tone, pct: 100 };
  }
  if (tone === "fail" || tone === "stop") {
    const last = key ? _lastRun.get(key) : undefined;
    return { tone, pct: Math.max(raw, last ?? 0) };
  }
  if (key) _lastRun.delete(key);
  return { tone, pct: raw };
}

/** The fill span, for any `.xxx-job-bar` track. */
export function jobBarFill(bar) {
  return `<span class="job-fill job-fill--${bar.tone}" style="width:${bar.pct}%"></span>`;
}
