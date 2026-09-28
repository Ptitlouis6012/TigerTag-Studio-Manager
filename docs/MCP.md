# MCP — AI assistants read your Studio data

This is the reference for Tiger Studio Manager's **local MCP server**: what it is, how a
user connects an assistant, what it exposes, the rules it follows, and how to extend it
without breaking them. Read it before touching any `mcp` code.

---

## 1. What MCP is, in two minutes

The **Model Context Protocol** (<https://modelcontextprotocol.io>) is the open standard AI
assistants use to call external **tools**. An assistant (the *client*: Claude Desktop,
Claude Code, Cursor, VS Code…) connects to a *server*, asks it for its tool list
(`tools/list`), and calls a tool (`tools/call`) when a question needs it. Each tool has a
name, a description the model reads to decide when to use it, and a JSON Schema for its
arguments. Messages are JSON-RPC 2.0.

Two transports matter here:

- **stdio** — the client launches the server as a subprocess and talks on stdin/stdout
  (how Claude Desktop runs local extensions).
- **Streamable HTTP** — the client POSTs JSON-RPC to a URL (how Claude Code, Cursor and
  VS Code reach an HTTP server).

Studio is an **HTTP server on this computer**, and ships a tiny **stdio bridge** for
clients that only launch subprocesses.

**Local means local.** ChatGPT, and Claude on the web or mobile, call tools *from their own
cloud*; they cannot reach `127.0.0.1`. Serving them needs a hosted connector (see §9).

---

## 2. For the user — turning it on

Settings → **AI assistants** → *Let an AI assistant read your inventory* (off by default).
Then one click:

| Button | What happens |
|---|---|
| **Add to Claude Desktop** | Studio builds a `.mcpb` bundle and opens it → Claude Desktop shows its extension install dialog |
| **Add to Cursor** | opens Cursor's MCP install link |
| **Add to VS Code** | opens VS Code's MCP install link |
| **Copy Claude Code command** | `claude mcp add --transport http tiger-studio <url> --header "Authorization: Bearer <token>"` |
| **New access key** | rotates the token — every assistant must be added again |

Studio must be running (and signed in) for an assistant to get answers.

---

## 3. Architecture

```
AI client ──HTTP POST /mcp──▶ main process: services/mcpServer.js (protocol, auth guard)
   │                                │ tools/call → IPC `mcp:call`
   └─stdio─▶ mcpStdioBridge.js ─────┘          ▼
             (Claude Desktop)        renderer: MCP_TOOLS / MCP_HANDLERS (inventory.js)
                                     reads state + Firestore as the signed-in user
                                               │ IPC `mcp:result`
                                               ▼ answer
```

- **`services/mcpServer.js`** — JSON-RPC: `initialize` (server info + `instructions`),
  `ping`, `tools/list`, `tools/call`; notifications are accepted silently. JSON responses
  only (no SSE: nothing here needs server-initiated messages). Tool failures are returned
  as a result with `isError: true` (readable by the model), not as protocol errors.
- **`services/mcpStdioBridge.js`** — stdin line ⇄ HTTP POST relay. Dependency-free.
- **`main.js`** (section *Local MCP server* in `CODEMAP-main.md`) — prefs, start/stop,
  `mcp:*` IPC, relay to the renderer (15 s timeout), `.mcpb` builder (`_mcpBuildBundle`,
  dependency-free `_zip`) and install links (`mcp:install`).
- **`renderer/inventory.js`** (section *Local MCP server* in `renderer/CODEMAP.md`) — the
  tools, the notice (`MCP_DATA_GUIDE`), the decoder, and the Settings card.

**Why the tools live in the renderer:** that is where the signed-in Firebase session and
the already-loaded inventory are. Reads go through the same Firestore Security Rules as
the rest of the app — the server never holds credentials of its own.

Prefs: `<userData>/mcp.json` = `{ enabled, port (5795), token }`, file mode 600.
Bundle + bridge copies: `<userData>/mcp/`.

---

## 4. Security — the rules this server keeps

| Rule | How |
|---|---|
| **Read-only** | every tool is a query; `annotations.readOnlyHint: true` on each |
| **Loopback only** | listens on `127.0.0.1` — never another interface |
| **Token** | `Authorization: Bearer <48 hex>` required, else **401**; rotatable |
| **No DNS rebinding** | `Host` must be `127.0.0.1:<port>` / `localhost:<port>`, else **403** |
| **No browser** | any `Origin` header → **403** (a web page cannot call it) |
| **Scope** | the account's own `users/{uid}/…`, an accepted friend's `inventory` / `racks` / `products` / `lists`, and `userProfiles/…` — anything else is refused (`_mcpCheckPath`); Firestore rules apply on top |
| **No credentials, ever** | `secrets` and `apiKeys` subtrees refused; fields matching `MCP_SECRET_FIELD` masked as `"[redacted]"` — passwords, access / check codes, tokens, keys, certs, cloud logins |
| **Identity privacy** | e-mail and the Google real name (`googleName`, `firstName`, `lastName`) are masked — the app never displays them either |
| **Off by default** | the user turns it on; turning it off stops the listener |

Why masking matters: an assistant's conversation may be stored by its vendor. Anything
returned by a tool should be assumed to leave the machine.

---

## 5. The tools

High-level (preferred — shaped for questions people ask):

| Tool | Returns |
|---|---|
| `data_guide` | **the notice** — what every field, id and collection means (see §6) |
| `account_overview` | account doc (masked), preferences, server stats, counts, friends, the uid |
| `search_inventory` | spools filtered by `query`, `brand`, `material`, `max/min_remaining_g`, `stored`, `limit` |
| `get_spool` | one spool in full: colours, weights, location, temperatures (own, else the material's recommendation — `temperatures_source` says which), twin |
| `inventory_summary` | totals, by material, by brand, low stock, not stored |
| `list_racks` | racks, size, spools stored |
| `list_printers` | printers, model name, online now (live, from Studio) |
| `list_friends` | accepted friends |
| `friend_inventory` | a friend's spools (same filters) |
| `list_wishlists` | own or a friend's lists with items |
| `data_history` | history points (stock value, counts), newest first |
| `list_devices` | TigerScale scales + printer documents (masked) |

Raw access (anything else in scope):

| Tool | Returns |
|---|---|
| `firestore_get` | one document by path |
| `firestore_query` | a collection, with `where` / `order_by` / `limit` (≤ 200) |

Counts are per **physical spool**: a twin-chip pair is one spool (`deduplicateTwins`,
same as the header stats).

---

## 6. The notice — why decoding matters

A raw spool document is unreadable to a model: `id_brand: 26145`, `id_aspect2: 252`,
`data2: 190`. Two mechanisms fix that:

1. **Decoding** — every document returned (`_mcpDocOut`) carries `data` (raw, masked)
   and, for spool-shaped docs, `decoded`: brand, material, aspects, type, diameter, chip
   version, colours as hex, nozzle / bed / drying temperatures, capacity, remaining grams…
   Labels are resolved **by ID** through the reference DB, never by string matching
   (CLAUDE.md rule).
2. **`data_guide`** — the notice (`MCP_DATA_GUIDE`): tiers, every spool field, every
   collection, friends, units. The server's `instructions` tell the model to call it first.

**`data1`-`data7` mean different things per product type** (`docs/TTAG-FIELDS.md`,
*Chip data slots*), so both the decoder (`_mcpDecodeDataSlots`, keyed on the `id_type`
ID) and the notice follow the type:

| Slot | Filament (142, or no `id_type` = legacy filament) | Resin (173) | Accessories (116), Spare Part (41) |
|---|---|---|---|
| `data1` | diameter id (56 = 1.75 mm) | mixing time, min | unused |
| `data2` / `data3` | nozzle temp min / max °C | work temp min / max °C | unused |
| `data4` / `data5` | drying °C / hours | curing °C / min | unused |
| `data6` / `data7` | bed temp min / max °C | washing °C / min | unused |

`info1` / `info2` / `info3` are material **flags** set from the catalogue — refill (no
spool), recycled, filled (a filler besides the polymer — stone, wood, carbon / glass fibre, metal…) — and are not written on the chip.
*Open point:* `docs/TTAG-FIELDS.md` still calls them "free-text slots"; the code and the
data use them as booleans. The notice follows the data until the contract is ratified.

**Keep them true.** When a field or collection is added or changes meaning, update
`MCP_DATA_GUIDE` (and `_mcpDecodeSpool` if it is a spool field) in the same change —
same reflex as `docs/firestore-schema.md`.

---

## 7. Adding or changing a tool — checklist

1. **Is it read-only?** If it writes, stop: writes need the confirmation flow (§9).
2. Add the definition to `MCP_TOOLS` — `name` (snake_case verb), `title`, a
   **description written for the model** (what it returns, when to use it, units),
   `inputSchema` (JSON Schema, describe every property), `annotations: { readOnlyHint: true }`.
3. Add the handler to `MCP_HANDLERS`. Start with `_mcpRows()` / `_mcpMe()` (signed-in and
   own-account guards). Return a **plain object** (it becomes `structuredContent` and a
   JSON text block). Throw an `Error` with a human sentence for "not found" cases.
4. Return **decoded, named values** (grams, °C, labels) — never make the model interpret
   ids. Pass documents through `_mcpDocOut` / `_mcpPlain` so masking applies.
5. Never return a credential. If a new sensitive field name appears, extend
   `MCP_SECRET_FIELD`.
6. Cap list sizes (`limit`, ≤ 200) — a model's context is finite.
7. Update this file (§5), `MCP_DATA_GUIDE` if the data changes, `renderer/CODEMAP.md`.
8. Test (§8). A new tool reaches Claude Desktop only after the user re-adds the bundle
   (its manifest lists the tools).

**Descriptions are the API.** The model chooses tools from their descriptions alone: be
explicit about units, what "empty" means, and which tool to prefer.

---

## 8. Testing

```bash
npm run start:drive                       # dev app, then Settings → AI assistants → on
TOK=$(npm run -s drive -- eval "(async()=>(await window.mcpBridge.getConfig()).token)()")
curl -s -H "Content-Type: application/json" -H "Authorization: Bearer $TOK" \
  http://127.0.0.1:5795/mcp -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
curl -s -H "Content-Type: application/json" -H "Authorization: Bearer $TOK" \
  http://127.0.0.1:5795/mcp -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"inventory_summary","arguments":{}}}'
```

- **Guards**: no token → 401; `-H "Origin: https://x"` → 403; a path outside the scope →
  `isError` with the reason.
- **Masking audit**: walk `list_devices` / `account_overview` output for key names like
  `key|code|pass|token|cert|mail|name` and check each is either harmless or `[redacted]`.
- **stdio bridge**: pipe JSON-RPC lines into
  `ELECTRON_RUN_AS_NODE=1 TIGER_MCP_URL=… TIGER_MCP_TOKEN=… <electron> <userData>/mcp/tiger-mcp-bridge.js`.
- **Bundle**: `unzip -t "<userData>/mcp/Tiger Studio Manager.mcpb"` and read its `manifest.json`.
- The official **MCP Inspector** (`npx @modelcontextprotocol/inspector`) gives a UI to
  browse and call tools against `http://127.0.0.1:5795/mcp` with the bearer header.

---

## 9. Roadmap (see `ROADMAP.md`)

1. **Hosted TigerTag connector** — a remote MCP server on the backend with OAuth sign-in on
   the TigerTag account, reading Firestore directly: the only way to reach **ChatGPT** and
   Claude web / mobile; works without Studio running (live printer state stays Studio-only).
2. **Writes behind a confirmation** — set a weight, place a spool: each call raises an
   in-app prompt; nothing is written silently. Mark such tools `readOnlyHint: false`,
   `destructiveHint` where relevant.
3. **In-app agent** sharing the same tool registry (local model, Ollama, or the user's key).

---

## 10. Formats referenced

- `.mcpb` — MCP Bundle, manifest `0.3`: a zip with `manifest.json` at the root
  (`name`, `version`, `description`, `author`, `server { type: "node", entry_point,
  mcp_config { command, args ["${__dirname}/server/index.js"], env } }`, `icon`, `tools`).
  Spec: <https://github.com/modelcontextprotocol/mcpb>.
- Cursor install link: `cursor://anysphere.cursor-deeplink/mcp/install?name=<n>&config=<base64 JSON>`.
- VS Code install link: `vscode:mcp/install?<url-encoded JSON {name, type, url, headers}>`.
