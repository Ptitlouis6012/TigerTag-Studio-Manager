#!/usr/bin/env node
// Ship a Tiger Studio Web hotfix — web only, NO desktop build.
//
// Tags the current commit `web-vX.Y.Z.N` and pushes the tag. X.Y.Z is the
// latest published desktop release (it must equal package.json at this commit,
// so the version number never drifts); N is the next free hotfix number for it.
// The tag triggers .github/workflows/web-sync.yml, which redeploys the Hub; the
// Hub builds the highest web-vX.Y.Z.N and the app shows "X.Y.Z · web N".
// Policy and limits: docs/WEB_HOTFIX.md.
//
// Usage: npm run web:hotfix            (tags HEAD and pushes)
//        npm run web:hotfix -- --dry-run

import { execFileSync } from "node:child_process";

const REPO = "TigerTag-Project/TigerTag-Studio-Manager";
const DRY = process.argv.includes("--dry-run");
const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();
const fail = (msg) => { console.error(`[web-hotfix] ${msg}`); process.exit(1); };

git("fetch", "--quiet", "origin", "main", "--tags");
const head = git("rev-parse", "HEAD");
try { git("merge-base", "--is-ancestor", head, "origin/main"); }
catch { fail("this commit is not on origin/main yet — commit and push it first"); }

const res = await fetch(`https://github.com/${REPO}/releases/latest`, { redirect: "manual" });
const latest = (res.headers.get("location") || "").match(/\/releases\/tag\/v([^/?#]+)$/)?.[1];
if (!latest) fail("can't resolve the latest published release");

const committed = JSON.parse(git("show", "HEAD:package.json")).version;
if (committed !== latest) {
  fail(`package.json at this commit is ${committed}, the latest release is ${latest} — ` +
       `a hotfix keeps the release's version; ship ${committed} as a normal release instead`);
}

const tags = git("ls-remote", "--tags", "origin", `refs/tags/web-v${latest}.*`);
const used = [...tags.matchAll(/refs\/tags\/web-v[\d.]+?\.(\d+)$/gm)].map(m => Number(m[1]));
const n = (used.length ? Math.max(...used) : 0) + 1;
const tag = `web-v${latest}.${n}`;

console.log(`[web-hotfix] ${tag} → ${head.slice(0, 7)}  (web shows "${latest} · web ${n}")`);
if (DRY) { console.log("[web-hotfix] dry run — nothing tagged"); process.exit(0); }

git("tag", "-a", tag, "-m", `Tiger Studio Web hotfix ${n} for v${latest}`);
git("push", "--quiet", "origin", tag);
console.log(`[web-hotfix] pushed — watch the "Web sync" run: https://github.com/${REPO}/actions/workflows/web-sync.yml`);
