// TigerTag RFID Tester — renderer-side modal logic (ES Module)
// Handles: reader slots UI, card-present state, on-demand read + result display.
// No i18n — all strings are English (internal diagnostic tool).

import { questBump } from "../../quests/index.js";

// ── State ─────────────────────────────────────────────────────────────────────
// Map of readerName → { connected, cardPresent, uid, resultHtml }
// resultHtml keeps the last read on screen while chips come and go, and across
// a re-render when another reader is plugged in.
const _readers = new Map();

// ── Helpers ───────────────────────────────────────────────────────────────────
function _$(id) { return document.getElementById(id); }

function _colId(readerName) {
  return 'rfid-col-result-' + readerName.replace(/[^a-z0-9]/gi, '_');
}

function _esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const _shortName = name => name.replace(/^ACS\s*/i, '').trim() || name;
const _stateText = r => r.cardPresent ? `Chip detected${r.uid ? ' · ' + String(r.uid).toUpperCase() : ''}` : 'Waiting for a chip';

// ── Modal open / close ────────────────────────────────────────────────────────
export function openRfidTesterModal() {
  _$('rfidTestOverlay')?.classList.add('open');
  _renderSlots();
}

export function closeRfidTesterModal() {
  _$('rfidTestOverlay')?.classList.remove('open');
}

// ── Slots render ──────────────────────────────────────────────────────────────
// Idle body of a reader card: pulsing rings while it waits, the chip icon lit
// once a chip sits on it.
function _idleHtml(r) {
  return `
    <div class="rfid-idle${r.cardPresent ? ' is-card' : ''}">
      <span class="rfid-idle-ic">
        ${r.cardPresent ? '' : '<i class="rfid-ring rfid-ring--1"></i><i class="rfid-ring rfid-ring--2"></i>'}
        <span class="rfid-test-icon"></span>
      </span>
      <p class="rfid-test-hint">${r.cardPresent ? 'Chip detected. Click Read.' : 'Place a chip on the reader'}</p>
    </div>`;
}

function _renderSlots() {
  const container = _$('rfidColumns');
  if (!container) return;

  if (_readers.size === 0) {
    container.innerHTML = `
      <div class="rfid-no-reader">
        <span class="rfid-test-icon"></span>
        <b>No reader detected</b>
        <p>Plug in an ACR122U reader over USB.</p>
      </div>`;
    return;
  }

  container.innerHTML = [..._readers.entries()].map(([name, r]) => `
      <section class="rfid-reader${r.connected ? '' : ' is-off'}${r.cardPresent ? ' is-card' : ''}" data-reader="${_esc(name)}">
        <header class="rfid-reader-head">
          <span class="rfid-reader-dot" aria-hidden="true"></span>
          <span class="rfid-reader-id">
            <b>${_esc(_shortName(name))}</b>
            <small class="rfid-reader-state">${_esc(_stateText(r))}</small>
          </span>
          <button class="rfid-read-btn" data-rfid-read="${_esc(name)}" ${r.cardPresent ? '' : 'disabled'}>Read</button>
        </header>
        <div class="rfid-reader-body" id="${_colId(name)}">${r.resultHtml || _idleHtml(r)}</div>
      </section>`).join('');
}

// A chip placed or removed: patch that reader's card in place (state line, Read
// button, idle body) — the last result stays until the next Read.
function _patchReader(name) {
  const r = _readers.get(name);
  const card = [...document.querySelectorAll('.rfid-reader')].find(el => el.dataset.reader === name);
  if (!r || !card) return _renderSlots();
  card.classList.toggle('is-card', r.cardPresent);
  card.querySelector('.rfid-reader-state').textContent = _stateText(r);
  card.querySelector('.rfid-read-btn').disabled = !r.cardPresent;
  if (!r.resultHtml) card.querySelector('.rfid-reader-body').innerHTML = _idleHtml(r);
}

// ── Result render ─────────────────────────────────────────────────────────────
// rfid:read-now (main.js) answers { ok, uid, rawPagesHex, tagData } or
// { ok: false, error }; tagData is the SDK's raw dict (TigerTag.toRawDict():
// id_* reference IDs, color_r/g/b/a, measure, timestamp…). The IDs become names
// through the host's reference tables (initRfidTester({ label })).
let _label = () => null;
const TT_EPOCH = 946684800;   // TigerTag timestamps count seconds from 2000-01-01 UTC
const _hex2 = n => Number(n || 0).toString(16).padStart(2, '0');

