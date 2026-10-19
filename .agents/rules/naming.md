# Naming

**Rule.** Every new name (Firestore collection/field, function, variable, CSS class, IPC channel, config key) says plainly what it is. No several states packed into one cryptic value, no stored field that can be derived.

**Why.** Founder rule: clear semantics now prevent compounding complexity (e.g. `rfidList` over `rfidChips`; a `backup` field's presence already means TigerTag+, so no extra type field).

**How.** Prefer separate well-named booleans to magic numbers; when a name turns out unclear, rename it and its doc/schema rather than letting it stand. One value per field (the Klipper `ip` holding `host:port` is a deliberate exception kept for device-firmware compatibility).
