// TigerCoins pull sounds — synthesised with the Web Audio API (no audio file):
// hold beeps (faster and higher, with an echo), seal crack, flap, card reveal, one jingle per rarity, coin ticks.
// One AudioContext, created on the first sound (a user gesture has happened by
// then), a master gain at a modest level behind a compressor. Muted state in
// localStorage `tigertag.coinsSound` ("off" = muted), toggled from the stage.

const KEY = "tigertag.coinsSound";
let ac = null, master = null;

export function soundOn() {
  try { return localStorage.getItem(KEY) !== "off"; } catch (_) { return true; }
}
export function setSound(on) {
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch (_) { /* private window */ }
  if (!on && master) master.gain.setTargetAtTime(0, ac.currentTime, 0.01);
  if (on && master) master.gain.setTargetAtTime(0.25, ac.currentTime, 0.01);
}

function ctx() {
  if (!soundOn()) return null;
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
    const comp = ac.createDynamicsCompressor();
    master = ac.createGain();
    master.gain.value = 0.25;
    master.connect(comp).connect(ac.destination);
  }
  if (ac.state === "suspended") ac.resume();
  return ac;
}

// One note: oscillator `type` from f0 to f1 (Hz) over `dur` s, attack/decay envelope.
function tone(type, f0, f1, dur, { at = 0, vol = 0.5, attack = 0.005 } = {}) {
  const a = ctx(); if (!a) return;
  const t = a.currentTime + at;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

// Filtered noise: a crack, a flap, a cymbal-like shimmer.
function noise(dur, { at = 0, vol = 0.4, from = 1800, to = 400, type = "bandpass" } = {}) {
  const a = ctx(); if (!a) return;
  const t = a.currentTime + at;
  const buf = a.createBuffer(1, Math.max(1, Math.floor(a.sampleRate * dur)), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  src.buffer = buf;
  f.type = type;
  f.frequency.setValueAtTime(from, t);
  f.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t); src.stop(t + dur);
}

/** Wakes the audio engine up ahead of time (the stage opening is a user
 *  gesture), so the first sound of a hold starts on the press, not late. */
export function warmSound() { ctx(); }

// The hold: beeps from the very first instant, faster, higher and louder as
// the hold goes on (a countdown to the opening), each one with a soft echo for
// a little mystery — no drone underneath. Returns a stop function (released
// early → the beeps still to come are cancelled and the echo fades).
export function holdRise(ms) {
  const a = ctx(); if (!a) return () => {};
  const t = a.currentTime + 0.005, d = ms / 1000;
  const out = a.createGain(), echo = a.createDelay(0.5), fb = a.createGain(), wet = a.createGain();
  out.gain.value = 1;
  echo.delayTime.value = 0.11; fb.gain.value = 0.35; wet.gain.value = 0.45;
  out.connect(master);
  out.connect(echo); echo.connect(fb).connect(echo); echo.connect(wet).connect(master);
  const beeps = [];
  // The gap shrinks from 170 ms to 45 ms; the pitch climbs an octave.
  for (let x = 0; x < d; ) {
    const k = x / d, at = t + x;
    const o = a.createOscillator(), g = a.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(660 * Math.pow(2, k), at);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.16 + k * 0.22, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.07);
    o.connect(g).connect(out); o.start(at); o.stop(at + 0.08);
    beeps.push(o);
    x += 0.17 - k * 0.125;
  }
  return () => {
    const now = a.currentTime;
    beeps.forEach(o => { try { o.stop(now); } catch (_) { /* already played */ } });
    fb.gain.setTargetAtTime(0, now, 0.05);
  };
}

export const sfx = {
  tick() { tone("sine", 520, 520, 0.04, { vol: 0.15 }); },
  ready() { tone("triangle", 620, 620, 0.09, { vol: 0.3 }); tone("triangle", 930, 930, 0.09, { vol: 0.2 }); },
  crack() { noise(0.11, { vol: 0.5, from: 2400, to: 600, type: "lowpass" }); tone("sine", 110, 70, 0.11, { vol: 0.5 }); },
  flap() { noise(0.18, { vol: 0.25, from: 900, to: 300 }); },
  // One step of the rarity climb, higher each step.
  step(k) { tone("triangle", [330, 392, 494, 587, 698][k] || 698, [330, 392, 494, 587, 698][k] || 698, 0.12, { vol: 0.28 }); },
  reveal() { tone("sine", 440, 660, 0.16, { vol: 0.35 }); },
  // The impact of a rare-or-better reveal, harder with the rarity (r 2 → 4):
  // a rushing riser, then a boom (deeper and longer), a shimmer tail.
  impact(r) {
    const k = r - 2;                                  // 0 rare · 1 epic · 2 legendary
    noise(0.35 + k * 0.08, { vol: 0.2 + k * 0.12, from: 500, to: 4000 + k * 1500, type: "bandpass" });
    const at = 0.35 + k * 0.08;
    tone("sine", 110 - k * 25, 45 - k * 7, 0.45 + k * 0.25, { at, vol: 0.45 + k * 0.2, attack: 0.008 });
    noise(0.3 + k * 0.2, { at, vol: 0.25 + k * 0.15, from: 2500, to: 200, type: "lowpass" });
    noise(0.7 + k * 0.5, { at: at + 0.05, vol: 0.06 + k * 0.05, from: 7000, to: 10000, type: "highpass" });
  },
  coin(i = 0) { tone("sine", 880, 1320, 0.075, { at: i * 0.045, vol: 0.18 }); },
  rarity(r) {
    const notes = (fs, step, type = "triangle", vol = 0.35, len = 0.18, at = 0) => fs.forEach((f, i) => tone(type, f, f, len, { at: at + i * step, vol }));
    const chord = (fs, at, len, vol, type = "triangle") => fs.forEach(f => { tone(type, f, f, len, { at, vol, attack: 0.02 }); tone("sine", f * 2.003, f * 2.003, len * 0.8, { at, vol: vol * 0.35, attack: 0.02 }); });
    if (r === 0) { tone("sine", 392, 392, 0.12, { vol: 0.3 }); tone("sine", 784, 784, 0.08, { at: 0.03, vol: 0.08 }); }
    else if (r === 1) { notes([523, 659], 0.08, "triangle", 0.32); tone("sine", 1319, 1319, 0.2, { at: 0.16, vol: 0.1 }); }
    else if (r === 2) {
      notes([523, 659, 784, 1047], 0.06, "sine", 0.34, 0.22);
      chord([523, 784], 0.28, 0.6, 0.12);
      noise(0.5, { at: 0.2, vol: 0.05, from: 6000, to: 9000, type: "highpass" });
    } else if (r === 3) {
      // Epic: a dark minor turn resolving bright, over a low pulse.
      notes([440, 523, 659], 0.07, "sawtooth", 0.14, 0.14);
      notes([587, 740, 880, 1175], 0.08, "triangle", 0.34, 0.24, 0.24);
      chord([587, 740, 880], 0.58, 1.1, 0.13);
      tone("sine", 73, 73, 0.9, { at: 0.2, vol: 0.32, attack: 0.03 });
    } else {
      // Legendary: the fanfare, then a long golden chord and a shimmer.
      notes([523, 659, 784, 1047], 0.11, "triangle", 0.4, 0.28);
      notes([784, 1047, 1319, 1568], 0.09, "sine", 0.16, 0.22, 0.42);
      chord([523, 659, 784, 1047], 0.62, 1.8, 0.14);
      noise(1.6, { at: 0.6, vol: 0.1, from: 6000, to: 9000, type: "highpass" });
    }
  },
};
