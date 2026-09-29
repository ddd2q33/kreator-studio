/**
 * Turning source code into coloured runs a canvas can draw.
 *
 * A code video has to be painted with `fillText`, because that is the only way
 * to draw into the canvas the MP4 encoder samples. Canvas has no notion of
 * markup, so the syntax colours have to arrive as data: a list of lines, each
 * line a list of `{ text, class }` runs that can be measured and drawn one after
 * another.
 *
 * highlight.js is asked for HTML rather than for tokens, and the HTML is read
 * back into runs. That looks roundabout, and it is: the alternative is to
 * reimplement the grammars. What makes it safe is that highlight.js emits a
 * deliberately flat fragment - text and `<span class="hljs-...">`, nothing else -
 * so splitting on that shape needs no HTML parser, works in Node, and cannot be
 * broken by a document that has not been built yet. `RUN_RE` is that split, and
 * `tests/code-art.test.ts` pins its behaviour.
 *
 * Isomorphic on purpose, for the same reason `render-engine.ts` is: the same
 * tokenizer has to run in a unit test, in the preview, and in the encoder
 * callback, and a DOM would mean only two of the three could.
 *
 * The language list is registered here rather than borrowed from
 * `render-engine.ts`. That file is shared with the CLI and the REST API, and
 * making a video tool depend on the markdown engine's import graph would couple
 * two tools that share nothing but a syntax highlighter. The list is data; when
 * a language is added to one, it is added to the other.
 */

import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import sql from "highlight.js/lib/languages/sql";
import java from "highlight.js/lib/languages/java";
import cpp from "highlight.js/lib/languages/cpp";
import c from "highlight.js/lib/languages/c";
import csharp from "highlight.js/lib/languages/csharp";
import rust from "highlight.js/lib/languages/rust";
import go from "highlight.js/lib/languages/go";
import php from "highlight.js/lib/languages/php";
import yaml from "highlight.js/lib/languages/yaml";
import kotlin from "highlight.js/lib/languages/kotlin";
import swift from "highlight.js/lib/languages/swift";
import dart from "highlight.js/lib/languages/dart";
import ruby from "highlight.js/lib/languages/ruby";
import lua from "highlight.js/lib/languages/lua";
import elixir from "highlight.js/lib/languages/elixir";
import clojure from "highlight.js/lib/languages/clojure";
import graphql from "highlight.js/lib/languages/graphql";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import ini from "highlight.js/lib/languages/ini";
import diff from "highlight.js/lib/languages/diff";

/**
 * The languages on offer, in the order the picker shows them.
 *
 * The id is highlight.js's own name, so the value can go straight into
 * `highlight()`. "text" is first on purpose: plain text is the honest answer
 * for a shell transcript or a config fragment nobody wants coloured badly, and
 * it must always be available because it is the fallback.
 *
 * The list grew from what a programming explainer actually shows rather than from
 * what highlight.js ships. A video about an API is a `curl` in `bash`; a video
 * about an app is a `graphql` schema or a `dockerfile`; a video about a diff is a
 * `diff`. The ones that were added are the ones with a grammar good enough to
 * colour, because an uncoloured snippet in the middle of a coloured video reads
 * as a mistake.
 */
export const CODE_LANGUAGES = [
  { id: "text", label: "Plain text" },
  { id: "javascript", label: "JavaScript" },
  { id: "typescript", label: "TypeScript / TSX" },
  { id: "python", label: "Python" },
  { id: "go", label: "Go" },
  { id: "rust", label: "Rust" },
  { id: "java", label: "Java" },
  { id: "kotlin", label: "Kotlin" },
  { id: "swift", label: "Swift" },
  { id: "dart", label: "Dart" },
  { id: "php", label: "PHP" },
  { id: "csharp", label: "C#" },
  { id: "cpp", label: "C++" },
  { id: "c", label: "C" },
  { id: "ruby", label: "Ruby" },
  { id: "elixir", label: "Elixir" },
  { id: "clojure", label: "Clojure" },
  { id: "lua", label: "Lua" },
  { id: "sql", label: "SQL" },
  { id: "bash", label: "Shell" },
  { id: "dockerfile", label: "Dockerfile" },
  { id: "graphql", label: "GraphQL" },
  { id: "json", label: "JSON" },
  { id: "yaml", label: "YAML" },
  { id: "ini", label: "INI / .env" },
  { id: "xml", label: "HTML / XML" },
  { id: "css", label: "CSS" },
  { id: "diff", label: "Diff" },
] as const;

export type CodeLanguageId = (typeof CODE_LANGUAGES)[number]["id"];

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
hljs.registerLanguage("kotlin", kotlin);
hljs.registerLanguage("swift", swift);
hljs.registerLanguage("dart", dart);
hljs.registerLanguage("ruby", ruby);
hljs.registerLanguage("lua", lua);
hljs.registerLanguage("elixir", elixir);
hljs.registerLanguage("clojure", clojure);
hljs.registerLanguage("graphql", graphql);
hljs.registerLanguage("dockerfile", dockerfile);
hljs.registerLanguage("ini", ini);
hljs.registerLanguage("diff", diff);

/**
 * JSX has no grammar of its own in highlight.js, so `tsx` and `jsx` are pointed
 * at the TypeScript one.
 *
 * It has to be an alias rather than a value the picker never offers: a script
 * that says `"language": "tsx"` used to be normalised down to `text`, which threw
 * away every colour in the frame and left the video looking broken for a reason
 * nobody could see. A script is written by somebody who knows the language, and
 * the answer to "tsx" is to colour it, not to argue.
 */
