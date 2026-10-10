/**
 * report/annotator.js — full-screen screenshot editor for the in-app report.
 *
 * Everything is an OBJECT, not paint: each arrow, box, circle, text… stays
 * selectable, movable, resizable, recolourable and deletable until "Done", and
 * the picture is only flattened at export. Coordinates are in IMAGE pixels, so
 * the result is at the screenshot's own size whatever the window size.
 *
 * Tools (shortcut):
 *   V select/move · P pen · E eraser (cuts pen strokes, deletes other objects)
 *   A arrow · L line · R box · O circle · H highlighter (area, multiply)
 *   T text · N numbered step (1, 2, 3… auto) · B blur (pixelates the area —
 *   for anything private, the report is public)
 * Colours 1-7 · sizes S/M/L/XL · ⌘Z undo · ⇧⌘Z / ⌘Y redo · ⌫ delete ·
 * ⌘D duplicate · arrow keys nudge (⇧ = ×10) · Esc deselect.
 * A drawing tool pressed ON an existing object grabs it instead (move), so a
 * stray click never draws a dot over an arrow; boxes/circles are grabbed by
 * their edge only, so you can still draw inside them.
 *
 * API: openAnnotator({ src, t, esc }) → Promise<dataURL | null>  (null = cancelled)
 */

const COLORS = ["#e5322d", "#f08c00", "#ffd400", "#2f9e44", "#1971c2", "#1a1a1a", "#ffffff"];
const SIZES = [["S", 4], ["M", 6], ["L", 9], ["XL", 13]];   // multiples of the base unit
const DEFAULT_SIZE = 6;
const TOOLS = [
  // id, icon, i18n key, shortcut
  ["select", "move", "reportToolMove", "v"],
  ["pen", "edit", "reportToolPen", "p"],
  ["eraser", "eraser", "reportToolEraser", "e"],
  ["arrow", "arrow-up-right", "reportToolArrow", "a"],
  ["line", "line", "reportToolLine", "l"],
  ["rect", "square", "reportToolRect", "r"],
  ["ellipse", "circle", "reportToolEllipse", "o"],
  ["highlight", "highlighter", "reportToolMark", "h"],
  ["text", "type", "reportToolText", "t"],
  ["step", "step-number", "reportToolStep", "n"],
  ["blur", "blur", "reportToolBlur", "b"],
];
const BOXY = new Set(["rect", "ellipse", "highlight", "blur"]);
const SEGMENT = new Set(["arrow", "line"]);

const clone = o => JSON.parse(JSON.stringify(o));
const nearSegment = (x, y, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  const k = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - (ax + k * dx), y - (ay + k * dy));
};
const contrastOf = c => (c === "#ffffff" || c === "#ffd400") ? "#1a1a1a" : "#ffffff";

