# What's New entries

**Rule.** One What's New item = one topic, benefit-first, in all 11 locales, with an icon name (not an emoji), and only for features a normal user can see.

**Why.** The founder found crammed two-subject items confusing; admin/debug features in the modal confuse users.

**How.**
- Scaffold `npm run whatsnew:add -- <x.y.z> [--items N]`, fill every locale, validate `npm run whatsnew:check`.
- `icon` is an `.icon-<name>` mask name (`list-check`, `cart`, `bell`…).
- No concrete technical examples ("shop names show cleanly", not a hostname).
- Admin, debug-mode, telemetry and internal changes are excluded here and from the release note; they stay in the CHANGELOG.
- Never delete old versions from the file; propose archiving when it grows large.
