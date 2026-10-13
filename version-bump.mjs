// Runs from `npm version <bump>`: copies the new package.json version into manifest.json and records it in versions.json against the current minAppVersion. Standard Obsidian sample-plugin behaviour, keeping each file's own indentation.
import { readFileSync, writeFileSync } from "node:fs";

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