function _resultHtml(data) {
  const { ok, uid, rawPagesHex, tagData: t, error } = data || {};
  if (!ok || error) return `<div class="rfid-result-error">${_esc(error || 'Read failed')}</div>`;

  const uidRow = `
    <div class="rfid-uid-row">
      <span class="rfid-uid-lbl">UID</span>
      <code>${_esc(String(uid || '').toUpperCase() || '—')}</code>
    </div>`;
  const rawBlock = rawPagesHex
    ? `<details class="rfid-raw-block">
         <summary>Raw memory · ${rawPagesHex.length / 2} bytes</summary>
         <pre class="rfid-raw-hex">${_esc(rawPagesHex.match(/.{1,32}/g).join('\n'))}</pre>
       </details>`
    : '';
  const top = (swatch, title, sub, badges = '') => `
      <div class="rfid-res-top">
        ${swatch}
        <span class="rfid-res-name"><b>${_esc(title)}</b><small>${_esc(sub)}</small></span>
        ${badges}
      </div>`;
  const noSwatch = mark => `<span class="rfid-res-swatch rfid-res-swatch--none" aria-hidden="true">${mark}</span>`;

  const version = t ? _label('version', t.id_tigertag) : null;
  if (!t || !version) {
    return `<div class="rfid-res">
      ${top(noSwatch('?'), 'Not a TigerTag', 'Unknown format: the UID and raw memory are shown as read.')}
      ${uidRow}${rawBlock}</div>`;
  }

  const badges = `<span class="rfid-version-badge">${_esc(version)}</span>${t._certified ? '<span class="rfid-version-badge rfid-version-badge--cert">Certified</span>' : ''}`;
  if (!t.id_brand && !t.id_material && !t.id_product) {
    return `<div class="rfid-res">
      ${top(noSwatch('∅'), 'Empty TigerTag', 'Nothing written on it yet: program it from a spool.', badges)}
      ${uidRow}${rawBlock}</div>`;
  }

  const name = (table, id) => (id ? _label(table, id) : null);
  const hex = `#${_hex2(t.color_r)}${_hex2(t.color_g)}${_hex2(t.color_b)}`.toUpperCase();
  const aspects = [name('aspect', t.id_aspect1), name('aspect', t.id_aspect2)].filter(Boolean).join(', ');
  const diameter = name('diameter', t.id_diameter);
  const weight = t.measure ? `${t.measure} ${name('unit', t.id_unit) || ''}`.trim() : '';
  const sub = [aspects, diameter && `${diameter} mm`, weight].filter(Boolean).join(' · ');
  const range = (a, b, u) => (a || b ? `${a}–${b} ${u}` : '—');
  const made = t.timestamp ? new Date((t.timestamp + TT_EPOCH) * 1000).toLocaleDateString() : '—';
  const tagIndex = (t.tag_info >> 4) & 15, tagCount = t.tag_info & 15;
  const field = (label, val) => `<div class="rfid-field"><dt>${_esc(label)}</dt><dd>${_esc(val)}</dd></div>`;

  return `
    <div class="rfid-res">
      ${top(`<span class="rfid-res-swatch" style="--sw:${hex};--sw-a:${((t.color_a ?? 255) / 255).toFixed(2)}" aria-hidden="true"></span>`,
            `${name('brand', t.id_brand) || 'Unknown brand'} ${name('material', t.id_material) || ''}`.trim(), sub, badges)}
      ${uidRow}
      <dl class="rfid-fields-grid">
        ${field('Colour', t.num_colors > 1 ? `${hex} +${t.num_colors - 1}` : hex)}
        ${field('Nozzle', range(t.nozzle_min, t.nozzle_max, '°C'))}
        ${field('Bed', range(t.bed_min, t.bed_max, '°C'))}
        ${field('Drying', t.dry_temp ? `${t.dry_temp} °C · ${t.dry_time} h` : '—')}
        ${t.td_raw ? field('TD', `${(t.td_raw / 10).toFixed(1)} mm`) : ''}
        ${tagCount ? field('Tag', `${tagIndex || '?'} of ${tagCount}`) : ''}
        ${field('Made on', made)}
        ${field('Product ID', t.id_product || '—')}
        ${t.message ? field('Message', t.message) : ''}
      </dl>
      ${rawBlock}
    </div>`;
}

function _renderResult(data, readerName) {
  const r = _readers.get(readerName);
  const html = _resultHtml(data);
  if (r) r.resultHtml = html;
  const el = _$(_colId(readerName));
  if (el) el.innerHTML = html;
}

// ── IPC event wiring ──────────────────────────────────────────────────────────
/**
 * Call once at app startup (after electronAPI is available).
 * Wires up reader-connect/disconnect and card-present IPC events.
 */
export function initRfidTester({ label } = {}) {
  if (label) _label = label;
  // Modal open / close buttons
  _$('btnRfidTest')?.addEventListener('click', openRfidTesterModal);
  _$('rfidTestClose')?.addEventListener('click', closeRfidTesterModal);
  _$('rfidTestOverlay')?.addEventListener('click', e => {
    if (e.target === _$('rfidTestOverlay')) closeRfidTesterModal();
  });

  // Read button — event-delegated on the columns container
  _$('rfidColumns')?.addEventListener('click', async e => {
    const btn = e.target.closest('[data-rfid-read]');
    if (!btn || btn.disabled) return;
    const readerName = btn.dataset.rfidRead;
    btn.disabled = true;
    btn.classList.add('is-reading');
    const result = await window.electronAPI.readRfidNow(readerName);
    btn.classList.remove('is-reading');
    btn.disabled = !_readers.get(readerName)?.cardPresent;
    _renderResult(result, readerName);
    if (result && !result.error) questBump("nfcTesterRead");
  });

  // Reader connected / disconnected
  window.electronAPI?.onRfidReaderUpdate?.(({ name, connected }) => {
    if (connected) {
      _readers.set(name, { connected: true, cardPresent: false, uid: null, resultHtml: '' });
    } else {
      _readers.delete(name);
    }
    _renderSlots();
  });

  // Card placed / removed
  window.electronAPI?.onRfidCardPresent?.(({ readerName, uid }) => {
    const r = _readers.get(readerName);
    if (r) {
      r.cardPresent = !!uid;
      r.uid    = uid;
      _patchReader(readerName);
    }
  });
}
