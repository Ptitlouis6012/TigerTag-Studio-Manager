import test from 'node:test';
import assert from 'node:assert/strict';
import { extraTemperatureObjects, readTemperatureSensors } from '../renderer/printers/klipper/temperature-sensors.js';
import { themeLogoUrl, renderKlipperLogo } from '../renderer/printers/klipper/logo.js';
import { ctx } from '../renderer/printers/context.js';

test('discover auxiliary temperatures without duplicating tools, bed or chamber', () => {
  const names = ['extruder', 'heater_bed', 'heater_generic chamber', 'temperature_sensor beacon_coil',
    'temperature_sensor mcu_temp', 'temperature_sensor Raspberry_Pi', 'temperature_fan chamber_fan',
    'heater_generic dryer', 'filament_switch_sensor runout', 'temperature_sensor mcu_temp'];
  const extra = extraTemperatureObjects(names, 'heater_generic chamber');
  assert.equal(extra.length, 5);
  assert.ok(extra.includes('temperature_fan chamber_fan'));
  assert.ok(extra.includes('heater_generic dryer'));
  assert.deepEqual(extraTemperatureObjects(['extruder', 'heater_bed'], null), []);
});

test('read only reported finite temperatures, including zero, and retain targets', () => {
  assert.deepEqual(readTemperatureSensors(['temperature_sensor mcu_temp', 'temperature_fan chamber_fan', 'heater_generic absent', 'temperature_sensor bad'], {
    'temperature_sensor mcu_temp': { temperature: 0 },
    'temperature_fan chamber_fan': { temperature: 26, target: 35 },
    'temperature_sensor bad': { temperature: NaN },
  }), [
    { name: 'temperature_sensor mcu_temp', label: 'mcu temp', cur: 0, tgt: null },
    { name: 'temperature_fan chamber_fan', label: 'chamber fan', cur: 26, tgt: 35 },
  ]);
});

test('theme URL follows configured Moonraker port without putting API keys in the URL', () => {
  assert.equal(themeLogoUrl({ ip: 'printer.local', apiKey: 'secret' }), 'http://printer.local:7125/server/files/config/.theme/sidebar-logo.png');
  assert.equal(themeLogoUrl({ ip: 'printer.local:7126' }), 'http://printer.local:7126/server/files/config/.theme/sidebar-logo.png');
  assert.equal(themeLogoUrl({ ip: 'printer.local', port: 7127 }), 'http://printer.local:7127/server/files/config/.theme/sidebar-logo.png');
  for (const ip of ['', 'user:secret@printer', 'printer/?apiKey=secret', 'printer:99999', 'javascript:alert(1)']) assert.equal(themeLogoUrl({ ip }), null);
});

test('theme image has a bundled-logo fallback and no credential exposure', () => {
  ctx.esc = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  const html = renderKlipperLogo({ ip: 'printer.local', apiKey: 'never-publish-this' });
  assert.match(html, /nextElementSibling.hidden=false/);
  assert.match(html, /data-brand="klipper"/);
  assert.ok(!html.includes('never-publish-this'));
  assert.ok(!renderKlipperLogo({ ip: '' }).includes('<img'));
});

test('plugin polls seven temperatures: three pills, four in the Sensors card', async () => {
  const timers = [];
  const original = globalThis.setInterval;
  globalThis.setInterval = (...args) => { const timer = original(...args); timers.push(timer); return timer; };
  let core;
  try { core = await import('../renderer/printers/klipper/core.js'); }
  finally { globalThis.setInterval = original; }
  const status = { extruder: { temperature: 22 }, heater_bed: { temperature: 21 },
    'heater_generic chamber': { temperature: 23 }, 'temperature_sensor beacon_coil': { temperature: 24 },
    'temperature_sensor mcu_temp': { temperature: 38 }, 'temperature_sensor Raspberry_Pi': { temperature: 45 },
    'temperature_fan chamber_fan': { temperature: 25, target: 35 } };
  let query;
  globalThis.window = { printerPlugin: { invoke: async (_brand, action, opts) => {
    if (action !== 'http') return null;
    let result = {};
    if (opts.path === '/server/info') result = { klippy_state: 'ready' };
    if (opts.path === '/printer/objects/list') result = { objects: Object.keys(status) };
    if (opts.path === '/printer/objects/query') { query = opts.body.objects; result = { status }; }
    return { ok: true, status: 200, result };
  } } };
  const printer = { brand: 'klipper', id: 'display-test', ip: 'printer.local' };
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { off(); reject(new Error('poll timed out')); }, 1000);
      const off = core.onKlipperChange(() => {
        if (core.klipperGetConn(printer)?.status === 'connected') { clearTimeout(timeout); off(); resolve(); }
      });
      core.klipperConnect(printer);
    });
    assert.deepEqual(query['temperature_sensor mcu_temp'], ['temperature']);
    assert.deepEqual(query['temperature_fan chamber_fan'], ['temperature', 'target']);
    assert.equal(core.klipperGetConn(printer).data.temps.sensors.length, 4);
    const { renderKlipperTempCard, renderKlipperSensorsCard } = await import('../renderer/printers/klipper/cards.js');
    ctx.t = key => key;
    // Temperature stays the same card as every brand: nozzle, bed, chamber pills.
    const html = renderKlipperTempCard(core.klipperGetConn(printer));
    assert.equal((html.match(/class="snap-temp(?: |")/g) || []).length, 3);
    assert.ok(!html.includes('Raspberry Pi'));
    // The four extra temperatures live in the collapsible Sensors card.
    const sensors = renderKlipperSensorsCard(core.klipperGetConn(printer));
    assert.match(sensors, /<details class="snap-block klipper-sensors"/);
    assert.equal((sensors.match(/class="klipper-sensor(?: |")/g) || []).length, 4);
    assert.match(sensors, /Raspberry Pi/);
  } finally {
    core.klipperDisconnect(printer);
    for (const timer of timers) clearInterval(timer);
    delete globalThis.window;
  }
});
