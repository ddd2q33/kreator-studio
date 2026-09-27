import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  UNGROUPED_KEY,
  canMoveSceneStep,
  canMoveWithinRun,
  groupLabels,
  moveRunTo,
  moveSceneStep,
  runLabel,
  runOfScene,
  runSceneIds,
  scenesOfRun,
  sectionSlug,
  splitScene,
  sceneRuns,
} from "../lib/scene-groups.ts";

type S = { id: string; group: string | null; duration: number };

const s = (id: string, group: string | null, duration = 2): S => ({
  id,
  group,
  duration,
});

/** Scene ids in order, for readable order assertions. */
const order = (scenes: readonly S[]): string[] => scenes.map((x) => x.id);

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

describe("moveSceneStep", () => {
  it("moves a single ungrouped scene one step", () => {
    const scenes = [s("a", null), s("b", null), s("c", null)];
    assert.deepEqual(order(moveSceneStep(scenes, "b", -1)), ["b", "a", "c"]);
    assert.deepEqual(order(moveSceneStep(scenes, "b", 1)), ["a", "c", "b"]);
  });

  it("carries a whole group instead of splitting it", () => {
    // Moving only "b" would leave "a" behind and turn one section into two.
    const scenes = [s("a", "Intro"), s("b", "Intro"), s("c", "Body")];
    assert.deepEqual(order(moveSceneStep(scenes, "b", 1)), ["c", "a", "b"]);
    assert.deepEqual(order(moveSceneStep(scenes, "a", 1)), ["c", "a", "b"]);
  });

  it("keeps the group contiguous in both directions", () => {
    const scenes = [s("a", "Top"), s("b", "G"), s("c", "G"), s("d", "Bottom")];
    const down = moveSceneStep(scenes, "b", 1);
    assert.deepEqual(order(down), ["a", "d", "b", "c"]);
    // The two members are still next to each other after the move.
    const positions = down
      .map((x, i) => (x.group === "G" ? i : -1))
      .filter((i) => i !== -1);
    assert.equal(positions.length, 2);
    assert.equal(positions[1]! - positions[0]!, 1, "the group was split");
  });

  it("moves a group up as a block", () => {
    const scenes = [s("a", "Top"), s("b", "G"), s("c", "G"), s("d", "Bottom")];
    const up = moveSceneStep(scenes, "c", -1);
    assert.deepEqual(order(up), ["b", "c", "a", "d"]);
  });

  it("moves a one-scene group on its own", () => {
    // A run of one cannot be split, so the block rule has nothing to do.
    const scenes = [s("a", null), s("b", "Solo"), s("c", null)];
    assert.deepEqual(order(moveSceneStep(scenes, "b", -1)), ["b", "a", "c"]);
  });

  it("does nothing at either end of the timeline", () => {
    const scenes = [s("a", "G"), s("b", "G"), s("c", null)];
    assert.equal(moveSceneStep(scenes, "a", -1), scenes);
    assert.equal(moveSceneStep(scenes, "c", -1), scenes);
  });

  it("returns the same array when a group is already first", () => {
    // Identity is how the caller avoids a pointless re-render.
    const scenes = [s("a", "G"), s("b", "G"), s("c", null)];
    assert.equal(moveSceneStep(scenes, "a", -1), scenes);
    assert.equal(moveSceneStep(scenes, "b", -1), scenes);
  });

  it("returns the same array for an unknown id", () => {
    const scenes = [s("a", null)];
    assert.equal(moveSceneStep(scenes, "zz", 1), scenes);
  });

  it("leaves the input array untouched", () => {
    const scenes = [s("a", "G"), s("b", "G"), s("c", null)];
    const before = order(scenes);
    moveSceneStep(scenes, "b", 1);
    assert.deepEqual(order(scenes), before);
  });

  it("refuses to wedge a scene inside a section it does not belong to", () => {
    // The failure this exists to prevent: an ungrouped scene dropped between the
    // two halves of "G" leaves the same section name on two separate runs.
    const scenes = [s("a", "G"), s("b", "G"), s("c", null)];
    assert.equal(moveSceneStep(scenes, "c", -1), scenes);

    const other = [s("a", null), s("b", "G"), s("c", "G")];
    assert.equal(moveSceneStep(other, "a", 1), other);
  });

  it("allows a scene between two separate sections that share a name", () => {
    // Two runs with the same label are two sections, not one, so this is a
    // legitimate layout rather than a split.
    const scenes = [s("a", "G"), s("b", null), s("c", "G")];
    assert.deepEqual(order(moveSceneStep(scenes, "b", -1)), ["b", "a", "c"]);
    assert.deepEqual(order(moveSceneStep(scenes, "b", 1)), ["a", "c", "b"]);
  });

  it("lets a scene roam the ungrouped region but stop at the section edge", () => {
    // Moving up lands with nothing on the left, so there is no run to split.
    const scenes = [s("a", null), s("b", null), s("c", "G"), s("d", "G")];
    assert.deepEqual(order(moveSceneStep(scenes, "b", -1)), ["b", "a", "c", "d"]);
    // Moving down would put b between the two members of G.
    assert.equal(moveSceneStep(scenes, "b", 1), scenes);
  });
});

