/**
 * Starting points: a few worked examples of a code video.
 *
 * These are content, not look. `CODE_STYLES` decides what a frame looks like;
 * this file decides what a video is *about*, and it does so the way a real
 * tutorial is built - the file, then the things you notice in it, one after
 * another.
 *
 * Every template here is written to show the tool's central idea: a scene is one
 * file, and its sub-scenes are the moments the viewer is meant to see in it. The
 * snippets are deliberately real and a little long, so a template loaded as-is
 * has something to cut. A template whose code was already three lines would teach
 * the opposite lesson.
 *
 * Line indices are 0-based into the `code` string, and `marks` are 0-based into
 * `lines`, not into the file. That indirection is easy to get wrong by hand, so
 * `templateProject` resolves both and drops a sub-scene whose own indices do not
 * add up rather than exporting one that shows the wrong lines.
 */

import {
  BEAT_DEFAULT,
  HOLD_DEFAULT,
  type CodeProject,
  type CodeReveal,
  type CodeStyleId,
  defaultProject,
  newScene,
} from "./code-art.ts";

export type CodeTemplate = {
  id: string;
  label: string;
  /** One line on what shape of video this is. */
  hint: string;
  /** The style this template was designed to look right in. */
  styleId: CodeStyleId;
  reveal: CodeReveal;
  formatId: string;
  /** The shape a video usually needs to be to publish here. */
  name: string;
  scenes: {
    title: string;
    caption: string;
    /** The name in the editor's title bar. Defaults to the language. */
    fileName?: string;
    language: string;
    code: string;
    hold?: number;
    /** What the viewer is meant to notice, in order. */
    beats: {
      note?: string;
      /** Which lines of `code` this sub-scene shows. */
      lines: number[];
      /** Positions within `lines` to emphasise. */
      marks?: number[];
      /** Authored seconds. Omitted, the default beat length is used. */
      duration?: number;
    }[];
  }[];
};

/* --------------------------------------------------------------- the code */

/** Shared so the templates read as one course rather than unrelated snippets. */
const ASYNC_TS = `// 1. What we have: a list of orders, an id we care about.
type Order = { id: string; total: number; paid: boolean };
const orders: Order[] = loadOrders();

// 2. What we want: just the revenue that is actually banked.
const revenue = orders
  .filter((order) => order.paid)
  .reduce((sum, order) => sum + order.total, 0);

// 3. The bug: \`+=\` coerces, so a refunded order adds instead of subtracting.
let total = 0;
for (const order of orders) {
  total += order.total * (order.paid ? 1 : -1);
}

// 4. The fix: say what the sign means, out loud, where it is used.
const signed = (order: Order) => (order.paid ? order.total : -order.total);
const settled = orders.reduce((sum, o) => sum + signed(o), 0);`;

const FETCH_PY = `# The version everyone writes first: it waits for the body.
async def load(url):
    response = requests.get(url)
    return response.json()

# Two requests in series, and the second never starts
# until the first body has finished downloading.
def sequential(ids):
    return [load(f"{BASE}/orders/{i}") for i in ids]

# The version that overlaps the waits instead of adding them.
import asyncio

async def concurrent(ids):
    tasks = [load(f"{BASE}/orders/{i}") for i in ids]
    return await asyncio.gather(*tasks)`;

const REACT_TSX = `// Slow by accident: the list is rebuilt on every keystroke.
function Results({ query, items }) {
  const filtered = items.filter((item) =>
    item.name.toLowerCase().includes(query.toLowerCase()),
  );
  return filtered.map((item) => <Row key={item.id} {...item} />);
}

// useMemo does not make it fast. It makes it *predictable*: the filter only
// runs when the query or the list actually changed, and not on every render
// caused by something else going on higher up the tree.
function Results({ query, items }) {
  const filtered = useMemo(
    () =>
      items.filter((item) =>
        item.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [query, items],
  );
  return filtered.map((item) => <Row key={item.id} {...item} />);
}`;

const SQL_INDEX = `-- The query is fine. The table has no index on the column
-- being filtered, so Postgres reads all 4 million rows to return 12.
SELECT id, email, created_at
FROM orders
WHERE status = 'paid'
  AND created_at > now() - interval '7 days';

-- One index, and the same query stops touching the heap.
CREATE INDEX CONCURRENTLY orders_status_recent
  ON orders (status, created_at DESC);

-- The planner starts using it straight away; no rewrite of the query.`;

