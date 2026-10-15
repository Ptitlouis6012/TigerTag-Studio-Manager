/** Additional temperature objects, excluding the chamber already shown separately. */
export function extraTemperatureObjects(names, chamber) {
  return [...new Set(names)].filter(name => name !== chamber
    && /^(temperature_sensor|temperature_fan|heater_generic) .+/.test(name));
}

export function readTemperatureSensors(names, status) {
  return names.flatMap(name => {
    const value = status[name];
    if (!Number.isFinite(value?.temperature)) return [];
    return [{ name, label: name.slice(name.indexOf(' ') + 1).replaceAll('_', ' '),
      cur: value.temperature, tgt: Number.isFinite(value.target) ? value.target : null }];
  });
}
