# Irreversible and costly actions

**Rule.** Do not run an irreversible or account-wide action without an explicit go for that run: permanent deletion of accounts, documents or files; mass Firestore backfills or recomputes over all accounts; Firestore rules or Functions deploys outside a requested change; force pushes.

**Why.** The founder deletes accounts himself; a full stats backfill was once re-run after every small field change, each run reading across ~2400 accounts.

**How.**
- Permanent deletion (Firebase Auth user, Firestore docs, Storage files): give the founder the command or the console path; he runs it.
- Batch schema changes, then backfill once on an explicit go (`backfillAllUserStats` and similar).
- Before overwriting or deleting a file, look at it; prefer moving it where it belongs over deleting it.
