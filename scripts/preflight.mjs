#!/usr/bin/env node
// preflight.mjs — checks an Obsidian community plugin repo before a release or a directory submission.
// Copied into each plugin repo by obsidian-release-kit; one file, no dependencies, Node 20+.
//
// Usage: node scripts/preflight.mjs [--root <dir>] [--tag <tag>] [--release] [--offline] [--strict] [--json]
//   --root     the plugin repo (default: current directory)
//   --tag      the git tag being released; must equal the manifest version exactly
//   --release  also require the built assets (main.js, manifest.json) to exist
//   --offline  skip the community directory fetch
//   --strict   warnings fail too
//   --json     machine-readable output
// Exit 0 when every check passes (warnings allowed unless --strict), 1 otherwise.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i === -1 || i + 1 >= args.length ? undefined : args[i + 1];
};

const root = resolve(value("--root") ?? ".");
if (!existsSync(root) || !statSync(root).isDirectory()) {
  console.error(`FAIL  root  — ${root} is not a directory`);
  process.exit(1);
}
const results = [];
const pass = (check, note = "") => results.push({ level: "PASS", check, note });
const warn = (check, note) => results.push({ level: "WARN", check, note });
const fail = (check, note) => results.push({ level: "FAIL", check, note });

const DIRECTORY_URL = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-plugins.json";
const DESCRIPTION_MAX = 250;

function readJson(rel) {
  const path = join(root, rel);
  if (!existsSync(path)) return { missing: true };
  try {
    return { data: JSON.parse(readFileSync(path, "utf8")) };
  } catch (e) {
    return { error: e.message };
  }
}

function git(...argv) {
  try {
    return execFileSync("git", argv, { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}

function githubSlug() {
  const url = git("remote", "get-url", "origin");
  if (!url) return null;
  const m = url.match(/github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/);
  return m ? m[1] : null;
}

function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|mjs)$/.test(name) && name !== "main.js" && !/\.(test|spec)\./.test(name)) out.push(p);
    }
  };
  const src = join(root, "src");
  if (existsSync(src)) walk(src);
  for (const candidate of ["main.ts", "main.mts"]) {
    const p = join(root, candidate);
    if (existsSync(p)) out.push(p);
  }
  return out;
}

// --- manifest ---------------------------------------------------------------

const manifestRead = readJson("manifest.json");
let manifest = null;
if (manifestRead.missing) fail("manifest.json", "missing at the repo root");
else if (manifestRead.error) fail("manifest.json", `does not parse: ${manifestRead.error}`);
else {
  manifest = manifestRead.data;
  pass("manifest.json", "parses");
}

