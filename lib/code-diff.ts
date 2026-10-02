/**
 * Line diff for the code card's "diff" mode.
 *
 * A refactor is taught by showing what changed, so a scene can carry two
 * snippets — the code before and the code after — and the frame shows the
 * rewrite: kept lines dim-neutral, added lines green, removed lines red, in
 * the way every code review UI has trained programmers to read.
 *
 * Plain text, not AST: the diff of a snippet is a teaching aid and the author
 * chose both versions, so a line-for-line LCS over the raw text is exactly the
 * truth they wrote. It is also deterministic, which the renderer requires:
 * the same scene must paint the same rows in the preview and in the export.
 */

/** What one row of the diff is. */
export type DiffRowKind = "same" | "add" | "del";

export type DiffRow = {
  kind: DiffRowKind;
  /** The line to display: the new file's line for add/same, the old for del. */
  text: string;
  /** 1-based line in the old file, 0 for additions. */
  before: number;
  /** 1-based line in the new file, 0 for deletions. */
  after: number;
};

/**
 * Diffs two snippets line by line.
 *
 * A classic LCS dynamic program. Snippets are capped at a few hundred lines
 * by the schema, so the n·m table costs nothing and the straightforward
 * algorithm beats a clever one that might reorder hunks.
 */
export function diffLines(before: string, after: string): DiffRow[] {
  // An empty half is not a diff against a blank first line: "" split gives
  // [""], which would show a phantom deleted/added empty line. When one side
  // is empty the result is simply every line of the other side.
  if (before === "") {
    return after.split("\n").map((text, j) => ({
      kind: "add",
      text,
      before: 0,
      after: j + 1,
    }));
  }
  if (after === "") {
    return before.split("\n").map((text, i) => ({
      kind: "del",
      text,
      before: i + 1,
      after: 0,
    }));
  }
  const a = before.split("\n");
  const b = after.split("\n");
  const n = a.length;
  const m = b.length;
  // dp[i][j] = length of the longest common subsequence of a[i:] and b[j:].
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] =
        a[i] === b[j]
          ? dp[i + 1]![j + 1]! + 1
          : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ kind: "same", text: a[i]!, before: i + 1, after: j + 1 });
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      rows.push({ kind: "del", text: a[i]!, before: i + 1, after: 0 });
      i += 1;
    } else {
      rows.push({ kind: "add", text: b[j]!, before: 0, after: j + 1 });
      j += 1;
    }
  }
  while (i < n) {
    rows.push({ kind: "del", text: a[i]!, before: i + 1, after: 0 });
    i += 1;
  }
  while (j < m) {
    rows.push({ kind: "add", text: b[j]!, before: 0, after: j + 1 });
    j += 1;
  }
  return rows;
}

/** How many rows are not `same` — the UI's "this diff has something to teach" count. */
export function diffChangedCount(rows: readonly DiffRow[]): number {
  return rows.filter((r) => r.kind !== "same").length;
}

/** A half-open character range inside one line of code. */
export type WordSpan = { start: number; end: number };

export type WordDiff = {
  /** Ranges of `before` that the common text skips. */
  removed: WordSpan[];
  /** Ranges of `after` that the common text skips. */
  added: WordSpan[];
};

/**
 * Word-level diff for one pair of changed lines.
 *
 * A line-for-line diff shouts whole-line rewrites even when a single
 * identifier moved; marking only the changed words, the way GitHub does,
 * keeps the reader's eye on what actually moved. Runs over the raw characters
 * — a token is a run of identifier characters, a run of whitespace, or any
 * single other character — and reports, for each side, the character ranges
 * the longest common token subsequence skips. Deterministic like `diffLines`:
 * the same pair must paint the same pixels in preview and export.
 */
export function diffWords(before: string, after: string): WordDiff {
  const a = tokenizeWords(before);
  const b = tokenizeWords(after);
  const n = a.length;
  const m = b.length;
  // The same LCS dynamic program `diffLines` runs, one level down: over
  // tokens of a single line instead of lines of a file. Lines are short, so
  // the n·m table is trivially cheap.
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] =
        a[i]!.text === b[j]!.text
          ? dp[i + 1]![j + 1]! + 1
          : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const removed: WordSpan[] = [];
  const added: WordSpan[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i]!.text === b[j]!.text) {
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      pushSpan(removed, a[i]!.start, a[i]!.text.length);
      i += 1;
    } else {
      pushSpan(added, b[j]!.start, b[j]!.text.length);
      j += 1;
    }
  }
  while (i < n) {
    pushSpan(removed, a[i]!.start, a[i]!.text.length);
    i += 1;
  }
  while (j < m) {
    pushSpan(added, b[j]!.start, b[j]!.text.length);
    j += 1;
  }
  return { removed, added };
}

/** Splits a line into word runs, whitespace runs and single other characters. */
function tokenizeWords(text: string): { text: string; start: number }[] {
  const tokens: { text: string; start: number }[] = [];
  for (const match of text.matchAll(/[A-Za-z0-9_$]+|\s+|[\s\S]/g)) {
    tokens.push({ text: match[0], start: match.index! });
  }
  return tokens;
}

/** Appends a range, fusing it into its neighbour when the two touch. */
function pushSpan(spans: WordSpan[], start: number, length: number): void {
  const last = spans[spans.length - 1];
  if (last && last.end >= start) last.end = Math.max(last.end, start + length);
  else spans.push({ start, end: start + length });
}

/**
 * Joins spans separated by a short run of unchanged characters into one.
 *
 * `a + b` rewritten to `x + y` changes two tokens with three common characters
 * between them; one highlight reads better than two, and a gap any longer
 * than this is genuinely separate edits the reader should see apart.
 */
export function mergeWordSpans(spans: readonly WordSpan[], maxGap = 3): WordSpan[] {
  const out: WordSpan[] = [];
  for (const span of spans) {
    const last = out[out.length - 1];
    if (last && span.start - last.end <= maxGap) {
      last.end = Math.max(last.end, span.end);
    } else {
      out.push({ ...span });
    }
  }
  return out;
}
