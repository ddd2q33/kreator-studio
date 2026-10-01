import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CODE_LANGUAGES,
  lineText,
  tokenizeCode,
} from "../lib/code-highlight.ts";
import { CODE_PANEL_THEMES, CODE_REVEAL_LABELS, codePanelTheme } from "../lib/code-panel.ts";
import { DEFAULT_CODE_THEME, normalizeSceneCode } from "../lib/scene-schema.ts";

/**
 * The tokenizer is the one place where what the author pasted could quietly
 * stop being what is drawn, because the runs come back out of a grammar's HTML
 * rather than out of the source. So the property under test is the round trip:
 * join the runs of a line and you must get the source line back, character for
 * character, for every language the editor offers.
 */
const roundTrip = (source: string, language: string) =>
  tokenizeCode(source, language).map(lineText).join("\n");

const SAMPLES: Record<string, string> = {
  text: "just words\n  and a second line",
  javascript: "const greet = (name) => `hi ${name}`;\ngreet('world');",
  typescript:
    "type Pair<A, B> = { a: A; b: B };\nconst p: Pair<number, string> = { a: 1, b: 'x' };",
  python: "def fib(n: int) -> int:\n    return n if n < 2 else fib(n - 1) + fib(n - 2)",
  bash: "npm run build && echo \"done $?\" # comment",
  json: '{ "a": 1, "b": [true, null], "c": { "d": "e" } }',
  xml: '<div class="a">text &amp; more</div>',
  css: ".a > .b { color: #fff; margin: 0 auto; }",
  sql: "SELECT id, name FROM users WHERE age >= 18 ORDER BY name;",
  java: "public class A { public static void main(String[] a) {} }",
  cpp: "#include <vector>\nint main() { std::vector<int> v{1, 2}; return 0; }",
  c: "#include <stdio.h>\nint main(void) { printf(\"hi\"); return 0; }",
  csharp: "public sealed class A { public int X { get; init; } = 3; }",
  rust: "fn main() { let v: Vec<i32> = vec![1, 2]; println!(\"{:?}\", v); }",
  go: 'package main\n\nimport "fmt"\n\nfunc main() { fmt.Println("hi") }',
  php: "<?php\nfunction f(int $x): int { return $x * 2; }",
  yaml: "name: demo\non:\n  push:\n    branches: [main]",
  diff: "+ added line\n- removed line\n  context",
};

describe("tokenizeCode", () => {
  it("reproduces the source exactly for every offered language", () => {
    for (const language of CODE_LANGUAGES) {
      const source = SAMPLES[language];
      assert.ok(source, `no sample for ${language}`);
      assert.equal(roundTrip(source, language), source, language);
    }
  });

  it("does not lose characters in constructs that nest spans", () => {
    // A block comment, a URL inside a comment and a template literal: the three
    // shapes where a real grammar nests, and where a naive reader drops text.
    const source = [
      "/* see https://example.com/a?b=1&c=2 for why */",
      'const tpl = `a ${b} c`;',
      "const re = /ab+c/g; // trailing",
    ].join("\n");
    for (const language of ["javascript", "typescript", "java", "cpp", "c", "rust", "go"]) {
      assert.equal(roundTrip(source, language), source, language);
    }
  });

  it("normalizes line endings so a Windows paste has no stray returns", () => {
    const source = "a = 1\r\nb = 2\r\n";
    const lines = tokenizeCode(source, "python");
    assert.equal(lines.map(lineText).join("\n"), "a = 1\nb = 2\n");
    for (const line of lines) {
      for (const token of line) assert.ok(!token.text.includes("\r"));
    }
  });

  it("gives an empty snippet one empty line rather than none", () => {
    assert.deepEqual(tokenizeCode("", "typescript"), [[]]);
  });

  it("keeps blank lines blank", () => {
    const source = "a\n\nb";
    const lines = tokenizeCode(source, "text");
    assert.equal(lines.length, 3);
    assert.equal(lines[1]!.length, 0);
  });

  it("falls back to plain text for a language it does not carry", () => {
    const source = "some brainfuck +[-<>]";
    const lines = tokenizeCode(source, "brainfuck");
    assert.equal(lines.map(lineText).join("\n"), source);
    assert.ok(lines.flat().every((t) => t.kind === "plain"));
  });

  it("survives a snippet that is not valid in the named language", () => {
    // A half-typed line is the normal state of a programming video's frame.
    const source = "def f(:\n  return ???\n";
    assert.equal(roundTrip(source, "python"), source);
  });

  it("resolves the aliases a hand-written scene file may carry", () => {
    // Each alias is checked with source its own grammar recognises, because the
    // point is that the name reached a grammar, not that every string is
    // colourful.
    const cases: [string, string][] = [
      ["js", "const a = 1;"],
      ["ts", "const a: number = 1;"],
      ["py", "a = 1"],
      ["sh", "echo hello"],
      ["yml", "a: 1"],
      ["html", "<p>hi</p>"],
    ];
    for (const [alias, source] of cases) {
      const lines = tokenizeCode(source, alias);
      assert.equal(lines.map(lineText).join("\n"), source, alias);
      assert.ok(
        lines.flat().some((t) => t.kind !== "plain"),
        `${alias} should have been highlighted`,
      );
    }
  });

  it("splits the source into the lines it has, not the lines a grammar likes", () => {
    const source = "one\ntwo\nthree\nfour";
    assert.equal(tokenizeCode(source, "text").length, 4);
    assert.equal(tokenizeCode(source, "text").at(-1)!.length, 1);
  });
});

