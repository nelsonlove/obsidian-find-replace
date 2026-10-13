// Runs from `npm version <bump>`: copies the new package.json version into manifest.json, records it in versions.json against the current minAppVersion, and turns the CHANGELOG's "## Unreleased" section into this version's section so the release notes find it. Standard Obsidian sample-plugin behaviour plus the changelog, keeping each file's own indentation. The `version` npm script stages the three files.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const targetVersion = process.env.npm_package_version;
if (!targetVersion) {
  console.error("version-bump: npm_package_version is not set; run this through `npm version`.");
  process.exit(1);
}

function rewrite(path, change) {
  const raw = readFileSync(path, "utf8");
  const data = JSON.parse(raw);
  change(data);
  const indent = raw.match(/^[ \t]+/m)?.[0] ?? "\t";
  writeFileSync(path, JSON.stringify(data, null, indent) + "\n");
  return data;
}

const manifest = rewrite("manifest.json", (m) => (m.version = targetVersion));
rewrite("versions.json", (v) => (v[targetVersion] = manifest.minAppVersion));

// Local calendar date, not toISOString(): that is the UTC date, a day ahead in the evening west of Greenwich.
const today = new Intl.DateTimeFormat("sv-SE", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

// Same rules as obsidian-release-kit's rollChangelog: the Unreleased body moves under the version heading, placeholder bullets (a line that is only "-" or "*") are dropped, and a fresh Unreleased placeholder is left above.
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
    writeFileSync("CHANGELOG.md", [...lines.slice(0, start), lines[start].trim(), "", "- ", "", ...section, ...lines.slice(end)].join("\n"));
  } else {
    console.error("version-bump: CHANGELOG.md has no '## Unreleased' section; nothing rolled into the release notes");
  }
}
