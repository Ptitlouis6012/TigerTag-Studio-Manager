# Local MCP server

**Rule.** The MCP tools are read-only, never return a credential, and return decoded named values instead of raw ids.

**Why.** Any AI assistant connected to Studio sees what the tools return.

**How.** Read `docs/MCP.md` before touching MCP code. `secrets` / `apiKeys` are refused and `MCP_SECRET_FIELD` masks the rest; keep `MCP_DATA_GUIDE` true whenever a Firestore field or collection changes.
