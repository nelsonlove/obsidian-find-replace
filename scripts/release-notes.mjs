#!/usr/bin/env node
// release-notes.mjs — prints the CHANGELOG.md section for one version, for the release workflow's notes.
// Usage: node scripts/release-notes.mjs <version> [--file CHANGELOG.md]
//   Matches "## 1.2.3", "## [1.2.3]", with or without a date after it. Placeholder bullets (a line that is only "-" or "*") are dropped.
//   Prints nothing and exits 0 when the file or the section is missing or empty; the workflow then lets GitHub generate the notes.
import { existsSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const fileIdx = args.indexOf("--file");
const file = fileIdx !== -1 ? args[fileIdx + 1] : "CHANGELOG.md";
// The version is the positional that is not the --file value, whichever order they come in. (-1 when there is no --file: fileIdx + 1 would be 0, the first positional.)
const fileValueIdx = fileIdx === -1 ? -1 : fileIdx + 1;
const version = args.find((a, i) => !a.startsWith("--") && i !== fileValueIdx);
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