const BASH_TRAP = `# The script works. Right up until a filename has a space in it.
for f in $(ls ./reports); do
  mv "$f" ./archive/
done

# \`$(ls ...)\` splits on whitespace, so "annual report.pdf" arrives as two
# arguments and the second one is a file that does not exist.
for f in ./*.pdf; do
  mv -- "$f" ./archive/
done

# And the one that always works, whatever the filename is.
find ./reports -maxdepth 1 -name '*.pdf' -exec mv -t ./archive/ {} +`;

const GIT_REBASE = `# You are one commit behind and the history is unreadable.
git log --oneline
# 9f2a1c0 WIP
# 3d4e5f6 fix
# 7c8d9e0 fix
# a1b2c3d fix

# Interactive rebase, squash the three fixes into one, and drop the WIP.
git rebase -i HEAD~4
# pick 9f2a1c0 WIP
# squash 3d4e5f6 fix
# squash 7c8d9e0 fix
# squash a1b2c3d fix

# If it goes wrong, the reflog still has the old commits.
git reflog
git reset --hard ORIG_HEAD`;

/* ------------------------------------------------------------ the catalog */

export const CODE_TEMPLATES: readonly CodeTemplate[] = [
  {
    id: "explain",
    label: "Explain one idea",
    hint: "One file, two things to notice. The shape most explanations need.",
    styleId: "midnight",
    reveal: "typewriter",
    formatId: "phone-horizontal",
    name: "explained",
    scenes: [
      {
        title: "Revenue",
        caption: "Paid orders add up. Refunds were adding too.",
        fileName: "checkout.ts",
        language: "typescript",
        code: ASYNC_TS,
        beats: [
          {
            note: "the sign is applied in one place",
            lines: [9, 10, 11, 12, 13],
            marks: [3],
            duration: 4.5,
          },
          {
            note: "so the meaning is written down, out loud",
            lines: [15, 16, 17],
            marks: [1],
            duration: 4,
          },
        ],
      },
    ],
  },
  {
    id: "short",
    label: "10 second tip",
    hint: "One file, two beats, shaped for Shorts and Reels.",
    styleId: "caption",
    reveal: "lines",
    formatId: "phone-vertical",
    name: "ten-second-tip",
    scenes: [
      {
        title: "",
        caption: "Stop awaiting requests in a loop.",
        fileName: "load.py",
        language: "python",
        code: FETCH_PY,
        hold: 1.4,
        beats: [
          { note: "serial, not parallel", lines: [7, 8], duration: 2.6 },
          { note: "one await, many tasks", lines: [13, 14, 15], marks: [1], duration: 3.4 },
        ],
      },
    ],
  },
  {
    id: "before-after",
    label: "Before and after",
    hint: "The same file twice, so the difference lands on its own.",
    styleId: "spotlight",
    reveal: "lines",
    formatId: "phone-horizontal",
    name: "before-and-after",
    scenes: [
      {
        title: "Results",
        caption: "The same filter, run when it should be.",
        fileName: "Results.tsx",
        language: "tsx",
        code: REACT_TSX,
        beats: [
          {
            note: "every keystroke rebuilds the list",
            lines: [1, 2, 3, 4, 5, 6],
            duration: 4.5,
          },
          {
            note: "the dependencies are the change",
            lines: [12, 13, 14, 15, 16, 17],
            marks: [5],
            duration: 5,
          },
        ],
      },
    ],
  },
  {
    id: "performance",
    label: "Make it faster",
    hint: "A slow query and the one line that fixes it.",
    styleId: "terminal",
    reveal: "typewriter",
    formatId: "phone-horizontal",
    name: "faster",
    scenes: [
      {
        title: "4 million rows, 12 results",
        caption: "The query is fine. The table has no index.",
        fileName: "orders.sql",
        language: "sql",
        code: SQL_INDEX,
        beats: [
          { note: "no index on the filtered column", lines: [2, 3, 4, 5], duration: 4 },
          { note: "the query does not change", lines: [7, 8, 9], marks: [1], duration: 4 },
        ],
      },
    ],
  },
  {
    id: "shell",
    label: "Shell gotcha",
    hint: "The command that works, and the reason the old one did not.",
    styleId: "terminal",
    reveal: "typewriter",
    formatId: "phone-horizontal",
    name: "shell",
    scenes: [
      {
        title: "Moving files",
        caption: "Quote the variable, and the glob does the listing.",
        fileName: "archive.sh",
        language: "bash",
        code: BASH_TRAP,
        beats: [
          { note: "word splitting, one space at a time", lines: [1, 2, 3], marks: [0], duration: 3.4 },
          { note: "let the shell expand the glob", lines: [7, 8, 9], marks: [0], duration: 3.4 },
          { note: "and this one cannot break", lines: [12], marks: [0], duration: 3 },
        ],
      },
    ],
  },
  {
    id: "workflow",
    label: "Terminal workflow",
    hint: "A messy history cleaned up, for a channel that lives in the terminal.",
    styleId: "midnight",
    reveal: "lines",
    formatId: "phone-horizontal",
    name: "workflow",
    scenes: [
      {
        title: "Clean it up",
        caption: "Interactive rebase. Squash the three fixes into one.",
        fileName: "cleanup.sh",
        language: "bash",
        code: GIT_REBASE,
        beats: [
          { note: "four commits, three of them 'fix'", lines: [1, 2, 3, 4, 5], duration: 4 },
          { note: "squash them, drop the WIP", lines: [8, 9, 10, 11, 12], marks: [1], duration: 4.5 },
          { note: "the reflog keeps the old commits", lines: [15, 16], marks: [1], duration: 3.5 },
        ],
      },
    ],
  },
  {
    id: "walkthrough",
    label: "Vertical walkthrough",
    hint: "Three sub-scenes down a phone, with a note over each.",
    styleId: "dracula",
    reveal: "typewriter",
    formatId: "phone-vertical",
    name: "walkthrough",
    scenes: [
      {
        title: "Reading the file",
        caption: "Same file, three moments. This is a vertical lesson.",
        fileName: "load.py",
        language: "python",
        code: FETCH_PY,
        hold: 1.2,
        beats: [
          { note: "the request itself", lines: [1, 2, 3], duration: 3 },
          { note: "one list, sequential", lines: [7, 8], duration: 3 },
          { note: "tasks, gathered once", lines: [13, 14, 15], marks: [2], duration: 3.6 },
        ],
      },
    ],
  },
  {
    id: "empty",
    label: "Start from nothing",
    hint: "An empty timeline to paste your own code into.",
    styleId: "midnight",
    reveal: "typewriter",
    formatId: "phone-horizontal",
    name: "my-video",
    scenes: [],
  },
];

