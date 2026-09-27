import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  UNGROUPED_KEY,
  canMoveWithinRun,
  groupLabels,
  runLabel,
  runOfScene,
  runSceneIds,
  sceneRuns,
} from "../lib/scene-groups.ts";

type S = { id: string; group: string | null; duration: number };

const s = (id: string, group: string | null, duration = 2): S => ({
  id,
  group,
  duration,
});

describe("sceneRuns", () => {
  it("returns nothing for an empty timeline", () => {
    assert.deepEqual(sceneRuns([]), []);
  });

  it("keeps ungrouped scenes as one run", () => {
    const runs = sceneRuns([s("a", null), s("b", null)]);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].group, null);
    assert.equal(runs[0].key, `${UNGROUPED_KEY}#0`);
    assert.equal(runs[0].scenes.length, 2);
  });

  it("splits on a label change", () => {
    const runs = sceneRuns([
      s("a", "Intro"),
      s("b", "Intro"),
      s("c", "Body"),
      s("d", null),
    ]);
    assert.deepEqual(
      runs.map((r) => r.group),
      ["Intro", "Body", null],
    );
    assert.deepEqual(
      runs.map((r) => r.scenes.map((x) => x.id)),
      [["a", "b"], ["c"], ["d"]],
    );
  });

  it("treats a repeated label in two places as two sections", () => {
    const runs = sceneRuns([
      s("a", "Intro"),
      s("b", "Body"),
      s("c", "Intro"),
    ]);
    assert.equal(runs.length, 3);
    assert.equal(runs[0].group, "Intro");
    assert.equal(runs[2].group, "Intro");
  });

  it("tracks the start index and total duration of each run", () => {
    const runs = sceneRuns([
      s("a", "Intro", 2),
      s("b", "Intro", 3),
      s("c", null, 4),
    ]);
    assert.equal(runs[0].start, 0);
    assert.equal(runs[0].duration, 5);
    assert.equal(runs[1].start, 2);
    assert.equal(runs[1].duration, 4);
  });

  it("uses a distinct key per run even when the label repeats", () => {
    const runs = sceneRuns([s("a", "Intro"), s("b", null), s("c", "Intro")]);
    // React keys have to be unique across the whole strip, and one section's
    // collapsed state must not leak into another with the same label.
    assert.deepEqual(
      runs.map((r) => r.key),
      ["Intro#0", "ungrouped#0", "Intro#1"],
    );
  });

  it("keeps run keys stable when an earlier scene is inserted", () => {
    const before = sceneRuns([s("a", "Intro"), s("b", "Body")]);
    const after = sceneRuns([s("z", "Teaser"), s("a", "Intro"), s("b", "Body")]);
    assert.deepEqual(
      before.map((r) => r.key),
      after.map((r) => r.key).slice(1),
    );
  });
});

describe("groupLabels", () => {
  it("lists each label once, in first-appearance order", () => {
    const labels = groupLabels([
      s("a", "Body"),
      s("b", "Intro"),
      s("c", "Body"),
      s("d", null),
    ]);
    assert.deepEqual(labels, ["Body", "Intro"]);
  });

  it("is empty when nothing is grouped", () => {
    assert.deepEqual(groupLabels([s("a", null), s("b", null)]), []);
  });

  it("ignores blank labels", () => {
    assert.deepEqual(groupLabels([s("a", ""), s("b", "Intro")]), ["Intro"]);
  });
});

describe("canMoveWithinRun", () => {
  const scenes = [s("a", "Intro"), s("b", "Intro"), s("c", "Body"), s("d", "Body")];

  it("allows a move that stays inside the run", () => {
    assert.equal(canMoveWithinRun(scenes, "b", -1), true);
    assert.equal(canMoveWithinRun(scenes, "c", 1), true);
  });

  it("blocks a move that would cross into another run", () => {
    // "b" is the last Intro scene; "c" belongs to Body.
    assert.equal(canMoveWithinRun(scenes, "b", 1), false);
    assert.equal(canMoveWithinRun(scenes, "c", -1), false);
  });

  it("blocks a move past either end of the timeline", () => {
    assert.equal(canMoveWithinRun(scenes, "a", -1), false);
    assert.equal(canMoveWithinRun(scenes, "d", 1), false);
  });

  it("is false for an unknown scene", () => {
    assert.equal(canMoveWithinRun(scenes, "nope", 1), false);
  });

  it("lets ungrouped scenes move freely among themselves", () => {
    const flat = [s("a", null), s("b", null)];
    assert.equal(canMoveWithinRun(flat, "b", -1), true);
    assert.equal(canMoveWithinRun(flat, "a", 1), true);
  });
});

describe("runOfScene", () => {
  it("finds the run holding a scene", () => {
    const scenes = [s("a", "Intro"), s("b", "Intro"), s("c", "Body")];
    const run = runOfScene(scenes, "b");
    assert.ok(run);
    assert.equal(run.group, "Intro");
    assert.deepEqual(runSceneIds(run), ["a", "b"]);
  });

  it("returns null for an unknown id", () => {
    assert.equal(runOfScene([s("a", "Intro")], "zz"), null);
  });
});

describe("runLabel", () => {
  it("uses the group name, or a readable fallback", () => {
    assert.equal(runLabel({ key: "x", group: "Intro", scenes: [], start: 0, duration: 0 }), "Intro");
    assert.equal(runLabel({ key: UNGROUPED_KEY, group: null, scenes: [], start: 0, duration: 0 }), "Ungrouped");
  });
});
