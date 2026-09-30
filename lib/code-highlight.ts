import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

/**
 * Code for the video frames, turned into coloured runs a canvas can draw.
 *
 * The video editor paints straight onto a 2D context: there is no DOM to style
 * and no CSS to hang a class on, so the colours have to arrive as data. This
 * module is the one place that decides which highlight.js class is which colour
 * role, and it is a pure function of the source text - the same snippet always
 * produces the same runs - because a frame is painted again on every export and
 * a second run of a grammar that is not deterministic would show it.
 *
 * highlight.js is asked for HTML rather than for tokens, and the HTML is read
 * back here. Re-implementing two dozen grammars to avoid that is not worth it,
 * and the round trip is safe because of one property this module guarantees:
 * concatenating every token of a line reproduces the source line exactly, with
 * nothing lost and nothing invented. `tests/code-highlight.test.ts` pins that
 * against the real grammars, because a parser that silently drops a character
 * would show up in the video as code that does not match what was pasted.
 */

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("json", json);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("css", css);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("java", java);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("c", c);
hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("go", go);
hljs.registerLanguage("php", php);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("diff", diff);

/**
 * The languages offered in the editor.
 *
 * The ids are highlight.js's own names, so the value can go straight into the
 * highlighter. `text` is the honest name for "no grammar": a shell transcript
 * or a config file the author does not want coloured reads better plain than
 * in a grammar that guesses wrong.
 */
export const CODE_LANGUAGES = [
  "text",
  "javascript",
  "typescript",
  "python",
  "bash",
  "json",
  "xml",
  "css",
  "sql",
  "java",
  "cpp",
  "c",
  "csharp",
  "rust",
  "go",
  "php",
  "yaml",
  "diff",
] as const;

export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

/**
 * What a run is, for the painter's palette.
 *
 * A short list on purpose: every grammar emits more classes than any video
 * needs to tell apart, and a palette that grows with them would make the
 * themes impossible to keep legible.
 */
export type CodeTokenKind =
  | "plain"
  | "keyword"
  | "string"
  | "comment"
  | "number"
  | "function"
  | "type"
  | "variable"
  | "punctuation";

export type CodeToken = {
  text: string;
  kind: CodeTokenKind;
};

export type CodeLine = CodeToken[];

/** highlight.js classes, reduced to the roles a video frame distinguishes. */
const KIND_BY_CLASS: Record<string, CodeTokenKind> = {
  "hljs-keyword": "keyword",
  "hljs-built_in": "keyword",
  "hljs-literal": "keyword",
  "hljs-selector-tag": "keyword",
  "hljs-meta-keyword": "keyword",
  "hljs-doctag": "keyword",
  "hljs-section": "keyword",
  "hljs-operator": "keyword",
  "hljs-tag": "punctuation",
  "hljs-name": "variable",
  "hljs-selector-id": "variable",
  "hljs-selector-class": "variable",
  "hljs-variable": "variable",
  "hljs-template-variable": "variable",
  "hljs-variable.language_": "variable",
  "hljs-params": "variable",
  "hljs-property": "variable",
  "hljs-attr": "variable",
  "hljs-attribute": "variable",
  "hljs-symbol": "variable",
  "hljs-bullet": "variable",
  "hljs-link": "variable",
  "hljs-regexp": "string",
  "hljs-string": "string",
  "hljs-char.escape_": "string",
  "hljs-subst": "plain",
  "hljs-addition": "string",
  "hljs-quote": "comment",
  "hljs-comment": "comment",
  "hljs-meta": "comment",
  "hljs-deletion": "comment",
  "hljs-emphasis": "plain",
  "hljs-strong": "plain",
  "hljs-title": "function",
  "hljs-title.class_": "type",
  "hljs-title.class_.inherited_": "type",
  "hljs-title.function_": "function",
  "hljs-type": "type",
  "hljs-builtin-name": "type",
  "hljs-params_": "variable",
  "hljs-class": "type",
  "hljs-function": "function",
  "hljs-number": "number",
  "hljs-literal_": "number",
  "hljs-punctuation": "punctuation",
};

/** The classes highlight.js puts on a run that is not really a role. */
function kindOf(classes: string): CodeTokenKind {
  // The list can be several classes wide, and the most specific one is not
  // always first: `hljs-title function_` is a function, `hljs-variable
  // language_` is a variable. The last match wins, because highlight.js
  // appends the refinements after the general class.
  let kind: CodeTokenKind = "plain";
  for (const cls of classes.split(/\s+/)) {
    const mapped = KIND_BY_CLASS[cls];
    if (mapped) kind = mapped;
  }
  return kind;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/**
 * The entities highlight.js escapes, and nothing else.
 *
 * highlight.js writes some of them numerically - an apostrophe inside a
 * JavaScript string comes back as `&#x27;`, not as `&apos;` - so both spellings
 * have to be decoded. A numeric entity is decoded from its code point rather
 * than from a table, which keeps the decoder right for the ones it has not seen
 * instead of silently leaving them on screen as `&#x2014;`.
 */
function unescapeHtml(value: string): string {
  return value.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    const decoded = ENTITIES[body];
    // An unknown entity is left exactly as it arrived: rewriting it would
    // corrupt the text, and highlight.js never emits one.
    return decoded === undefined ? whole : decoded;
  });
}

