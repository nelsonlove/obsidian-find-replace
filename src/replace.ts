/**
 * Pure find & replace core for the Find & Replace plugin.
 *
 * No Obsidian imports — unit-tested in isolation. `src/main.ts` reads files,
 * calls these functions, renders the preview, and writes results via
 * `vault.process`.
 */

export type MatchMode = "text" | "regex";

export interface MatcherOptions {
  query: string;
  mode: MatchMode;
  caseInsensitive?: boolean;
  wholeWord?: boolean;
}

export type BuildResult = { regex: RegExp } | { error: string };

export interface Match {
  /** Character offset of the match start in the source text. */
  start: number;
  /** Character offset just past the match end. */
  end: number;
  /** The matched substring. */
  matched: string;
  /** 0-indexed line of the match start. */
  line: number;
  /** 0-indexed column of the match start within its line. */
  col: number;
  /** Full text of the line containing the match start. */
  lineText: string;
  /** Exec groups: groups[0] is the whole match, groups[1..] the captures. */
  groups: (string | undefined)[];
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildMatcher(opts: MatcherOptions): BuildResult {
  if (opts.query === "") return { error: "Enter something to find." };

  let source = opts.mode === "text" ? escapeRegExp(opts.query) : opts.query;
  if (opts.wholeWord) source = `\\b(?:${source})\\b`;

  const flags = "g" + (opts.caseInsensitive ? "i" : "");
  try {
    return { regex: new RegExp(source, flags) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export function findMatches(text: string, regex: RegExp): Match[] {
  // Clone with a guaranteed global flag and a fresh lastIndex so results never
  // depend on the passed regex's mutable state.
  const flags = regex.flags.includes("g") ? regex.flags : regex.flags + "g";
  const re = new RegExp(regex.source, flags);

  const matches: Match[] = [];
  // Track line/lineStart incrementally: `scanned` only moves forward across the
  // whole text, so line counting is O(n) total rather than O(n·matches).
  let line = 0;
  let lineStart = 0;
  let scanned = 0;

  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      // Zero-length match: not useful for replace, and would loop forever.
      re.lastIndex++;
      continue;
    }
    const start = m.index;
    for (; scanned < start; scanned++) {
      if (text.charCodeAt(scanned) === 10) {
        line++;
        lineStart = scanned + 1;
      }
    }
    let lineEnd = text.indexOf("\n", start);
    if (lineEnd === -1) lineEnd = text.length;
    matches.push({
      start,
      end: start + m[0].length,
      matched: m[0],
      line,
      col: start - lineStart,
      lineText: text.slice(lineStart, lineEnd),
      groups: Array.from(m),
    });
  }
  return matches;
}

/**
 * Whether a vault-relative markdown path belongs to `folder`. An empty folder
 * (or "/") means the vault root — root-level files only, never the whole vault.
 * A named folder matches its files recursively.
 */
export function pathInFolder(path: string, folder: string): boolean {
  const norm = folder.replace(/^\/+/, "").replace(/\/+$/, "");
  if (norm === "") return !path.includes("/");
  return path.startsWith(norm + "/");
}

const TOKEN_RE = /\$(\$|&|\d{1,2})/g;

export function expandReplacement(match: Match, replacement: string): string {
  return replacement.replace(TOKEN_RE, (token, p1: string) => {
    if (p1 === "$") return "$";
    if (p1 === "&") return match.groups[0] ?? "";
    const n = Number(p1);
    // In-range group: substitute its value (empty for a non-participating
    // optional group), matching standard find/replace semantics.
    if (n >= 1 && n < match.groups.length) return match.groups[n] ?? "";
    // Out-of-range two-digit token: fall back to the single-digit group plus the
    // trailing digit as a literal (e.g. "$15" -> group 1 + "5"), like JS.
    if (p1.length === 2) {
      const first = Number(p1[0]);
      if (first >= 1 && first < match.groups.length) {
        return (match.groups[first] ?? "") + p1[1];
      }
    }
    return token; // no such group — leave the token literal
  });
}

export function applyReplacements(
  text: string,
  matches: Match[],
  replacement: string,
): string {
  const ordered = [...matches].sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  for (const m of ordered) {
    if (m.start < cursor) continue; // skip overlaps against already-written text
    out += text.slice(cursor, m.start) + expandReplacement(m, replacement);
    cursor = m.end;
  }
  return out + text.slice(cursor);
}