hljs.registerAliases(["tsx", "jsx"], { languageName: "typescript" });

/** One coloured stretch of a line. `class` is empty for unhighlighted text. */
export type CodeRun = { text: string; cls: string };

/**
 * A source line as the painter needs it: runs, plus the flat text and the
 * character offset of every run inside it.
 *
 * The offsets are what let the typewriter stop halfway through a word without
 * having to re-highlight anything. They are computed once, when the code is
 * pasted, and every frame after that is a slice of this.
 */
export type CodeLine = {
  /** 1-based line number as the gutter shows it, or 0 when numbering is off. */
  number: number;
  runs: CodeRun[];
  /** The line with no markup, which is what the character count is measured on. */
  text: string;
  /** Character offset of each run within `text`. */
  offsets: number[];
};

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#x27;": "'",
  "&#39;": "'",
  "&apos;": "'",
};

/**
 * Undoes the five entities highlight.js escapes, and no others.
 *
 * A real HTML parser is not needed because the only thing that can appear in
 * the fragment is text and spans: an entity highlight.js did not emit cannot be
 * there, and a `&` that is not part of one of these five is already literal.
 */
function unescape(text: string): string {
  return text.replace(
    /&(?:amp|lt|gt|quot|#x27|#39|apos);/g,
    (match) => ENTITIES[match] ?? match,
  );
}

/**
 * Splits highlight.js's fragment into runs.
 *
 * The alternation is the whole trick: a `span` open tag with its class, the
 * matching `</span>`, or a run of anything that is not a `<`. highlight.js never
 * nests spans and never emits another tag, so a match is one of three things and
 * there is no fourth case to get wrong.
 *
 * The closing tag has to be matched explicitly, and it is deliberately the one
 * alternative with no capture group. Left out, it would not be skipped - it
 * would be picked up by the text alternative, and `</span>` would end up inside
 * the line's text, which is what the typewriter measures to decide when the line
 * is finished. The line would then take twice as long to type as it is wide, and
 * the closing tags would be drawn on screen.
 *
 * So a match that is neither the class nor the text is a closing tag, and a
 * match with no group at all cannot be confused with an empty piece of text.
 */
const RUN_RE = /<span class="hljs-([a-z0-9-]+)">|<\/span>|([^<]+)/gi;

/**
 * Colours `code` and returns it line by line.
 *
 * Returns plain lines with a single uncoloured run rather than an empty list
 * when the language is unknown, because a pasted snippet in a language this
 * build has no grammar for still has to appear in the video. An unknown
 * language is not a reason to refuse to draw the text.
 */
export function tokenizeCode(code: string, language: string): CodeLine[] {
  const source = code.replace(/\r\n?/g, "\n");
  let fragment: string;
  try {
    fragment =
      language && language !== "text" && hljs.getLanguage(language)
        ? hljs.highlight(source, { language, ignoreIllegals: true }).value
        : escapeHtml(source);
  } catch {
    // highlight.js throws on a grammar it cannot run to completion. The video
    // still needs the code on screen, so this falls back to plain text rather
    // than losing the shot.
    fragment = escapeHtml(source);
  }

  const runs: CodeRun[] = [];
  for (const match of fragment.matchAll(RUN_RE)) {
    if (match[1]) {
      runs.push({ text: "", cls: `hljs-${match[1]}` });
    } else if (match[2]) {
      runs.push({ text: unescape(match[2]), cls: "" });
    }
    // Neither group: a closing tag. Nothing to draw, and nothing to measure.
  }
  // A grammar can emit an empty class, e.g. a bare `<span class="hljs-">`.
  // Treating that as no class keeps the painter from looking up a colour that
  // does not exist.
  return linesFromRuns(runs);
}

/**
 * Folds a flat run list into lines, tracking each run's offset within its line.
 *
 * A newline inside a run is what starts the next line, and the run is split
 * across the boundary. Doing it here rather than in the painter means the
 * painter never has to think about where a line begins.
 */
function linesFromRuns(runs: CodeRun[]): CodeLine[] {
  const lines: CodeLine[] = [];
  let current: CodeRun[] = [];
  let text = "";
  let offsets: number[] = [];

  const closeLine = (number: number) => {
    lines.push({ number, runs: current, text, offsets });
    current = [];
    text = "";
    offsets = [];
  };

  for (const run of runs) {
    if (run.text === "") {
      current.push({ text: "", cls: run.cls });
      offsets.push(text.length);
      continue;
    }
    const pieces = run.text.split("\n");
    for (const [i, piece] of pieces.entries()) {
      if (i > 0) closeLine(lines.length + 1);
      current.push({ text: piece, cls: run.cls });
      offsets.push(text.length);
      text += piece;
    }
  }
  // The final line is closed by hand: a code block ending in a newline has one
  // empty line after it, and a block not ending in a newline still has a last
  // line to number.
  closeLine(lines.length + 1);
  return lines;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** True when this build can colour the given language. */
export function hasGrammar(language: string): boolean {
  return language === "text" || hljs.getLanguage(language) != null;
}

/**
 * The character a run starts at, looked up from a line's precomputed offsets.
 *
 * Exported because the typewriter walks exactly this: it needs the start and
 * end of every token to decide how much of the current one is on screen.
 */
export function runSpan(line: CodeLine, index: number): [number, number] {
  const start = line.offsets[index] ?? 0;
  const run = line.runs[index];
  const end = start + (run?.text.length ?? 0);
  return [start, end];
}

/** Total characters in a block of lines, newlines included. */
export function countChars(lines: readonly CodeLine[]): number {
  return lines.reduce((acc, line) => acc + line.text.length, 0);
}

