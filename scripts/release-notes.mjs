#!/usr/bin/env node
// release-notes.mjs — prints the CHANGELOG.md section for one version, for the release workflow's notes.
// Usage: node scripts/release-notes.mjs <version> [--file CHANGELOG.md]
//   Matches "## 1.2.3", "## [1.2.3]", with or without a date after it. Placeholder bullets (a line that is only "-" or "*") are dropped.
//   Prints nothing and exits 0 when the file or the section is missing or empty; the workflow then lets GitHub generate the notes.
import { existsSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const version = args.find((a) => !a.startsWith("--"));
const fileIdx = args.indexOf("--file");
const file = fileIdx !== -1 ? args[fileIdx + 1] : "CHANGELOG.md";
if (!version) {
  console.error("usage: release-notes <version> [--file CHANGELOG.md]");
  process.exit(2);
}
if (!existsSync(file)) process.exit(0);

const lines = readFileSync(file, "utf8").split("\n");
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const heading = new RegExp(`^## \\[?${escaped}\\]?(\\s|$)`);
const start = lines.findIndex((l) => heading.test(l));
if (start === -1) process.exit(0);
let end = lines.length;
for (let i = start + 1; i < lines.length; i++) {
  if (/^## /.test(lines[i])) {
    end = i;
    break;
  }
}
const body = lines
  .slice(start + 1, end)
  .filter((l) => !/^[ \t]*[-*][ \t]*$/.test(l))
  .join("\n")
  .trim();
if (body) process.stdout.write(body + "\n");
