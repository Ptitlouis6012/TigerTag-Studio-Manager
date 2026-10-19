# Token and time efficiency

**Rule.** Optimize total tokens and wall-clock without lowering quality: locate code through the CODEMAPs, read slices not files, delegate cheap lookups to the Haiku/Sonnet project agents, never fan out parallel agents for generation, and keep answers short.

**Why.** The founder pays per token; a 3-agent release fan-out cost ~190k tokens (93% waste) and a sub-agent burned 131k tokens on a lookup the founder could have named in one file.

**How.**
- `renderer/CODEMAP.md` (inventory.js) and `CODEMAP-main.md` (main.js) → `grep -n anchor` → `Read` with offset/limit. Never read either file whole.
- `codemap-explorer` (Haiku) to locate code; `simple-task` (Sonnet) for one self-contained low-risk edit with a self-sufficient prompt. Keep refactors, debugging and architecture on the main loop.
- Ask the founder for the file when he can name it, before delegating a search.
- Short answers by default; detail only when asked. Warn when the context passes ~60k tokens.
