import { describe, expect, test } from "vitest";
import {
  applyReplacements,
  buildMatcher,
  expandReplacement,
  findMatches,
  pathInFolder,
} from "./replace";

function mustRegex(opts: Parameters<typeof buildMatcher>[0]): RegExp {
  const r = buildMatcher(opts);
  if ("error" in r) throw new Error(`unexpected build error: ${r.error}`);
  return r.regex;
}

describe("buildMatcher", () => {
  test("text mode treats the query literally (escapes regex metachars)", () => {
    const re = mustRegex({ query: "a.b", mode: "text" });
    expect("axb".match(re)).toBeNull();
    expect("a.b".match(re)).not.toBeNull();
  });

  test("regex mode interprets the query as a pattern", () => {
    const re = mustRegex({ query: "a.b", mode: "regex" });
    expect("axb".match(re)).not.toBeNull();
  });

  test("always sets the global flag", () => {
    expect(mustRegex({ query: "x", mode: "text" }).global).toBe(true);
  });

  test("case-insensitive toggle", () => {
    expect("ABC".match(mustRegex({ query: "abc", mode: "text" }))).toBeNull();
    expect(
      "ABC".match(
        mustRegex({ query: "abc", mode: "text", caseInsensitive: true }),
      ),
    ).not.toBeNull();
  });

  test("whole-word toggle matches only whole words", () => {
    const re = mustRegex({ query: "cat", mode: "text", wholeWord: true });
    expect(findMatches("a cat sat", re).length).toBe(1);
    expect(findMatches("category cats", re).length).toBe(0);
  });

  test("invalid regex reports an error instead of throwing", () => {
    const r = buildMatcher({ query: "a(b", mode: "regex" });
    expect("error" in r).toBe(true);
  });

  test("empty query reports an error", () => {
    const r = buildMatcher({ query: "", mode: "text" });
    expect("error" in r).toBe(true);
  });
});

describe("findMatches", () => {
  test("returns each match with offset, line, and column", () => {
    const re = mustRegex({ query: "foo", mode: "text" });
    const m = findMatches("foo\nbar foo", re);
    expect(m).toHaveLength(2);
    expect(m[0]).toMatchObject({ start: 0, line: 0, col: 0, matched: "foo" });
    expect(m[1]).toMatchObject({ line: 1, col: 4, matched: "foo" });
  });

  test("captures the full line text of each match", () => {
    const re = mustRegex({ query: "foo", mode: "text" });
    const m = findMatches("alpha\nbar foo baz", re);
    expect(m[0].lineText).toBe("bar foo baz");
  });

  test("captures regex groups (groups[0] is the whole match)", () => {
    const re = mustRegex({ query: "(\\d+)", mode: "regex" });
    const m = findMatches("a12 b345", re);
    expect(m.map((x) => x.groups[1])).toEqual(["12", "345"]);
    expect(m[0].groups[0]).toBe("12");
  });

  test("skips zero-length matches and terminates", () => {
    const re = mustRegex({ query: "x*", mode: "regex" });
    const m = findMatches("abc", re);
    expect(m).toEqual([]);
  });

  test("is reusable — does not depend on the regex's lastIndex", () => {
    const re = mustRegex({ query: "a", mode: "text" });
    expect(findMatches("aaa", re)).toHaveLength(3);
    expect(findMatches("aaa", re)).toHaveLength(3);
  });
});

describe("expandReplacement", () => {
  const re = mustRegex({ query: "(\\w+)@(\\w+)", mode: "regex" });
  const match = findMatches("ping bob@acme done", re)[0];

  test("substitutes numbered capture groups", () => {
    expect(expandReplacement(match, "$2/$1")).toBe("acme/bob");
  });

  test("$& is the whole match, $$ is a literal dollar", () => {
    expect(expandReplacement(match, "<$&>")).toBe("<bob@acme>");
    expect(expandReplacement(match, "$$1")).toBe("$1");
  });

  test("plain replacement with no tokens is returned as-is", () => {
    expect(expandReplacement(match, "REDACTED")).toBe("REDACTED");
  });

  test("a non-participating optional group substitutes empty, not literal $N", () => {
    const re = mustRegex({ query: "(foo)?bar", mode: "regex" });
    const m = findMatches("bar", re)[0];
    expect(expandReplacement(m, "<$1>")).toBe("<>");
  });

  test("out-of-range two-digit token falls back to $1 then the extra digit", () => {
    const re = mustRegex({ query: "(a)", mode: "regex" });
    const m = findMatches("a", re)[0]; // one group
    expect(expandReplacement(m, "$15")).toBe("a5");
  });

  test("a token with no such group is left literal", () => {
    const re = mustRegex({ query: "(a)", mode: "regex" });
    const m = findMatches("a", re)[0];
    expect(expandReplacement(m, "$3")).toBe("$3");
  });
});

describe("pathInFolder", () => {
  test("empty folder means the vault root — root-level files only", () => {
    expect(pathInFolder("note.md", "")).toBe(true);
    expect(pathInFolder("sub/note.md", "")).toBe(false);
  });

  test("a named folder matches its files recursively", () => {
    expect(pathInFolder("sub/note.md", "sub")).toBe(true);
    expect(pathInFolder("sub/deep/note.md", "sub")).toBe(true);
    expect(pathInFolder("note.md", "sub")).toBe(false);
  });

  test("does not match a sibling folder with a shared prefix", () => {
    expect(pathInFolder("subtwo/note.md", "sub")).toBe(false);
  });

  test("normalizes leading/trailing slashes", () => {
    expect(pathInFolder("sub/note.md", "/sub/")).toBe(true);
    expect(pathInFolder("root.md", "/")).toBe(true);
  });
});

describe("applyReplacements", () => {
  test("replaces the selected matches and leaves the rest", () => {
    const re = mustRegex({ query: "foo", mode: "text" });
    const text = "foo foo foo";
    const all = findMatches(text, re);
    expect(applyReplacements(text, all, "bar")).toBe("bar bar bar");
    // only first and third
    expect(applyReplacements(text, [all[0], all[2]], "bar")).toBe(
      "bar foo bar",
    );
  });

  test("applies capture-group replacements across matches", () => {
    const re = mustRegex({ query: "(\\d+)", mode: "regex" });
    const text = "a1 b22 c333";
    const all = findMatches(text, re);
    expect(applyReplacements(text, all, "[$1]")).toBe("a[1] b[22] c[333]");
  });

  test("handles replacements longer and shorter than the match", () => {
    const re = mustRegex({ query: "x", mode: "text" });
    const text = "x-x-x";
    const all = findMatches(text, re);
    expect(applyReplacements(text, all, "YY")).toBe("YY-YY-YY");
    const re2 = mustRegex({ query: "long", mode: "text" });
    expect(applyReplacements("long long", findMatches("long long", re2), "s")).toBe(
      "s s",
    );
  });

  test("an empty selection returns the text unchanged", () => {
    expect(applyReplacements("hello", [], "x")).toBe("hello");
  });
});
