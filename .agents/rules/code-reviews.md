# Code reviews

**Rule.** Run a project review every few releases and before any release that changes the data model, the security rules or a third-party integration surface; keep every report in `docs/reviews/` and annotate its findings.

**Why.** A review is only worth its cost if the next one can see what the last one found and what was done about it.

**How.** Point the reviewer at `docs/REVIEW-BRIEF.md` (scope, axes, read-only constraint, output format). Name files `YYYY-MM-DD-<scope>.md`. After working a report, mark each finding fixed / deferred (with reason) / rejected. Start from its *Quick wins* table.