describe("splitScene", () => {
  /** Typed so the assertions read the split halves without casting. */
  type Split = {
    id: string;
    group: string | null;
    duration: number;
    narration: string;
    audio: { key: string; duration: number } | null;
  };

  const one: Split = {
    id: "a",
    group: null,
    duration: 8,
    narration: "one two three",
    audio: { key: "k", duration: 8 },
  };

  it("cuts a scene into two that keep the same total duration", () => {
    const out = splitScene<Split>([one], "a", 3, 0.5, () => "b");
    assert.equal(out.length, 2);
    assert.equal(out[0]!.duration, 3);
    assert.equal(out[1]!.duration, 5);
    assert.equal(out[0]!.duration + out[1]!.duration, 8);
  });

  it("gives the tail a new id and keeps the head's", () => {
    const out = splitScene<Split>([one], "a", 3, 0.5, () => "b");
    assert.equal(out[0]!.id, "a");
    assert.equal(out[1]!.id, "b");
  });

  it("keeps the group on both halves", () => {
    const out = splitScene<Split>([{ ...one, group: "G" }], "a", 3, 0.5, () => "b");
    assert.deepEqual([out[0]!.group, out[1]!.group], ["G", "G"]);
    // The run stays one run, not two sections with the same name.
    assert.equal(sceneRuns(out).length, 1);
  });

  it("does not replay the same audio on both halves", () => {
    // The clip belongs to the scene the author attached it to. Leaving it on the
    // tail would play the same words twice in a row.
    const out = splitScene<Split>([one], "a", 3, 0.5, () => "b");
    assert.deepEqual(out[0]!.audio, { key: "k", duration: 8 });
    assert.equal(out[1]!.audio, null);
  });

  it("keeps the clip on the head even when the cut is past its end", () => {
    // A 2s clip inside an 8s scene, cut at 6s: the clip is entirely in the
    // head. Moving it to the tail would lose it.
    const out = splitScene<Split>([{ ...one, audio: { key: "k", duration: 2 } }], "a", 6, 0.5, () => "b");
    assert.deepEqual(out[0]!.audio, { key: "k", duration: 2 });
    assert.equal(out[1]!.audio, null);
  });

  it("keeps the narration on both halves, for the author to edit", () => {
    const out = splitScene<Split>([one], "a", 3, 0.5, () => "b");
    assert.equal(out[0]!.narration, "one two three");
    assert.equal(out[1]!.narration, "one two three");
  });

  it("refuses a cut that would leave a sliver, returning the same array", () => {
    const scenes: Split[] = [one];
    assert.equal(splitScene(scenes, "a", 0.1), scenes);
    assert.equal(splitScene(scenes, "a", 7.9), scenes);
    assert.equal(splitScene(scenes, "a", 0), scenes);
    assert.equal(splitScene(scenes, "a", 8), scenes);
  });

  it("refuses an unknown id", () => {
    const scenes: Split[] = [one];
    assert.equal(splitScene(scenes, "zz", 4), scenes);
  });

  it("leaves the input array untouched", () => {
    const scenes: Split[] = [one];
    splitScene(scenes, "a", 3, 0.5, () => "b");
    assert.equal(scenes.length, 1);
  });
});

