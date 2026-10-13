# Changelog

All notable changes to Find & Replace are listed here. The release workflow copies a version's section into the GitHub release notes.

## Unreleased

- `minAppVersion` is now 1.7.2: the panel uses `Workspace.revealLeaf`, which became asynchronous in that release and is awaited.
- The large-replacement confirmation is an in-app modal instead of `window.confirm`.
- Command names no longer repeat the plugin name ("Open panel", "Search the current file's folder") and UI text uses sentence case.
- Release and CI workflows, preflight, the Obsidian team's ESLint rules, SECURITY and PRIVACY notes, and a committed lockfile (obsidian-release-kit).

## 0.1.0 — 2026-07-23

- Multi-file find and replace across the vault, a folder, the current file or a selection, with a preview-and-confirm panel; text or regex, case and whole-word options.
