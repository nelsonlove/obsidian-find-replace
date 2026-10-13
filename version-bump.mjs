// Runs from `npm version <bump>`: copies the new package.json version into manifest.json, records it in versions.json against the current minAppVersion, turns the CHANGELOG's "## Unreleased" section into this version's section so the release notes find it, and stages exactly the files it wrote. Standard Obsidian sample-plugin behaviour plus the changelog, keeping each file's own indentation.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const targetVersion = process.env.npm_package_version;
if (!targetVersion) {
  console.error("version-bump: npm_package_version is not set; run this through `npm version`.");
  process.exit(1);
}

const written = [];

function rewrite(path, change) {
  const raw = readFileSync(path, "utf8");
  const data = JSON.parse(raw);
  change(data);
  const indent = raw.match(/^[ \t]+/m)?.[0] ?? "\t";
  writeFileSync(path, JSON.stringify(data, null, indent) + "\n");
  written.push(path);
  return data;
}

const manifest = rewrite("manifest.json", (m) => (m.version = targetVersion));
rewrite("versions.json", (v) => (v[targetVersion] = manifest.minAppVersion));

// Local calendar date, not toISOString(): that is the UTC date, a day ahead in the evening west of Greenwich.
const today = new Intl.DateTimeFormat("sv-SE", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

// Same rules as obsidian-release-kit's rollChangelog (bin/lib.mjs; a kit test checks the two agree): the Unreleased body moves under the version heading, placeholder bullets (a line that is only "-" or "*") are dropped, and a fresh Unreleased placeholder is left above.
if (existsSync("CHANGELOG.md")) {
  const lines = readFileSync("CHANGELOG.md", "utf8").split("\n");
  const start = lines.findIndex((l) => /^## \[?Unreleased\]?[ \t]*$/i.test(l));
  if (start !== -1) {
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^## /.test(lines[i])) {
        end = i;
        break;
      }
    }
    const body = lines.slice(start + 1, end).filter((l) => !/^[ \t]*[-*][ \t]*$/.test(l));
    while (body.length && body[0].trim() === "") body.shift();
    while (body.length && body[body.length - 1].trim() === "") body.pop();
    const section = [`## ${targetVersion} — ${today}`, "", ...(body.length ? [...body, ""] : [])];
    writeFileSync("CHANGELOG.md", [...lines.slice(0, start), lines[start].trim(), "", "-", "", ...section, ...lines.slice(end)].join("\n"));
    written.push("CHANGELOG.md");
  } else {
    console.error("version-bump: CHANGELOG.md has no '## Unreleased' section; nothing rolled into the release notes");
  }
}

// Stage only what was written, so an absent or gitignored CHANGELOG cannot abort the bump. Outside a git work tree there is nothing to stage; inside one, a failing `git add` must fail the bump, or npm would commit and tag a half-done release.
let inGit = false;
try {
  execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { stdio: "ignore" });
  inGit = true;
} catch {
  // not a git work tree
}
if (inGit) {
  const stageable = written.filter((f) => {
    try {
      execFileSync("git", ["check-ignore", "-q", f], { stdio: "ignore" });
      console.error(`version-bump: ${f} is gitignored; updated on disk, not staged`);
      return false;
    } catch {
      return true;
    }
  });
  if (stageable.length) {
    try {
      execFileSync("git", ["add", ...stageable], { stdio: "inherit" });
    } catch (e) {
      console.error(`version-bump: git add failed (${e.message}); the bump is not staged, stopping before npm commits a half-done release`);
      process.exit(1);
    }
  }
}
