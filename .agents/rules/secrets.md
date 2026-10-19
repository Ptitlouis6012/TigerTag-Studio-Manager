# Secrets and personal data

**Rule.** No secret, account email or machine path in any committed file, log line meant for others, screenshot, MCP output or shared view. Tokens are created and entered by the founder, never by the agent, and never pasted into the chat.

**Why.** The repos are public. An admin account email once leaked into a public runbook and stays in git history; GitHub tokens were twice echoed in the app terminal and had to be rotated.

**How.**
- Name accounts by handle or role ("the team Owner account"), never by email address.
- Absolute paths (`/Users/…`) and the checkout layout live only in `CLAUDE.local.md` (gitignored); refer to sibling repos by name (`../TigerTag_Firebase_Backend`).
- Firebase secrets: the founder runs `pbpaste | firebase functions:secrets:set NAME --project tigertag-connect --data-file -` (the app terminal echoes typed secrets).
- Device secrets `lan_access_code` and `lan_url` (Tiger Touch, TigerScale) are never displayed in side cards, exports, logs or MCP output; raw-JSON debug views mask them. `MCP_SECRET_FIELD` in `renderer/inventory.js` lists the masked field names.
- Accepted exception: the Bambu RTSP URL (with access code) stays in clear in the local ffmpeg error log — founder's call, do not re-raise.