if (manifest) {
  for (const key of ["id", "name", "version", "minAppVersion", "description", "author", "isDesktopOnly"]) {
    if (!(key in manifest)) fail(`manifest.${key}`, "missing");
  }
  if ("isDesktopOnly" in manifest && typeof manifest.isDesktopOnly !== "boolean") fail("manifest.isDesktopOnly", "must be true or false");

  const id = String(manifest.id ?? "");
  if (id) {
    if (!/^[a-z0-9-]+$/.test(id)) fail("manifest.id", `"${id}" must be lowercase letters, digits and hyphens`);
    else if (/obsidian/.test(id)) fail("manifest.id", `"${id}" must not contain "obsidian"`);
    else pass("manifest.id", id);
  }

  const name = String(manifest.name ?? "");
  if (name) {
    if (/obsidian/i.test(name)) fail("manifest.name", `"${name}" must not contain "Obsidian"`);
    else if (/\bplugin\b/i.test(name)) fail("manifest.name", `"${name}" must not contain "Plugin"`);
    else pass("manifest.name", name);
  }

  const description = String(manifest.description ?? "");
  if (description) {
    const problems = [];
    if (description.length > DESCRIPTION_MAX) problems.push(`${description.length} characters, limit ${DESCRIPTION_MAX}`);
    if (!/^[A-Z]/.test(description)) problems.push("should start with a capital letter");
    if (!/\.$/.test(description.trim())) problems.push("should end with a period");
    if (/obsidian/i.test(description)) problems.push('must not contain "Obsidian"');
    if (problems.length) fail("manifest.description", problems.join("; "));
    else pass("manifest.description", `${description.length} characters`);
    if (/\bplugins?\b/i.test(description)) warn("manifest.description", 'avoid the word "plugin"; say what it does for the user');
  }

  const version = String(manifest.version ?? "");
  if (version) {
    if (/^v/.test(version)) fail("manifest.version", `"${version}" must not start with "v"`);
    else if (!/^\d+\.\d+\.\d+$/.test(version)) fail("manifest.version", `"${version}" is not bare semver (x.y.z)`);
    else pass("manifest.version", version);
  }

  if (!manifest.authorUrl) warn("manifest.authorUrl", "missing; the directory shows it on the listing");
  if (manifest.fundingUrl !== undefined) {
    const urls = typeof manifest.fundingUrl === "string" ? [manifest.fundingUrl] : Object.values(manifest.fundingUrl ?? {});
    if (!urls.every((u) => /^https:\/\//.test(String(u)))) fail("manifest.fundingUrl", "every funding url must be https");
  }
}

// --- versions ---------------------------------------------------------------

const pkgRead = readJson("package.json");
if (pkgRead.missing) fail("package.json", "missing");
else if (pkgRead.error) fail("package.json", `does not parse: ${pkgRead.error}`);
else {
  const pkg = pkgRead.data;
  if (manifest?.version && pkg.version !== manifest.version) fail("package.json version", `${pkg.version} differs from manifest ${manifest.version}`);
  else if (manifest?.version) pass("package.json version", pkg.version);
  if (!pkg.scripts?.build) warn("package.json scripts.build", "missing; the release workflow runs npm run build");
}

// The workflows run `npm ci` with the npm cache, and both abort without a committed lockfile; better to learn that here than after the tag is pushed.
{
  const lock = ["package-lock.json", "npm-shrinkwrap.json"].find((n) => existsSync(join(root, n)));
  const inGit = git("rev-parse", "--is-inside-work-tree") === "true";
  if (!lock) fail("package-lock.json", "missing; the release and CI workflows run npm ci, which needs it (run npm install and commit the lockfile)");
  else if (inGit && !git("ls-files", "--error-unmatch", lock)) fail(lock, "exists but is not committed (gitignored or untracked); the workflows check out the repo, so commit it and remove it from .gitignore");
  else pass(lock, inGit ? "committed" : "present");
}

// `npm version` is wired up by the version script; without tag-version-prefix= it tags v1.2.3, which the release workflow ignores.
if (pkgRead.data?.scripts?.version) {
  const npmrc = join(root, ".npmrc");
  const has = existsSync(npmrc) && readFileSync(npmrc, "utf8").split("\n").some((l) => l.trim() === "tag-version-prefix=");
  if (has) pass(".npmrc", "tag-version-prefix= set");
  else warn(".npmrc", "no tag-version-prefix= line; npm version would tag v1.2.3, which the release workflow ignores (kit-adopt adds the line)");
}

const versionsRead = readJson("versions.json");
if (versionsRead.missing) fail("versions.json", "missing; it maps each released version to its minAppVersion");
else if (versionsRead.error) fail("versions.json", `does not parse: ${versionsRead.error}`);
else if (!versionsRead.data || typeof versionsRead.data !== "object" || Array.isArray(versionsRead.data)) fail("versions.json", "must be an object of version → minAppVersion");
else if (manifest?.version) {
  const entry = versionsRead.data[manifest.version];
  if (entry === undefined) fail("versions.json", `has no entry for ${manifest.version}; run the version bump`);
  else if (entry !== manifest.minAppVersion) warn("versions.json", `${manifest.version} maps to ${entry}, manifest minAppVersion is ${manifest.minAppVersion}`);
  else pass("versions.json", `${manifest.version} → ${entry}`);
}

// --- root files -------------------------------------------------------------

if (!existsSync(join(root, "README.md"))) fail("README.md", "missing");
else {
  const readme = readFileSync(join(root, "README.md"), "utf8");
  pass("README.md", "present");
  if (!/^#{1,3} /m.test(readme)) warn("README.md", "has no headings; the review expects purpose, install, use and support");
  if (manifest?.isDesktopOnly === true && !/desktop/i.test(readme)) warn("README.md", "isDesktopOnly is true but the README does not say why");
}
// LICENSE, LICENCE, with or without .md or .txt, any case: all forms GitHub recognises.
const licenseFile = readdirSync(root).find((n) => /^licen[cs]e(\.(md|txt))?$/i.test(n));
if (!licenseFile) fail("LICENSE", "missing");
else pass("LICENSE", licenseFile);
if (!existsSync(join(root, "SECURITY.md"))) warn("SECURITY.md", "missing; a private reporting route is expected");

// --- source -----------------------------------------------------------------

// When the repo lints with the Obsidian team's own rules, those cover command ids, global app, hotkeys and more properly; the regex checks below are the fallback for repos without them.
const pkgDeps = { ...(pkgRead.data?.devDependencies ?? {}), ...(pkgRead.data?.dependencies ?? {}) };
const eslintConfig = readdirSync(root).find((n) => /^eslint\.config\.(mjs|cjs|js|ts|mts|cts)$/.test(n));
const officialLint = Boolean(eslintConfig && pkgDeps["eslint-plugin-obsidianmd"]);

const files = sourceFiles();
if (officialLint) pass("source", `linted by eslint-plugin-obsidianmd (${eslintConfig}); CI runs it, regex checks skipped`);
else if (files.length === 0) warn("source", "no src/ or main.ts found; source checks skipped");
else {
  warn("source: eslint-plugin-obsidianmd", `not set up (${eslintConfig ? "config present, package missing" : "no eslint.config.*"}); the Obsidian team's own rules catch more than these regex checks: npm i -D eslint eslint-plugin-obsidianmd`);
  const hotkeys = [], idPrefix = [], configDir = [], globalApp = [];
  // The id is interpolated into a regex; an id the id check already rejected may hold metacharacters, so escape it.
  const idPattern = manifest?.id ? new RegExp(`\\bid\\s*:\\s*["'\`]${String(manifest.id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-`) : null;
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    const rel = relative(root, f);
    if (/hotkeys\s*:\s*\[\s*\{/.test(text)) hotkeys.push(rel);
    if (idPattern && idPattern.test(text)) idPrefix.push(rel);
    if (/["'`]\.obsidian(\/|["'`])/.test(text)) configDir.push(rel);
    // Bare `app.` with nothing before it, or `window.app.` / `globalThis.app.`; `this.app.` and `plugin.app.` are fine.
    if (/(?<![\w$.])app\.(vault|workspace|metadataCache|fileManager|plugins)\b|\b(?:window|globalThis)\.app\.(vault|workspace|metadataCache|fileManager|plugins)\b/.test(text)) globalApp.push(rel);
  }
  if (hotkeys.length) fail("source: default hotkeys", `remove default hotkeys from addCommand in ${hotkeys.join(", ")}`);
  else pass("source: default hotkeys", "none");
  if (idPrefix.length) warn("source: command ids", `command ids repeat the plugin id in ${idPrefix.join(", ")}; Obsidian prefixes it for you`);
  if (configDir.length) warn("source: .obsidian", `hard-coded ".obsidian" in ${configDir.join(", ")}; use this.app.vault.configDir`);
  if (globalApp.length) warn("source: global app", `global app.* reference in ${globalApp.join(", ")}; use this.app`);
}

// --- git ----------------------------------------------------------------------

if (git("rev-parse", "--is-inside-work-tree") === "true") {
  const tracked = git("ls-files", "--error-unmatch", "main.js");
  if (tracked) warn("git: main.js", "is committed; it is a release asset, not source (add it to .gitignore)");
  else pass("git: main.js", "not tracked");
  const slug = githubSlug();
  if (!slug) warn("git: origin", "is not a GitHub repo; the directory entry needs one");
  else pass("git: origin", slug);
}

// --- tag and release --------------------------------------------------------

const tag = value("--tag");
if (tag !== undefined && manifest?.version) {
  const bare = tag.replace(/^refs\/tags\//, "");
  if (/^v/.test(bare)) fail("tag", `"${bare}" starts with "v"; tags carry the bare version`);
  else if (bare !== manifest.version) fail("tag", `"${bare}" differs from manifest version ${manifest.version}`);
  else pass("tag", bare);
}

if (flag("--release")) {
  for (const asset of ["main.js", "manifest.json"]) {
    if (!existsSync(join(root, asset))) fail(`release asset ${asset}`, "missing after build");
    else pass(`release asset ${asset}`, "present");
  }
  pass("release asset styles.css", existsSync(join(root, "styles.css")) ? "present, will be attached" : "absent, not attached");
}

// --- directory ------------------------------------------------------------

async function checkDirectory() {
  if (flag("--offline") || !manifest?.id) return;
  let list;
  try {
    const res = await fetch(DIRECTORY_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    list = await res.json();
  } catch (e) {
    warn("directory", `could not fetch community-plugins.json (${e.message}); rerun online or pass --offline`);
    return;
  }
  const slug = githubSlug();
  const byId = list.find((p) => p.id === manifest.id);
  if (byId && slug && byId.repo.toLowerCase() === slug.toLowerCase()) pass("directory: id", `${manifest.id} is already listed for ${slug}`);
  else if (byId) fail("directory: id", `"${manifest.id}" is taken by ${byId.repo}; choose another id`);
  else pass("directory: id", `${manifest.id} is free`);
  const byName = list.find((p) => p.name.toLowerCase() === String(manifest.name).toLowerCase() && p.id !== manifest.id);
  if (byName) warn("directory: name", `"${manifest.name}" is already used by ${byName.repo} (${byName.id})`);
}

await checkDirectory();

// --- report -----------------------------------------------------------------

const failures = results.filter((r) => r.level === "FAIL");
const warnings = results.filter((r) => r.level === "WARN");
const ok = failures.length === 0 && (!flag("--strict") || warnings.length === 0);

if (flag("--json")) {
  console.log(JSON.stringify({ ok, root, results }, null, 2));
} else {
  for (const r of results) console.log(`${r.level.padEnd(4)}  ${r.check}${r.note ? `  — ${r.note}` : ""}`);
  console.log("");
  console.log(`${failures.length} failed, ${warnings.length} warnings, ${results.length - failures.length - warnings.length} passed${flag("--strict") ? " (strict)" : ""}`);
}
process.exit(ok ? 0 : 1);