export function openAnnotator({ src, t, esc }) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => run(img, t, esc, resolve);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function run(img, t, esc, resolve) {
  const W = img.naturalWidth, H = img.naturalHeight;
  const unit = Math.max(3, W / 350);            // base stroke, readable at any image size
  let shapes = [], past = [], future = [];
  let tool = "arrow", color = COLORS[0], size = DEFAULT_SIZE;
  let sel = -1;                                  // selected object index
  let cur = null;                                // object being drawn
  let drag = null;                               // { index, x, y, orig, handle?, before, moved }
  let erase = null;                              // { before, changed }
  let eraserAt = null;
  let draft = null;                              // text being typed { x, y, index? }

  // ── DOM ──
  const wrap = document.createElement("div");
  wrap.className = "rep-anno";
  const btn = (attrs, inner, label) => `<button type="button" class="rep-anno-tool" ${attrs} aria-label="${esc(label)}">${inner}</button>`;
  wrap.innerHTML = `
    <div class="rep-anno-bar">
      <div class="rep-anno-group">${TOOLS.map(([id, icon, key, k]) => btn(`data-tool="${id}"`, `<span class="icon icon-${icon} icon-16"></span><kbd>${k.toUpperCase()}</kbd>`, `${t(key)} (${k.toUpperCase()})`)).join("")}</div>
      <span class="rep-anno-sep"></span>
      <div class="rep-anno-group">${COLORS.map((c, i) => `<button type="button" class="rep-anno-color" data-color="${c}" style="background:${c}" aria-label="${c} (${i + 1})"></button>`).join("")}</div>
      <span class="rep-anno-sep"></span>
      <div class="rep-anno-group">${SIZES.map(([l, v]) => `<button type="button" class="rep-anno-size" data-size="${v}">${l}</button>`).join("")}</div>
      <span class="rep-anno-sep"></span>
      <div class="rep-anno-group">
        ${btn(`data-act="undo"`, `<span class="icon icon-undo icon-16"></span>`, t("reportUndo"))}
        ${btn(`data-act="redo"`, `<span class="icon icon-redo icon-16"></span>`, t("reportRedo"))}
        ${btn(`data-act="dup"`, `<span class="icon icon-copy icon-16"></span>`, t("reportDuplicate"))}
        ${btn(`data-act="del"`, `<span class="icon icon-trash icon-16"></span>`, t("reportDeleteShape"))}
      </div>
      <span class="rep-anno-grow"></span>
      <button type="button" class="rep-btn" data-act="cancel">${esc(t("btnCancel"))}</button>
      <button type="button" class="rep-btn rep-btn--primary" data-act="done">${esc(t("reportAnnoDone"))}</button>
    </div>
    <div class="rep-anno-stage"><div class="rep-anno-canvas-wrap"><canvas></canvas></div></div>
    <div class="rep-anno-tip"></div>`;
  document.body.appendChild(wrap);
  const canvas = wrap.querySelector("canvas");
  const holder = wrap.querySelector(".rep-anno-canvas-wrap");
  const tip = wrap.querySelector(".rep-anno-tip");
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext("2d");
  // Pixelated copy of the screenshot, made once — what a blur area shows.
  const pix = (() => {
    const k = Math.max(6, Math.round(unit * 3));
    const small = document.createElement("canvas");
    small.width = Math.max(1, Math.round(W / k)); small.height = Math.max(1, Math.round(H / k));
    small.getContext("2d").drawImage(img, 0, 0, small.width, small.height);
    const big = document.createElement("canvas");
    big.width = W; big.height = H;
    const bg = big.getContext("2d");
    bg.imageSmoothingEnabled = false;
    bg.drawImage(small, 0, 0, W, H);
    return big;
  })();

  // ── Geometry ──
  const norm = s => ({ x: Math.min(s.x1, s.x2), y: Math.min(s.y1, s.y2), w: Math.abs(s.x2 - s.x1), h: Math.abs(s.y2 - s.y1) });
  const fontPx = s => unit * (s.size || DEFAULT_SIZE);
  const font = s => `700 ${fontPx(s)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const stepR = s => unit * (s.size || DEFAULT_SIZE) * 0.75;
  function boxOf(s) {
    if (s.tool === "text") {
      g.font = font(s);
      const lines = String(s.text || "").split("\n");
      const w = Math.max(...lines.map(l => g.measureText(l).width));
      return { x: s.x1, y: s.y1, w, h: fontPx(s) * 1.2 * lines.length };
    }
    if (s.tool === "step") { const r = stepR(s); return { x: s.x1 - r, y: s.y1 - r, w: r * 2, h: r * 2 }; }
    return norm(s);
  }
  const handlesOf = s => SEGMENT.has(s.tool) ? [["x1", "y1"], ["x2", "y2"]]
    : BOXY.has(s.tool) ? [["x1", "y1"], ["x2", "y1"], ["x1", "y2"], ["x2", "y2"]] : [];
  function hit(s, x, y, strict) {
    const pad = unit * 3;
    if (SEGMENT.has(s.tool)) return nearSegment(x, y, s.x1, s.y1, s.x2, s.y2) <= pad;
    if (s.tool === "pen") return (s.points || []).some((q, i, a) => i > 0 && nearSegment(x, y, a[i - 1].x, a[i - 1].y, q.x, q.y) <= pad);
    if (strict && s.tool === "ellipse") {
      const b = norm(s), rx = b.w / 2 || 1, ry = b.h / 2 || 1;
      const d = Math.hypot((x - b.x - rx) / rx, (y - b.y - ry) / ry);
      return Math.abs(d - 1) * Math.min(rx, ry) <= pad;
    }
    const b = boxOf(s);
    const inside = x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;
    if (strict && (s.tool === "rect" || s.tool === "highlight" || s.tool === "blur")) {
      const deep = x > b.x + pad && x < b.x + b.w - pad && y > b.y + pad && y < b.y + b.h - pad;
      return inside && !deep;
    }
    return inside;
  }
  const topHit = (x, y, strict) => { for (let i = shapes.length - 1; i >= 0; i--) if (hit(shapes[i], x, y, strict)) return i; return -1; };
  const handleScreen = () => 12 * (W / canvas.getBoundingClientRect().width);   // 12 css px
  function handleAt(x, y) {
    if (sel < 0) return null;
    const s = shapes[sel], h = handleScreen();
    for (const [xk, yk] of handlesOf(s)) if (Math.abs(x - s[xk]) <= h && Math.abs(y - s[yk]) <= h) return [xk, yk];
    return null;
  }
  function move(s, dx, dy) {
    s.x1 += dx; s.x2 += dx; s.y1 += dy; s.y2 += dy;
    if (s.points) s.points.forEach(p => { p.x += dx; p.y += dy; });
  }
  function penBox(s) {
    const xs = s.points.map(p => p.x), ys = s.points.map(p => p.y);
    s.x1 = Math.min(...xs); s.y1 = Math.min(...ys); s.x2 = Math.max(...xs); s.y2 = Math.max(...ys);
  }
  // Eraser: cuts the pen strokes it passes over (a stroke can split in two);
  // any other object it touches is removed whole.
  function eraseAt(x, y, r) {
    let changed = false;
    const out = [];
    for (const s of shapes) {
      if (s.tool !== "pen") { if (hit(s, x, y, true)) { changed = true; continue; } out.push(s); continue; }
      const pts = s.points; const runs = [[]]; let touched = false;
      pts.forEach((q, i) => {
        const inside = Math.hypot(q.x - x, q.y - y) <= r;
        const crossed = i > 0 && !inside && nearSegment(x, y, pts[i - 1].x, pts[i - 1].y, q.x, q.y) <= r;
        if (inside || crossed) { touched = true; if (runs.at(-1).length) runs.push([]); }
        if (!inside) runs.at(-1).push(q);
      });
      if (!touched) { out.push(s); continue; }
      changed = true;
      runs.filter(r2 => r2.length >= 2).forEach(r2 => { const n = { ...s, points: r2 }; penBox(n); out.push(n); });
    }
    if (changed) { shapes = out; sel = -1; }
    return changed;
  }

  // ── History ──
  function commit(before) { past.push(before); if (past.length > 80) past.shift(); future = []; syncBar(); }
  function undo() { if (!past.length) return; future.push(clone(shapes)); shapes = past.pop(); sel = -1; syncBar(); redraw(); }
  function redo() { if (!future.length) return; past.push(clone(shapes)); shapes = future.pop(); sel = -1; syncBar(); redraw(); }

  // ── Drawing ──
  function drawShape(c, s) {
    c.save();
    c.strokeStyle = s.color; c.fillStyle = s.color; c.lineCap = "round"; c.lineJoin = "round";
    c.lineWidth = unit * (s.size || DEFAULT_SIZE) / DEFAULT_SIZE;
    if (s.tool === "pen") {
      const p = s.points || [];
      if (p.length > 1) {
        c.beginPath(); c.moveTo(p[0].x, p[0].y);
        for (let i = 1; i < p.length - 1; i++) c.quadraticCurveTo(p[i].x, p[i].y, (p[i].x + p[i + 1].x) / 2, (p[i].y + p[i + 1].y) / 2);
        c.lineTo(p.at(-1).x, p.at(-1).y); c.stroke();
      }
    } else if (s.tool === "highlight") {
      const b = norm(s);
      // Plain translucent fill: "multiply" (Zonara's light UI) vanishes on Studio's
      // dark screens; 35 % reads on both and keeps what is under it legible.
      c.globalAlpha = 0.35; c.fillRect(b.x, b.y, b.w, b.h);
    } else if (s.tool === "blur") {
      const b = norm(s);
      if (b.w > 0 && b.h > 0) c.drawImage(pix, b.x, b.y, b.w, b.h, b.x, b.y, b.w, b.h);
    } else if (s.tool === "rect") {
      const b = norm(s); c.strokeRect(b.x, b.y, b.w, b.h);
    } else if (s.tool === "ellipse") {
      const b = norm(s);
      c.beginPath(); c.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2); c.stroke();
    } else if (SEGMENT.has(s.tool)) {
      const a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1), head = c.lineWidth * 4.5 + unit * 2;
      c.beginPath(); c.moveTo(s.x1, s.y1);
      if (s.tool === "arrow") c.lineTo(s.x2 - Math.cos(a) * head * 0.6, s.y2 - Math.sin(a) * head * 0.6); else c.lineTo(s.x2, s.y2);
      c.stroke();
      if (s.tool === "arrow") {
        c.beginPath(); c.moveTo(s.x2, s.y2);
        c.lineTo(s.x2 - head * Math.cos(a - 0.45), s.y2 - head * Math.sin(a - 0.45));
        c.lineTo(s.x2 - head * Math.cos(a + 0.45), s.y2 - head * Math.sin(a + 0.45));
        c.closePath(); c.fill();
      }
    } else if (s.tool === "text") {
      // Text with a contrasting halo — readable on any background.
      c.font = font(s); c.textBaseline = "top";
      c.lineWidth = fontPx(s) * 0.13; c.strokeStyle = contrastOf(s.color);
      String(s.text || "").split("\n").forEach((l, i) => {
        const y = s.y1 + i * fontPx(s) * 1.2;
        c.strokeText(l, s.x1, y); c.fillText(l, s.x1, y);
      });
    } else if (s.tool === "step") {
      const r = stepR(s);
      c.beginPath(); c.arc(s.x1, s.y1, r, 0, Math.PI * 2); c.fill();
      c.lineWidth = r * 0.14; c.strokeStyle = contrastOf(s.color); c.stroke();
      c.fillStyle = contrastOf(s.color); c.font = `800 ${r * 1.15}px system-ui, -apple-system, sans-serif`;
      c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(String(s.n), s.x1, s.y1 + r * 0.06);
    }
    c.restore();
  }
  function redraw(forExport) {
    g.clearRect(0, 0, W, H);
    g.drawImage(img, 0, 0);
    shapes.forEach((s, i) => { if (!(draft && draft.index === i)) drawShape(g, s); });
    if (cur) drawShape(g, cur);
    if (forExport) return;
    if (sel >= 0 && shapes[sel]) {
      const s = shapes[sel], b = boxOf(s), pad = unit * 2, h = handleScreen();
      g.save();
      g.lineWidth = Math.max(2, unit * 0.45); g.strokeStyle = "#1971c2";
      if (!SEGMENT.has(s.tool)) { g.setLineDash([unit * 2, unit * 1.5]); g.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2); g.setLineDash([]); }
      g.fillStyle = "#fff";
      handlesOf(s).forEach(([xk, yk]) => { g.fillRect(s[xk] - h / 2, s[yk] - h / 2, h, h); g.strokeRect(s[xk] - h / 2, s[yk] - h / 2, h, h); });
      g.restore();
    }
    if (tool === "eraser" && eraserAt) {
      g.save(); g.beginPath(); g.arc(eraserAt.x, eraserAt.y, eraserAt.r, 0, Math.PI * 2);
      g.fillStyle = "rgba(255,255,255,.25)"; g.fill(); g.lineWidth = Math.max(2, unit * 0.4); g.strokeStyle = "#fff"; g.stroke();
      g.restore();
    }
  }

  // ── Toolbar state ──
  function syncBar() {
    wrap.querySelectorAll("[data-tool]").forEach(b => b.classList.toggle("is-on", b.dataset.tool === tool));
    const s = shapes[sel];
    const c = s ? s.color : color, z = s ? (s.size || DEFAULT_SIZE) : size;
    wrap.querySelectorAll("[data-color]").forEach(b => b.classList.toggle("is-on", b.dataset.color === c));
    wrap.querySelectorAll("[data-size]").forEach(b => b.classList.toggle("is-on", Number(b.dataset.size) === z));
    wrap.querySelector('[data-act="undo"]').disabled = !past.length;
    wrap.querySelector('[data-act="redo"]').disabled = !future.length;
    wrap.querySelector('[data-act="del"]').disabled = sel < 0;
    wrap.querySelector('[data-act="dup"]').disabled = sel < 0;
    const tipKey = { blur: "reportTipBlur", step: "reportTipStep", text: "reportTipText", eraser: "reportTipEraser", select: "reportTipMove" }[tool];
    tip.textContent = tipKey ? t(tipKey) : "";
    tip.hidden = !tipKey;
    canvas.style.cursor = tool === "select" ? "default" : tool === "text" ? "text" : tool === "eraser" ? "none" : "crosshair";
  }
  function setTool(id) { commitText(); tool = id; if (id !== "select") sel = -1; eraserAt = null; syncBar(); redraw(); }

  // ── Text editing (inline input over the canvas) ──
  function openText(x, y, index) {
    commitText();
    const base = index != null ? shapes[index] : { color, size };
    draft = { x, y, index: index != null ? index : null, color: base.color, size: base.size || DEFAULT_SIZE };
    const scale = canvas.getBoundingClientRect().width / W;
    const ta = document.createElement("textarea");
    ta.className = "rep-anno-text";
    ta.value = index != null ? shapes[index].text : "";
    ta.placeholder = t("reportTextPh");
    ta.rows = 1;
    Object.assign(ta.style, {
      left: `${x * scale}px`, top: `${y * scale}px`, color: draft.color,
      fontSize: `${fontPx(draft) * scale}px`, lineHeight: "1.2",
      WebkitTextStroke: `${Math.max(0.5, fontPx(draft) * 0.04 * scale)}px ${contrastOf(draft.color)}`,
    });
    const fit = () => { ta.style.height = "auto"; ta.style.height = `${ta.scrollHeight}px`; ta.style.width = "auto"; ta.style.width = `${Math.max(80, ta.scrollWidth + 8)}px`; };
    ta.addEventListener("input", fit);
    ta.addEventListener("keydown", e => {
      e.stopPropagation();
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitText(); }
      else if (e.key === "Escape") { e.preventDefault(); draft.cancel = true; commitText(); }
    });
    ta.addEventListener("blur", () => setTimeout(commitText, 0));
    holder.appendChild(ta);
    draft.el = ta;
    redraw();
    requestAnimationFrame(() => { fit(); ta.focus(); ta.select(); });
  }
  function commitText() {
    if (!draft) return;
    const d = draft; draft = null;
    const val = d.cancel ? null : d.el.value.replace(/\s+$/, "");
    d.el.remove();
    const before = clone(shapes);
    if (d.index != null) {
      if (val === null) { redraw(); return; }
      if (!val) { shapes.splice(d.index, 1); sel = -1; }
      else if (val !== shapes[d.index].text) shapes[d.index].text = val;
      else { redraw(); return; }
      commit(before);
    } else if (val) {
      shapes.push({ tool: "text", color: d.color, size: d.size, x1: d.x, y1: d.y, x2: d.x, y2: d.y, text: val });
      sel = -1; commit(before);
    }
    redraw();
  }

  // ── Pointer ──
  const pt = e => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; };
  canvas.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    if (draft) { commitText(); return; }
    const p = pt(e);
    canvas.setPointerCapture(e.pointerId);
    if (tool === "eraser") {
      erase = { before: clone(shapes), changed: false };
      eraserAt = { x: p.x, y: p.y, r: unit * 4 };
      if (eraseAt(p.x, p.y, eraserAt.r)) erase.changed = true;
      redraw(); return;
    }
    const h = handleAt(p.x, p.y);
    if (h) { drag = { index: sel, x: p.x, y: p.y, orig: clone(shapes[sel]), handle: h, before: clone(shapes), moved: false }; return; }
    const idx = topHit(p.x, p.y, tool !== "select");
    if (idx >= 0) {
      sel = idx; syncBar();
      drag = { index: idx, x: p.x, y: p.y, orig: clone(shapes[idx]), before: clone(shapes), moved: false };
      redraw(); return;
    }
    sel = -1;
    if (tool === "select") { syncBar(); redraw(); return; }
    if (tool === "text") { openText(p.x, p.y); return; }
    if (tool === "step") {
      const before = clone(shapes);
      const n = shapes.filter(s => s.tool === "step").reduce((m, s) => Math.max(m, s.n), 0) + 1;
      shapes.push({ tool: "step", color, size, x1: p.x, y1: p.y, x2: p.x, y2: p.y, n });
      sel = -1; commit(before); redraw(); return;
    }
    cur = { tool, color, size, x1: p.x, y1: p.y, x2: p.x, y2: p.y };
    if (tool === "pen") cur.points = [p];
    redraw();
  });
  canvas.addEventListener("pointermove", e => {
    const p = pt(e);
    if (tool === "eraser") {
      eraserAt = { x: p.x, y: p.y, r: unit * 4 };
      if (erase && eraseAt(p.x, p.y, eraserAt.r)) erase.changed = true;
      redraw(); return;
    }
    if (drag) {
      const s = shapes[drag.index], o = drag.orig;
      if (drag.handle) { const [xk, yk] = drag.handle; s[xk] = p.x; s[yk] = p.y; }
      else {
        Object.assign(s, clone(o));
        move(s, p.x - drag.x, p.y - drag.y);
      }
      drag.moved = true; redraw(); return;
    }
    if (cur) {
      if (cur.tool === "pen") {
        const last = cur.points.at(-1);
        if (Math.hypot(p.x - last.x, p.y - last.y) >= 2) { cur.points.push(p); penBox(cur); }
      } else if (e.shiftKey && SEGMENT.has(cur.tool)) {
        // ⇧ snaps to 45° steps.
        const a = Math.round(Math.atan2(p.y - cur.y1, p.x - cur.x1) / (Math.PI / 4)) * (Math.PI / 4);
        const d = Math.hypot(p.x - cur.x1, p.y - cur.y1);
        cur.x2 = cur.x1 + Math.cos(a) * d; cur.y2 = cur.y1 + Math.sin(a) * d;
      } else if (e.shiftKey && (cur.tool === "rect" || cur.tool === "ellipse")) {
        // ⇧ = square / circle.
        const d = Math.max(Math.abs(p.x - cur.x1), Math.abs(p.y - cur.y1));
        cur.x2 = cur.x1 + Math.sign(p.x - cur.x1 || 1) * d; cur.y2 = cur.y1 + Math.sign(p.y - cur.y1 || 1) * d;
      } else { cur.x2 = p.x; cur.y2 = p.y; }
      redraw(); return;
    }
    if (tool !== "select") canvas.style.cursor = (handleAt(p.x, p.y) || topHit(p.x, p.y, true) >= 0) ? "move" : (tool === "text" ? "text" : "crosshair");
    else canvas.style.cursor = handleAt(p.x, p.y) ? "nwse-resize" : topHit(p.x, p.y, false) >= 0 ? "move" : "default";
  });
  const end = () => {
    if (erase) { if (erase.changed) commit(erase.before); erase = null; redraw(); return; }
    if (drag) {
      if (drag.moved) commit(drag.before);
      else if (shapes[drag.index]?.tool === "text" && tool !== "eraser") { /* single click on text: selected; double-click edits */ }
      drag = null; redraw(); return;
    }
    if (!cur) return;
    const c = cur; cur = null;
    const big = c.tool === "pen" ? c.points.length > 1 : Math.hypot(c.x2 - c.x1, c.y2 - c.y1) > unit * 2;
    // Not selected after drawing: the next colour / size picked is for the NEXT
    // object, not a silent recolour of this one. Click it to edit it.
    if (big) { const before = clone(shapes); shapes.push(c); sel = -1; commit(before); }
    redraw();
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("pointerleave", () => { if (tool === "eraser" && !erase) { eraserAt = null; redraw(); } });
  canvas.addEventListener("dblclick", e => {
    const p = pt(e), i = topHit(p.x, p.y, false);
    if (i >= 0 && shapes[i].tool === "text") { sel = i; openText(shapes[i].x1, shapes[i].y1, i); }
  });

  // ── Toolbar ──
  wrap.querySelector(".rep-anno-bar").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.tool) setTool(b.dataset.tool);
    else if (b.dataset.color) applyStyle({ color: b.dataset.color });
    else if (b.dataset.size) applyStyle({ size: Number(b.dataset.size) });
    else act(b.dataset.act);
  });
  // Colour / size go to the selected object when there is one, else to the next ones.
  function applyStyle(p) {
    if (p.color) color = p.color;
    if (p.size) size = p.size;
    if (sel >= 0) {
      const s = shapes[sel], before = clone(shapes);
      if ((p.color && s.color !== p.color) || (p.size && s.size !== p.size)) { Object.assign(s, p); commit(before); }
    }
    if (draft) {
      if (p.color) { draft.color = p.color; draft.el.style.color = p.color; }
      if (p.size) { draft.size = p.size; draft.el.style.fontSize = `${fontPx(draft) * canvas.getBoundingClientRect().width / W}px`; }
      draft.el.focus();
    }
    syncBar(); redraw();
  }
  function act(a) {
    if (a === "undo") undo();
    else if (a === "redo") redo();
    else if (a === "del" && sel >= 0) { const before = clone(shapes); shapes.splice(sel, 1); sel = -1; commit(before); redraw(); }
    else if (a === "dup" && sel >= 0) {
      const before = clone(shapes), c = clone(shapes[sel]);
      move(c, unit * 6, unit * 6);
      if (c.tool === "step") c.n = shapes.filter(s => s.tool === "step").reduce((m, s) => Math.max(m, s.n), 0) + 1;
      shapes.push(c); sel = shapes.length - 1; commit(before); redraw();
    }
    else if (a === "cancel") finish(false);
    else if (a === "done") finish(true);
  }

  // ── Keyboard ──
  const onKey = e => {
    if (draft) return;                                  // the textarea handles its own keys
    const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
    if (mod && k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && k === "y") { e.preventDefault(); redo(); return; }
    if (mod && k === "d") { e.preventDefault(); act("dup"); return; }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (sel >= 0) { sel = -1; syncBar(); redraw(); } return; }
    if ((e.key === "Delete" || e.key === "Backspace") && sel >= 0) { e.preventDefault(); act("del"); return; }
    if (sel >= 0 && e.key.startsWith("Arrow")) {
      e.preventDefault();
      const d = (e.shiftKey ? 10 : 1) * Math.max(1, W / canvas.getBoundingClientRect().width);
      const before = clone(shapes);
      move(shapes[sel], e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0, e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0);
      commit(before); redraw(); return;
    }
    if (mod || e.altKey) return;
    if (/^[1-7]$/.test(e.key)) { applyStyle({ color: COLORS[Number(e.key) - 1] }); return; }
    const tl = TOOLS.find(x => x[3] === k);
    if (tl) setTool(tl[0]);
  };
  document.addEventListener("keydown", onKey, true);

  function finish(save) {
    commitText();
    document.removeEventListener("keydown", onKey, true);
    sel = -1; eraserAt = null; redraw(true);
    const out = save && shapes.length ? canvas.toDataURL("image/jpeg", 0.9) : null;
    wrap.remove();
    resolve(out);
  }

  syncBar();
  redraw();
}
