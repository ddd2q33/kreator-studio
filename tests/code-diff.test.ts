import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  diffChangedCount,
  diffLines,
  diffWords,
  mergeWordSpans,
} from "../lib/code-diff.ts";

describe("diffLines", () => {
  it("marks identical text as all-same with matching line numbers", () => {
    const rows = diffLines("a\nb\nc", "a\nb\nc");
    assert.deepEqual(
      rows.map((r) => [r.kind, r.before, r.after]),
      [
        ["same", 1, 1],
        ["same", 2, 2],
        ["same", 3, 3],
      ],
    );
    assert.deepEqual(rows.map((r) => r.text), ["a", "b", "c"]);
  });

  it("shows a replacement as a removal followed by its addition", () => {
    const rows = diffLines("a\nold\nc", "a\nnew\nc");
    const changed = rows.filter((r) => r.kind !== "same");
    assert.deepEqual(
      changed.map((r) => [r.kind, r.text, r.before, r.after]),
      [
        ["del", "old", 2, 0],
        ["add", "new", 0, 2],
      ],
    );
  });

  it("numbers an inserted line against the new file only", () => {
    const rows = diffLines("a\nc", "a\nb\nc");
    const added = rows.filter((r) => r.kind === "add");
    assert.deepEqual(
      added.map((r) => [r.text, r.before, r.after]),
      [["b", 0, 2]],
    );
  });

  it("numbers a deleted line against the old file only", () => {
    const rows = diffLines("a\nb\nc", "a\nc");
    const removed = rows.filter((r) => r.kind === "del");
    assert.deepEqual(
      removed.map((r) => [r.text, r.before, r.after]),
      [["b", 2, 0]],
    );
  });

  it("carries trailing additions after the last common line", () => {
    const rows = diffLines("a", "a\nb\nc");
    assert.deepEqual(
      rows.filter((r) => r.kind === "add").map((r) => [r.text, r.after]),
      [
        ["b", 2],
        ["c", 3],
      ],
    );
  });

  it("carries trailing deletions after the last common line", () => {
    const rows = diffLines("a\nb\nc", "a");
    assert.deepEqual(
      rows.filter((r) => r.kind === "del").map((r) => [r.text, r.before]),
      [
        ["b", 2],
        ["c", 3],
      ],
    );
  });

  it("diffs against nothing when the base is empty", () => {
    const rows = diffLines("", "a\nb");
    assert.deepEqual(
      rows.map((r) => [r.kind, r.text, r.before, r.after]),
      [
        ["add", "a", 0, 1],
        ["add", "b", 0, 2],
      ],
    );
  });

  it("reduces to deletions when the new text is empty", () => {
    const rows = diffLines("a\nb", "");
    assert.ok(rows.every((r) => r.kind === "del"));
    assert.equal(rows.length, 2);
  });

  it("keeps a whole changed block in file order", () => {
    // A rewrite of the middle three lines comes out as the three deletions
    // and then the three additions, not interleaved per line — the order a
    // code review shows and a viewer expects to read.
    const before = "keep\nold1\nold2\nold3\nkeep";
    const after = "keep\nnew1\nnew2\nnew3\nkeep";
    const rows = diffLines(before, after);
    assert.deepEqual(
      rows.map((r) => r.kind),
      ["same", "del", "del", "del", "add", "add", "add", "same"],
    );
  });

  it("is deterministic: the same pair always yields the same rows", () => {
    const before = "function f() {\n  return 1;\n}\n";
    const after = "function f() {\n  return 2;\n}\n";
    const first = diffLines(before, after);
    for (let i = 0; i < 5; i++) assert.deepEqual(diffLines(before, after), first);
  });
});

describe("diffChangedCount", () => {
  it("counts the rows that are not kept", () => {
    const rows = diffLines("a\nold\nc", "a\nnew\nc");
    assert.equal(diffChangedCount(rows), 2);
  });

  it("is zero for identical text", () => {
    assert.equal(diffChangedCount(diffLines("same\ntext", "same\ntext")), 0);
  });
});

describe("diffWords", () => {
  it("finds no spans in identical lines", () => {
    assert.deepEqual(diffWords("const x = 1;", "const x = 1;"), {
      removed: [],
      added: [],
    });
  });

  it("marks only the changed literal", () => {
    const words = diffWords("const x = 1;", "const x = 2;");
    assert.deepEqual(words.removed, [{ start: 10, end: 11 }]);
    assert.deepEqual(words.added, [{ start: 10, end: 11 }]);
  });

  it("spans an inserted argument including its separator", () => {
    const words = diffWords("return cache.get(key);", "return cache.get(key, null);");
    assert.deepEqual(words.removed, []);
    assert.deepEqual(words.added, [{ start: 20, end: 26 }]);
  });

  it("grows a renamed identifier in place", () => {
    const words = diffWords("getUser(id)", "getUser(userId)");
    assert.deepEqual(words.removed, [{ start: 8, end: 10 }]);
    assert.deepEqual(words.added, [{ start: 8, end: 14 }]);
  });

  it("reports the whole line when one side is empty", () => {
    assert.deepEqual(diffWords("", "abc"), {
      removed: [],
      added: [{ start: 0, end: 3 }],
    });
    assert.deepEqual(diffWords("abc", ""), {
      removed: [{ start: 0, end: 3 }],
      added: [],
    });
  });

  it("is deterministic: the same pair always yields the same spans", () => {
    const before = "    return cache.get(key);";
    const after = "    return cache.get(userKey);";
    const first = diffWords(before, after);
    for (let i = 0; i < 5; i++) assert.deepEqual(diffWords(before, after), first);
  });
});

describe("mergeWordSpans", () => {
  it("joins spans separated by a short unchanged run", () => {
    // `a + b` rewritten to `x + y`: two changed tokens with " + " between.
    assert.deepEqual(mergeWordSpans([{ start: 0, end: 1 }, { start: 4, end: 5 }]), [
      { start: 0, end: 5 },
    ]);
  });

  it("keeps genuinely separate edits apart", () => {
    assert.deepEqual(mergeWordSpans([{ start: 0, end: 1 }, { start: 6, end: 7 }]), [
      { start: 0, end: 1 },
      { start: 6, end: 7 },
    ]);
  });

  it("leaves an empty list empty", () => {
    assert.deepEqual(mergeWordSpans([]), []);
  });
});