/**
 * Turns a template into a project, resolving each sub-scene's line indices.
 *
 * The resolution is the point of this function rather than a convenience. A
 * template is a literal in this file, and a literal in a file nobody typechecks
 * is exactly where a stale line number survives for a year. So the indices are
 * interpreted here, against the real file, and anything out of range is dropped -
 * and a sub-scene left with no lines at all is left out, because an empty one is
 * a blank panel on screen for its whole duration and reads as a broken export.
 * A scene whose every sub-scene went that way is left out too, for the same
 * reason.
 */
export function templateProject(template: CodeTemplate): CodeProject {
  const project: CodeProject = {
    ...defaultProject(),
    name: template.name,
    styleId: template.styleId,
    reveal: template.reveal,
    formatId: template.formatId,
  };

  template.scenes.forEach((entry, index) => {
    const total = entry.code.split("\n").length;
    const scene = newScene(entry.code, entry.language, entry.fileName ?? "code");
    scene.id = `scene_${template.id}_${index}`;
    scene.title = entry.title;
    scene.caption = entry.caption;
    scene.hold = entry.hold ?? HOLD_DEFAULT;

    entry.beats.forEach((beat, i) => {
      const lines = beat.lines.filter((n) => n >= 0 && n < total);
      if (lines.length === 0) return;
      // A mark is a position among the kept lines, so it is remapped through the
      // same filter: dropping file line 3 must not silently shift every mark after
      // it onto the wrong line.
      const kept = beat.lines.map((n, at) => ({ n, at })).filter((e) => e.n < total);
      const marks = (beat.marks ?? [])
        .map((m) => kept.findIndex((e) => e.at === m))
        .filter((m) => m >= 0);
      scene.beats.push({
        id: `beat_${template.id}_${index}_${i}`,
        note: beat.note ?? "",
        lines,
        marks,
        duration: beat.duration ?? BEAT_DEFAULT,
      });
    });

    if (scene.beats.length > 0) project.scenes.push(scene);
  });

  return project;
}

export function templateById(id: string): CodeTemplate {
  return (
    CODE_TEMPLATES.find((t) => t.id === id) ??
    CODE_TEMPLATES[CODE_TEMPLATES.length - 1]
  );
}