const SPAN = /<span class="([^"]*)">|<\/span>|[^<]+/g;

/**
 * Reads a highlight.js fragment back into runs.
 *
 * The markup is only ever a flat list of text and `<span class>` opens and
 * closes, so a scanner is enough and a parser would be more code than the
 * grammar. Nesting is handled with a stack because a block comment inside a
 * string, or a class name inside a selector, does nest in practice.
 */
function runsFromFragment(fragment: string): CodeLine[] {
  const lines: CodeLine[] = [[]];
  const stack: CodeTokenKind[] = [];
  // The outermost class on a run is the general one and the innermost is the
  // refinement, and `kindOf` already prefers the refinement, so the stack is
  // only asked for the innermost non-plain role.
  const current = (): CodeTokenKind => {
    for (let i = stack.length - 1; i >= 0; i--) {
      const kind = stack[i]!;
      if (kind !== "plain") return kind;
    }
    return "plain";
  };
  const push = (text: string, kind: CodeTokenKind) => {
    if (text === "") return;
    const line = lines[lines.length - 1]!;
    const last = line[line.length - 1];
    // Runs are merged because a comment broken by a nested span would otherwise
    // draw as two fills of the same colour with a hairline between them.
    if (last && last.kind === kind) last.text += text;
    else line.push({ text, kind });
  };
  const addNewlines = (text: string, kind: CodeTokenKind) => {
    const parts = text.split("\n");
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) lines.push([]);
      push(parts[i]!, kind);
    }
  };

  SPAN.lastIndex = 0;
  for (let m = SPAN.exec(fragment); m; m = SPAN.exec(fragment)) {
    const [whole, classes] = m;
    if (whole === "</span>") {
      stack.pop();
      continue;
    }
    if (classes !== undefined) {
      stack.push(kindOf(classes));
      continue;
    }
    addNewlines(unescapeHtml(whole), current());
  }
  return lines;
}

const plain = (text: string): CodeLine[] =>
  text.split("\n").map((line) => (line ? [{ text: line, kind: "plain" }] : []));

/** highlight.js's own name for a language, or null when there is no grammar. */
function grammarFor(language: string): string | null {
  const id = language.trim().toLowerCase();
  if (id === "" || id === "text" || id === "plain") return null;
  // Aliases a pasted scene file may carry, pointed at the grammar that covers
  // them: the frame is drawn from the grammar's point of view, not the file's.
  const aliases: Record<string, string> = {
    js: "javascript",
    jsx: "javascript",
    node: "javascript",
    ts: "typescript",
    tsx: "typescript",
    py: "python",
    python3: "python",
    sh: "bash",
    shell: "bash",
    zsh: "bash",
    console: "bash",
    html: "xml",
    svg: "xml",
    md: "xml",
    markdown: "xml",
    yml: "yaml",
    "c++": "cpp",
    cs: "csharp",
    golang: "go",
    rs: "rust",
  };
  const resolved = aliases[id] ?? id;
  // A name this build does not carry a grammar for is not an error either: the
  // snippet is still worth showing, just without colour.
  return hljs.getLanguage(resolved) ? resolved : null;
}

/**
 * Splits source text into lines of coloured runs.
 *
 * A grammar that throws, or a language this build does not carry, comes back
 * as plain text rather than as an error: a video is not the place to fail a
 * render because one snippet was pasted with a language name off by a letter.
 */
export function tokenizeCode(source: string, language: string): CodeLine[] {
  // Normalised once, here: a file pasted from Windows would otherwise paint a
  // stray carriage return at the end of every line, and a lone \r is not a line
  // break to anything downstream.
  const text = source.replace(/\r\n?/g, "\n");
  if (text === "") return [[]];
  const grammar = grammarFor(language);
  if (!grammar) return plain(text);
  try {
    // ignoreIllegals is what keeps a half-typed snippet from throwing: the
    // grammar is allowed to give up on the middle and highlight the rest.
    const { value } = hljs.highlight(text, { language: grammar, ignoreIllegals: true });
    const lines = runsFromFragment(value);
    return lines.length > 0 ? lines : plain(text);
  } catch {
    return plain(text);
  }
}

/** Rebuilds the text of a line, which is what the round-trip test checks. */
export function lineText(line: CodeLine): string {
  return line.map((token) => token.text).join("");
}
