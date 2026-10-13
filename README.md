# Find & Replace

Multi-file find & replace for Obsidian, with a **preview-and-confirm** panel. Fills the gap core Search (read-only) leaves — nothing is written until you review the matches and click **Apply**.

Needs Obsidian 1.7.2 or newer.

## Use

Open the panel from the ribbon (**Find & Replace** icon) or the command **"Find & Replace: Open panel"**. There is also **"Find & Replace: Search the current file's folder"**, which opens the panel scoped to the folder of the active file. Then:

1. Type a **Find** and **Replace with** value.
2. Pick **Text** or **Regex**, and optionally case / whole-word.
3. Choose a **scope**: whole vault, a folder, the current file, or the current selection.
4. **Search** → review the matches grouped by file (each shows line + `before → after`). Uncheck any match or whole file you don't want.
5. **Apply** — only the checked matches are written.

- **Regex** mode supports capture-group replacement: `$1`, `$2`, `$&`, `$$`.
- **Whole word** wraps the pattern in word boundaries.

## Safety

- **Preview first** — nothing changes until you click Apply.
- Writes go through Obsidian's atomic `vault.process`, which is Obsidian-Sync safe. A file that changed between Search and Apply is skipped (with a notice) rather than clobbered with stale offsets.
- **Multi-file edits are not covered by editor undo.** The preview is the safety net; beyond that, recovery is your vault backup / git. A large batch asks for a second confirmation.
- Searches are capped (first 2000 matches) to keep the panel responsive — narrow the scope to see all.

## Privacy

No settings, nothing stored, no network. See `PRIVACY.md`; report security problems as `SECURITY.md` says.

## Development

```bash
npm install
npm test        # vitest — the matching/replace core is a pure, tested module
npm run lint    # the Obsidian team's eslint-plugin-obsidianmd rules
npm run build   # typecheck + production bundle -> main.js
npm run dev     # esbuild watch
```

The matching/replace logic lives in `src/replace.ts` (no Obsidian imports, unit tested in `src/replace.test.ts`); `src/main.ts` is the panel view and file plumbing. See `docs/design.md`. Releases follow [obsidian-release-kit](https://github.com/nelsonlove/obsidian-release-kit): `npm run preflight`, then a bare-version tag publishes the release.

## License

MIT
