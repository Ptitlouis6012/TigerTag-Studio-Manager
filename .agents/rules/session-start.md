# Session start

**Rule.** At the start of a session: read `WORKLOG.md`, then run `gh pr list --state open && gh issue list --state open` once and report each item in one line. Reporting is not acting.

**Why.** The repo does not notify anyone; contributor PRs sat for days and reported bugs were rediscovered from scratch.

**How.** Say what is new since the last session. Do not review, fix, merge or close anything without an order (`git-commit-push.md`). Also check the time-sensitive *Active task* block at the top of `CLAUDE.md`.
