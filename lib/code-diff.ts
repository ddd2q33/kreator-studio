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
