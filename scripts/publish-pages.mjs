#!/usr/bin/env node
// Publishes public/orderat to the gh-pages branch, which GitHub Pages serves at
// https://alishehab01.github.io/orderat/. Run from anywhere: npm run pages:publish
// (or `npm --prefix <repo> run pages:publish`). Only committed files are published.
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const source = join(root, "public", "orderat");
const git = (args, cwd = root) => execFileSync("git", args, { cwd, stdio: "inherit" });
const gitOut = (args, cwd = root) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

if (gitOut(["status", "--porcelain", "--", "public/orderat"])) {
  console.error("public/orderat has uncommitted changes. Commit them first, then publish.");
  process.exit(1);
}
const sha = gitOut(["rev-parse", "--short", "HEAD"]);

git(["fetch", "origin", "gh-pages"]);
const dir = mkdtempSync(join(tmpdir(), "orderat-pages-"));
rmSync(dir, { recursive: true, force: true }); // git worktree add wants to create the folder itself
try {
  git(["worktree", "add", "--detach", dir, "origin/gh-pages"]);
  for (const name of readdirSync(dir)) {
    if (name !== ".git") rmSync(join(dir, name), { recursive: true, force: true });
  }
  cpSync(source, dir, { recursive: true });
  git(["add", "-A"], dir);
  if (!gitOut(["status", "--porcelain"], dir)) {
    console.log("gh-pages already matches public/orderat. Nothing to publish.");
  } else {
    git(["commit", "-m", `Publish public/orderat from ${sha}`], dir);
    git(["push", "origin", "HEAD:gh-pages"], dir);
    console.log("Published. https://alishehab01.github.io/orderat/ updates in about a minute.");
  }
} finally {
  git(["worktree", "remove", "--force", dir]);
}
