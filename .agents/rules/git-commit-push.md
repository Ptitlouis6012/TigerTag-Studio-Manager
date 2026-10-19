# Git: commit, push, tag, merge

**Rule.** Never commit, push, tag, merge a PR, or close an issue/PR without an explicit order from the founder for that action. Make the change, report it, then stop.

**Why.** The founder reviews the diff and picks the moment; merges and closes are as final as a commit.

**How.**
- "commit" authorizes a commit, not a push; "release" / "push, build, OTA" authorizes the full release sequence (`release.md`).
- Leave `WORKLOG.md` and the placeholder `package.json` version uncommitted between releases unless the order covers them (`worklog.md`).
- Behaviour that depends on real hardware (printers, RFID, scales, TD1S): ask for a test on the founder's setup before proposing the commit.
- Release tag: tag a commit whose first line is `vX.Y.Z — <summary>`, never the merge commit (the Actions run title comes from it).
- Exceptions: pure documentation repos (`TigerSystem-Docs`, `TigerTag_Firebase_Integration`) are committed on every change; `SliceForge` is autonomous (see `CLAUDE.local.md`).
- No AI attribution in any commit (`no-ai-attribution.md`).