describe("moveRunTo", () => {
  it("moves a section to the front", () => {
    const scenes = [s("a", "A"), s("b", "A"), s("c", "B"), s("d", "B")];
    assert.deepEqual(order(moveRunTo(scenes, "c", 0)), ["c", "d", "a", "b"]);
  });

  it("moves a section to the end", () => {
    const scenes = [s("a", "A"), s("b", "A"), s("c", "B"), s("d", "B")];
    assert.deepEqual(order(moveRunTo(scenes, "a", 4)), ["c", "d", "a", "b"]);
  });

  it("swaps two whole sections rather than crossing them", () => {
    // The whole point: nothing lands inside another run.
    const scenes = [s("a", "A"), s("b", "A"), s("c", "B"), s("d", "B")];
    assert.deepEqual(order(moveRunTo(scenes, "a", 4)), ["c", "d", "a", "b"]);
  });

  it("places a section between two others", () => {
    const scenes = [s("a", "A"), s("b", "B"), s("c", "B"), s("d", "C")];
    assert.deepEqual(order(moveRunTo(scenes, "d", 1)), ["a", "d", "b", "c"]);
  });

  it("keeps every run whole after a long jump", () => {
    const scenes = [
      s("a", "A"),
      s("b", "B"),
      s("c", "B"),
      s("d", "C"),
      s("e", "C"),
      s("f", "D"),
    ];
    const after = moveRunTo(scenes, "d", 1);
    assert.deepEqual(order(after), ["a", "d", "e", "b", "c", "f"]);
    assert.deepEqual(
      sceneRuns(after).map((r) => r.group),
      ["A", "C", "B", "D"],
    );
  });

  it("is a no-op when dropped where it already is", () => {
    const scenes = [s("a", "A"), s("b", "A"), s("c", "B")];
    assert.equal(moveRunTo(scenes, "a", 0), scenes);
    assert.equal(moveRunTo(scenes, "a", 2), scenes);
  });

  it("is a no-op for an unknown id", () => {
    const scenes = [s("a", "A")];
    assert.equal(moveRunTo(scenes, "zz", 0), scenes);
  });

  it("moves a lone ungrouped run", () => {
    const scenes = [s("a", null), s("b", "B"), s("c", "B")];
    assert.deepEqual(order(moveRunTo(scenes, "a", 3)), ["b", "c", "a"]);
  });
});

describe("scenesOfRun", () => {
  it("returns the run holding the scene", () => {
    const scenes = [s("a", null), s("b", "G"), s("c", "G"), s("d", null)];
    assert.deepEqual(
      scenesOfRun(scenes, "c").map((x) => x.id),
      ["b", "c"],
    );
  });

  it("returns a whole ungrouped run as one", () => {
    const scenes = [s("a", "G"), s("b", null), s("c", null)];
    assert.deepEqual(
      scenesOfRun(scenes, "c").map((x) => x.id),
      ["b", "c"],
    );
  });

  it("falls back to the whole timeline for an unknown id", () => {
    // An empty export is a worse answer than the full one.
    const scenes = [s("a", "G"), s("b", "G")];
    assert.equal(scenesOfRun(scenes, "zz").length, 2);
  });
});

describe("sectionSlug", () => {
  it("builds a filename-safe suffix from the section name", () => {
    const scenes = [s("a", "The Message")];
    assert.equal(sectionSlug(scenes, "a"), "-the-message");
  });

  it("strips accents and punctuation", () => {
    const scenes = [s("a", "El Silencio — ¿de qué?")];
    assert.equal(sectionSlug(scenes, "a"), "-el-silencio-de-que");
  });

  it("is empty without a label, an id, or scenes", () => {
    assert.equal(sectionSlug([s("a", null)], "a"), "");
    assert.equal(sectionSlug([s("a", "G")], null), "");
    assert.equal(sectionSlug([], "a"), "");
  });

  it("bounds the length so a long name cannot become a long path segment", () => {
    const scenes = [s("a", "x".repeat(200))];
    assert.ok(sectionSlug(scenes, "a").length <= 41);
  });
});

describe("canMoveSceneStep", () => {
  it("agrees with what moveSceneStep would do", () => {
    const scenes = [s("a", "G"), s("b", "G"), s("c", null)];
    // The section can drop below the lone ungrouped scene…
    assert.equal(canMoveSceneStep(scenes, "a", 1), true);
    // …but it is already at the top.
    assert.equal(canMoveSceneStep(scenes, "a", -1), false);
    // The ungrouped scene cannot climb into the section, and there is no room
    // below it either, so both directions are refused.
    assert.equal(canMoveSceneStep(scenes, "c", -1), false);
    assert.equal(canMoveSceneStep(scenes, "c", 1), false);
  });

  it("is false for an unknown id", () => {
    assert.equal(canMoveSceneStep([s("a", null)], "zz", 1), false);
  });
});
