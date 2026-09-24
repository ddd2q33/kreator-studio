"use client";

/** Minimal line-based diff used by the revisions panel. */

export type DiffLine = {
  type: "same" | "add" | "del";
  text: string;
};

export function diffLines(a: string, b: string): DiffLine[] {
  const aa = a.replace(/\r\n/g, "\n").split("\n");
  const bb = b.replace(/\r\n/g, "\n").split("\n");
  const n = aa.length;
  const m = bb.length;

  // LCS table — O(n·m); fine for chapter-sized documents.
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        aa[i] === bb[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aa[i] === bb[j]) {
      out.push({ type: "same", text: aa[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "del", text: aa[i] });
      i++;
    } else {
      out.push({ type: "add", text: bb[j] });
      j++;
    }
  }
  while (i < n) {
    out.push({ type: "del", text: aa[i] });
    i++;
  }
  while (j < m) {
    out.push({ type: "add", text: bb[j] });
    j++;
  }
  return out;
}

/** Count of changed lines (additions + deletions), ignoring identical text. */
export function diffStats(lines: DiffLine[]): {
  added: number;
  removed: number;
} {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.type === "add") added++;
    else if (line.type === "del") removed++;
  }
  return { added, removed };
}