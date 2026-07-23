# Find & Replace — design

Multi-file find & replace for Obsidian with a **preview-and-confirm** panel.
Fills the gap that core Search (read-only) and omnisearch leave.

## Scope of a run

Chosen in the panel:

- **Vault** — every markdown file.
- **Folder…** — a picked folder, recursive.
- **Current file** — the active note.
- **Selection** — only the selected range in the active editor.

## Matching

- **Text** mode — literal query (regex-escaped).
- **Regex** mode — full JS regex; replacement supports `$1`, `$2`, `$&`, `$$`.
- **Case-insensitive** toggle → `i` flag.
- **Whole-word** toggle → pattern wrapped in word boundaries (`\b(?:…)\b`).
- Operates on the file's **raw markdown text** — frontmatter and code blocks
  included (a normal find-and-replace). Skipping those is a possible v2 toggle.

## Safety model — preview then confirm

Nothing is written until the user clicks **Apply**.

1. **Search** collects all matches across the scope and renders a results tree
   grouped by file: each match shows line number + a `before → after` preview,
   with a checkbox per match and per file (all checked by default).
2. The user can uncheck any match or whole file.
3. **Apply** writes only the checked matches.

Additional guards:
- Writes go through Obsidian's **`vault.process(file, fn)`** — atomic and
  Obsidian-Sync-safe (Nelson's vault uses Sync). Reads via `cachedRead`.
- **Multi-file edits are not covered by editor undo.** The confirm step is the
  safety net; beyond that, recovery is the vault backup / git. The Apply button
  shows the match count, and a large batch (> a threshold) asks for a second
  confirm noting it can't be undone in one step.
- A sensible result cap with a warning if a search matches an enormous number of
  files/hits (avoid locking the UI). Search runs async with a progress Notice.

## Architecture

- `src/replace.ts` — **pure, Obsidian-free** core, fully unit-tested:
  - `buildMatcher(opts): { regex } | { error }` — compile text/regex + flags +
    whole-word; report invalid regex instead of throwing.
  - `findMatches(text, regex): Match[]` — all matches with `{ start, end,
    matched, line, col, lineText, groups }`; zero-length-match safe.
  - `expandReplacement(match, replacement): string` — capture-group substitution.
  - `applyReplacements(text, matches, replacement): string` — splice chosen
    matches (right-to-left so offsets stay valid).
- `src/main.ts` — thin glue: the panel `ItemView`, scope → file list, run the
  matcher over files async, render results with checkboxes, Apply via
  `vault.process`; open the panel via a command + ribbon icon.

### Commands
- `find-replace:open` — open/reveal the Find & Replace panel (ribbon icon too).
- `find-replace:open-folder` — open the panel pre-scoped to the folder of the
  active file (convenience).

## Non-goals (YAGNI)
- Skipping code blocks / frontmatter (v2 toggle).
- Cross-file undo (rely on preview + backup/git).
- Search history / saved patterns.
- Replacing in file *names* or tags-as-metadata (this is body-text replace).
