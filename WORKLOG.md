# Worklog — v2.31.1 (in progress)

## Added
- Local MCP server for AI assistants (read-only) — full reference `docs/MCP.md`. Settings › AI assistants turns it on (off by default) with one-click installs: **Add to Claude Desktop** (Studio builds a `.mcpb` bundle, MCPB manifest 0.3, URL + token baked in, and opens it → Claude Desktop's install dialog), **Add to Cursor** / **Add to VS Code** (their MCP install links), a copyable Claude Code command, and a rotatable key. 14 tools: `data_guide` (the notice: every field — data1-data7, id_*, tiers — and collection), `account_overview`, `search_inventory`, `get_spool` (own temps, else the material's recommendation), `inventory_summary`, `list_racks`, `list_printers` (model names, online state), `list_friends`, `friend_inventory`, `list_wishlists`, `data_history`, `list_devices`, and raw `firestore_get` / `firestore_query` over the account's own tree + what friends share + public profiles. Every document is returned DECODED next to its raw fields (labels resolved by ID; the seven chip data slots read per product type — filament temps / diameter, resin mixing / work / curing / washing, unused for accessories and spare parts; info1-3 as refill / recycled / filled flags); counts per physical spool (twins de-duplicated). Security: 127.0.0.1:5795 only, bearer token, Host check against DNS rebinding, browser Origins refused, `secrets` / `apiKeys` refused, credentials (passwords, access / check codes, tokens, keys, certs, cloud logins) and the e-mail / Google real name masked — `services/mcpServer.js`, `services/mcpStdioBridge.js`, `main.js`, `preload.js`, `renderer/inventory.{js,html}`, `docs/MCP.md`, `CLAUDE.md`, `renderer/CODEMAP.md`, `CODEMAP-main.md`, `ROADMAP.md`

## Changed

## Fixed

## Removed

## i18n
- Added: `stgMcpTitle`, `stgMcpToggle`, `stgMcpToggleSub`, `stgMcpHelp`, `stgMcpAddClaude`, `stgMcpAddCursor`, `stgMcpAddVscode`, `stgMcpAddOpened`, `stgMcpAddFailed`, `stgMcpCopyCode`, `stgMcpNewKey`, `stgMcpOn`, `stgMcpError`, `stgMcpCopied`, `stgMcpNewKeyDone` — 11 locales
- Pending cleanup, carried over from v2.23.1: `scaleNoActivity` and `scaleReader` are orphaned — still shipped in all 11 locales, no longer referenced anywhere in `renderer/`