describe("codePanelTheme", () => {
  it("finds a palette by id", () => {
    for (const theme of CODE_PANEL_THEMES) {
      assert.equal(codePanelTheme(theme.id).id, theme.id);
    }
  });

  it("falls back to the default for an unknown or missing id", () => {
    assert.equal(codePanelTheme("solarized").id, DEFAULT_CODE_THEME);
    assert.equal(codePanelTheme(null).id, DEFAULT_CODE_THEME);
    assert.equal(codePanelTheme("").id, DEFAULT_CODE_THEME);
  });

  it("gives every palette a colour for every token kind", () => {
    const kinds = [
      "plain",
      "keyword",
      "string",
      "comment",
      "number",
      "function",
      "type",
      "variable",
      "punctuation",
    ] as const;
    for (const theme of CODE_PANEL_THEMES) {
      for (const kind of kinds) {
        assert.match(theme.tokens[kind], /^#[0-9a-f]{6}$/i, `${theme.id}/${kind}`);
      }
    }
  });

  it("names every reveal for the inspector", () => {
    assert.deepEqual(Object.keys(CODE_REVEAL_LABELS).sort(), ["all", "lines", "typed"]);
  });
});

describe("normalizeSceneCode", () => {
  it("treats a missing or empty snippet as no snippet", () => {
    for (const input of [undefined, null, "", "   ", {}, 42, { source: "  " }]) {
      const { code, warnings } = normalizeSceneCode(input);
      assert.equal(code, null, JSON.stringify(input));
      assert.deepEqual(warnings, []);
    }
  });

  it("reads a bare string as plain text", () => {
    const { code, warnings } = normalizeSceneCode("  const x = 1;  ");
    assert.deepEqual(code, {
      language: "text",
      source: "const x = 1;",
      theme: DEFAULT_CODE_THEME,
      reveal: "all",
      scale: 1,
      callouts: {},
      focus: [],
    });
    assert.deepEqual(warnings, []);
  });

  it("keeps every field the author set", () => {
    const { code } = normalizeSceneCode({
      language: "rust",
      source: "fn main() {}",
      theme: "carbon",
      reveal: "typed",
      scale: 1.4,
    });
    assert.deepEqual(code, {
      language: "rust",
      source: "fn main() {}",
      theme: "carbon",
      reveal: "typed",
      scale: 1.4,
      callouts: {},
      focus: [],
    });
  });

  it("clamps the scale into the range the painter can use", () => {
    assert.equal(normalizeSceneCode({ source: "x", scale: 0 }).code?.scale, 0.4);
    assert.equal(normalizeSceneCode({ source: "x", scale: 99 }).code?.scale, 2);
    assert.equal(normalizeSceneCode({ source: "x", scale: "big" }).code?.scale, 1);
  });

  it("warns and falls back on an unknown reveal", () => {
    const { code, warnings } = normalizeSceneCode({ source: "x", reveal: "scroll" });
    assert.equal(code?.reveal, "all");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /unknown code reveal "scroll"/);
  });

  it("trims an oversized snippet instead of keeping a pasted file", () => {
    const { code, warnings } = normalizeSceneCode({ source: "x".repeat(9000) });
    assert.equal(code?.source.length, 8000);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /trimmed to 8000/);
  });
});
