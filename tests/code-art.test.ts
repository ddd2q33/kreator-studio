import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BEAT_DEFAULT,
  BEAT_MAX,
  BEAT_MIN,
  CODE_MAX_CHARS,
  HOLD_DEFAULT,
  HOLD_MAX,
  HOLD_MIN,
  SPEED_DEFAULT,
  SPEED_MAX,
  SPEED_MIN,
  TYPING_SHARE,
  beatProgress,
  beatTiming,
  defaultProject,
  linesFor,
  newBeat,
  newScene,
  normalizeBeat,
  normalizeProject,
  normalizeScene,
  playableBeats,
  playableScenes,
  projectDuration,
  revealUnits,
  sceneAt,
  sceneSpeed,
  sceneTiming,
  styleById,
  timeline,
  visibleLines,
  type CodeBeat,
  type CodeProject,
  type CodeScene,
} from "../lib/code-art.ts";

const THREE_LINES = "const a = 1;\nconst b = 2;\nconst c = 3;";

/** A scene over a known three-line file, with one sub-scene keeping `lines`. */
function sceneWith(lines: number[], patch: Partial<CodeScene> = {}): CodeScene {
  return normalizeScene({
    code: THREE_LINES,
    language: "javascript",
    beats: [{ lines }],
    ...patch,
  });
}

function sceneOf(...beats: CodeBeat[]): CodeScene {
  const scene = newScene(THREE_LINES, "javascript");
  scene.beats = beats;
  return scene;
}

function projectOf(...scenes: CodeScene[]): CodeProject {
  return { ...defaultProject(), scenes };
}

describe("visibleLines", () => {
  it("returns the taken lines with their real file numbers", () => {
    const shown = visibleLines(sceneWith([2, 0]), newBeat([2, 0]));
    assert.deepEqual(
      shown.map((line) => [line.number, line.text]),
      [
        [3, "const c = 3;"],
        [1, "const a = 1;"],
      ],
    );
  });

  it("keeps the author's order rather than sorting it", () => {
    // A sub-scene showing a file's last line above its first is a legitimate
    // choice, and quietly re-sorting it would undo the decision it was made for.
    assert.deepEqual(
      visibleLines(sceneWith([2, 1, 0]), newBeat([2, 1, 0])).map((l) => l.number),
      [3, 2, 1],
    );
  });

  it("drops a line that no longer exists instead of substituting another", () => {
    // A wrong line of code in a tutorial is worse than a short one.
    assert.deepEqual(
      visibleLines(sceneWith([0, 99, 2]), newBeat([0, 99, 2])).map((l) => l.number),
      [1, 3],
    );
  });

  it("shows a repeated line once", () => {
    assert.equal(visibleLines(sceneWith([1, 1, 1]), newBeat([1, 1, 1])).length, 1);
  });

  it("keeps a blank line, because a blank line is part of the code", () => {
    const scene = normalizeScene({ code: "a();\n\nb();", beats: [{ lines: [0, 1, 2] }] });
    const shown = visibleLines(scene, newBeat([0, 1, 2]));
    assert.equal(shown.length, 3);
    assert.equal(shown[1].text, "");
  });
});

describe("linesFor", () => {
  it("gives the same array back for the same code, because it is per frame", () => {
    const scene = sceneWith([0]);
    assert.equal(linesFor(scene), linesFor(scene));
  });

  it("separates a cached javascript file from a cached python one", () => {
    const js = sceneWith([0]);
    const py = normalizeScene({ code: "a = 1", language: "python", beats: [{ lines: [0] }] });
    assert.notEqual(linesFor(js), linesFor(py));
  });
});

describe("normalizeBeat", () => {
  it("repairs a line index that points past the end of the file", () => {
    assert.deepEqual(normalizeBeat({ lines: [0, 4, -3] }, 2).lines, [0]);
  });

  it("truncates a fractional line index rather than rendering nothing", () => {
    assert.deepEqual(normalizeBeat({ lines: [1.7] }, 2).lines, [1]);
  });

  it("shows a repeated line once", () => {
    assert.deepEqual(normalizeBeat({ lines: [0, 0, 1] }, 3).lines, [0, 1]);
  });

  it("drops a mark that points past the lines being kept", () => {
    // Marks are positions in the kept list, so a stale one from before the lines
    // were re-picked has to go rather than light up an unrelated line.
    assert.deepEqual(normalizeBeat({ lines: [0], marks: [0, 4] }, 3).marks, [0]);
  });

  it("clamps a duration that would leave the sub-scene on screen for hours", () => {
    assert.equal(normalizeBeat({ duration: 99_999 }, 3).duration, BEAT_MAX);
    assert.equal(normalizeBeat({ duration: -4 }, 3).duration, BEAT_MIN);
  });

  it("gives a sub-scene that named no duration the default one", () => {
    // Nonsense in a duration field is survivable, and the default is a sane
    // value rather than a sub-scene nobody can see.
    assert.equal(normalizeBeat("nonsense", 3).duration, BEAT_DEFAULT);
  });
});

describe("normalizeScene", () => {
  it("shows the whole file when there are no sub-scenes", () => {
    // A first paste should show the whole file: the author narrows it after.
    const scene = normalizeScene({ code: "a\nb\nc\nd" });
    assert.equal(scene.beats.length, 1);
    assert.deepEqual(scene.beats[0].lines, [0, 1, 2, 3]);
  });

  it("has no sub-scene at all when there is no code", () => {
    assert.deepEqual(normalizeScene({}).beats, []);
  });

  it("falls back to plain text for a language with no grammar", () => {
    assert.equal(normalizeScene({ code: "a", language: "brainfuck" }).language, "text");
  });

  it("clamps a hold that would leave the scene on screen for hours", () => {
    assert.equal(normalizeScene({ code: "a", hold: 99_999 }).hold, HOLD_MAX);
    assert.equal(normalizeScene({ code: "a", hold: -4 }).hold, HOLD_MIN);
  });

  it("bounds a pasted file", () => {
    assert.equal(normalizeScene({ code: "x".repeat(CODE_MAX_CHARS + 500) }).code.length, CODE_MAX_CHARS);
  });

  it("normalises CRLF so line numbers match what the author sees", () => {
    assert.equal(normalizeScene({ code: "a\r\nb" }).code, "a\nb");
  });

  it("keeps a sub-scene with no lines, rather than deleting the pasted code", () => {
    // Un-ticking the last line must not take the pasted file with it.
    const scene = normalizeScene({ code: "a\nb", beats: [{ lines: [] }] });
    assert.equal(scene.beats[0].lines.length, 0);
    assert.equal(scene.code, "a\nb");
  });
});

describe("normalizeProject", () => {
  it("keeps a scene whose sub-scenes have no lines", () => {
    const project = normalizeProject({
      scenes: [
        { code: "a\nb", beats: [{ lines: [0] }] },
        { code: "c", beats: [{ lines: [] }] },
      ],
    });
    assert.equal(project.scenes.length, 2);
  });

  it("keeps the pasted code of a scene whose lines were all unticked", () => {
    const project = normalizeProject({ scenes: [{ code: "expensive paste", beats: [{ lines: [] }] }] });
    assert.equal(project.scenes[0].code, "expensive paste");
  });

  it("replaces an unknown style with a real one", () => {
    assert.equal(normalizeProject({ styleId: "hologram" }).styleId, "midnight");
  });

  it("survives a project that is not a project", () => {
    const project = normalizeProject("nonsense");
    assert.equal(project.scenes.length, 0);
    assert.equal(project.styleId, "midnight");
    assert.ok(project.id.length > 0);
  });

  it("reads the format ids the previous build wrote", () => {
    assert.equal(normalizeProject({ formatId: "landscape" }).formatId, "phone-horizontal");
    assert.equal(normalizeProject({ formatId: "vertical" }).formatId, "phone-vertical");
  });

  it("keeps a voice-over reference but drops a broken one", () => {
    assert.equal(
      normalizeProject({ audio: { key: "code_1", name: "v.wav", duration: 3 } }).audio?.key,
      "code_1",
    );
    assert.equal(normalizeProject({ audio: { name: "v.wav" } }).audio, null);
  });

  it("brings a take-based project forward without losing its lines", () => {
    // The old build kept a selection on the take itself. Migrating through
    // `normalizeScene` instead would show the whole file, which is the one thing
    // a person who had already cut their video would notice immediately.
    const project = normalizeProject({
      shots: [{ code: "a\nb\nc\nd", language: "javascript", lines: [1, 2], marks: [1] }],
    });
    assert.equal(project.scenes.length, 1);
    assert.deepEqual(project.scenes[0].beats[0].lines, [1, 2]);
    assert.deepEqual(project.scenes[0].beats[0].marks, [1]);
  });

  it("leaves a take that had ticked nothing empty, as it was invisible before", () => {
    const project = normalizeProject({ shots: [{ code: "a\nb", lines: [] }] });
    assert.deepEqual(project.scenes[0].beats[0].lines, []);
    assert.equal(playableScenes(project).length, 0);
  });
});

describe("playableScenes and the timeline", () => {
  it("leaves a scene with no lines out of the video", () => {
    // A scene being authored is not a scene on screen: it would hold the frame
    // for an empty panel.
    const project = projectOf(sceneWith([]), sceneWith([0]));
    assert.equal(playableScenes(project).length, 1);
  });

  it("gives an empty project no duration", () => {
    assert.equal(projectDuration(projectOf()), 0);
    assert.equal(projectDuration(projectOf(sceneWith([]))), 0);
  });

  it("lays the playable scenes end to end, skipping the empty ones", () => {
    const project = projectOf(sceneWith([]), sceneWith([0, 1]), sceneWith([2]));
    const marks = timeline(project);
    assert.equal(marks.length, 2);
    assert.equal(marks[0].start, 0);
    // Without the skip, the second scene would start after the first one's time
    // and the export would drift by a whole hold.
    assert.equal(marks[1].start, marks[0].total);
  });

  it("counts the project's duration from the playable scenes", () => {
    const project = projectOf(sceneWith([0]), sceneWith([1]));
    assert.equal(projectDuration(project), timeline(project)[0].total * 2);
  });
});

describe("sceneAt", () => {
  it("finds the scene and sub-scene playing at a time", () => {
    const first = sceneOf(newBeat([0], 2), newBeat([1], 3));
    const second = sceneOf(newBeat([2], 2));
    const project = projectOf(first, second);
    // Read the boundaries off the timing rather than guessing them: a sub-scene
    // is authored in seconds, and the hold after it is real time the second one
    // does not start inside.
    const timing = sceneTiming(first, project);
    const boundary = timing.beats[0].total;
    const afterScene = timing.total;
    assert.equal(sceneAt(project, 0)?.beatIndex, 0);
    assert.equal(sceneAt(project, boundary - 0.01)?.beatIndex, 0);
    assert.equal(sceneAt(project, boundary + 0.01)?.beatIndex, 1);
    assert.equal(sceneAt(project, afterScene + 0.01)?.scene.id, second.id);
  });

  it("indexes the playable scenes, matching the order the buttons are drawn in", () => {
    // The preview walks this index to decide which scene button is lit, so an
    // index into the full list would light the wrong button as soon as one scene
    // had no lines.
    const project = projectOf(sceneWith([]), sceneWith([0], { title: "kept" }));
    const found = sceneAt(project, 0);
    assert.equal(found?.index, 0);
    assert.equal(found?.scene.title, "kept");
  });

  it("gives an empty sub-scene no time in the middle of a scene", () => {
    // The third sub-scene is written but has no lines yet. It stays in the list,
    // where the author can fix it, and it does not get a second of empty panel.
    const scene = sceneOf(newBeat([0], 2), newBeat([], 5), newBeat([1], 2));
    const project = projectOf(scene);
    const timing = sceneTiming(scene, project);
    assert.equal(timing.beats.length, 3);
    assert.equal(timing.beats[1].total, 0);
    assert.equal(timing.beats[2].start, timing.beats[0].total);
    assert.equal(sceneAt(project, 2.5)?.beatIndex, 2);
  });

  it("holds the last sub-scene past the end instead of cutting to black", () => {
    const project = projectOf(sceneWith([0]));
    const found = sceneAt(project, projectDuration(project) + 5);
    assert.ok(found);
    assert.equal(found.index, 0);
    assert.equal(found.beatIndex, 0);
  });

  it("has nothing to show in a project with no playable scene", () => {
    assert.equal(sceneAt(projectOf(), 0), null);
    assert.equal(sceneAt(projectOf(sceneWith([])), 0), null);
  });
});

describe("sceneTiming and beatTiming", () => {
  it("adds the hold to the sub-scene lengths", () => {
    const project = projectOf(sceneWith([0]));
    const scene = project.scenes[0];
    const timing = sceneTiming(scene, project);
    const summed = timing.beats.reduce((acc, b) => acc + b.total, 0);
    assert.equal(timing.total, summed + timing.hold);
  });

  it("takes the hold from the scene and the speed from the project", () => {
    const project = projectOf(sceneWith([0], { hold: 3, speed: null }));
    assert.equal(sceneTiming(project.scenes[0], project).hold, 3);
    assert.equal(sceneSpeed(project.scenes[0], project), project.speed);
  });

  it("lets a scene override the project's typing speed", () => {
    const project = projectOf(sceneWith([0], { speed: 60 }));
    assert.equal(sceneSpeed(project.scenes[0], project), 60);
  });

  it("clamps a scene's speed into the legible range", () => {
    const project = projectOf(sceneWith([0], { speed: 10_000 }), sceneWith([1], { speed: 0 }));
    assert.equal(sceneSpeed(project.scenes[0], project), SPEED_MAX);
    assert.equal(sceneSpeed(project.scenes[1], project), SPEED_MIN);
  });

  it("gives a sub-scene the duration it was given", () => {
    // The authored number is the truth, and it is what makes a script portable:
    // a script that says two seconds gets two seconds, whatever was pasted into
    // the lines.
    const project = projectOf(sceneWith([0]));
    const scene = project.scenes[0];
    const beat = { ...scene.beats[0], duration: 6 };
    assert.equal(beatTiming(scene, beat, project).total, 6);
  });

  it("never types for longer than its share of the sub-scene", () => {
    // A one-second sub-scene of a long line types for three quarters of it and
    // finishes. Without the cap it would still be typing when the next one
    // started, and the two would overlap.
    const project = projectOf(sceneWith([0]));
    const scene = project.scenes[0];
    const slow = { ...project, speed: SPEED_MIN };
    const timing = beatTiming(scene, { ...scene.beats[0], duration: 1 }, slow);
    assert.ok(timing.typing <= 1 * TYPING_SHARE + 1e-9, `${timing.typing} should be under ${TYPING_SHARE}`);
  });

  it("types short code quickly and holds the rest of the sub-scene", () => {
    const project = projectOf(sceneWith([0]));
    const scene = project.scenes[0];
    const timing = beatTiming(scene, { ...scene.beats[0], duration: 8 }, project);
    assert.ok(timing.typing < 8);
  });

  it("types fewer characters in less time", () => {
    const project = projectOf(sceneWith([0]), sceneWith([0, 1]));
    const [short, long] = project.scenes.map((s) => beatTiming(s, s.beats[0], project));
    assert.ok(short.typing < long.typing, `${short.typing} should be under ${long.typing}`);
  });

  it("starts every sub-scene where the previous one ended", () => {
    const project = projectOf(sceneOf(newBeat([0], 2), newBeat([1], 3), newBeat([2], 4)));
    const scene = project.scenes[0];
    const timing = sceneTiming(scene, project);
    assert.equal(timing.beats[0].start, 0);
    assert.equal(timing.beats[1].start, timing.beats[0].total);
    assert.equal(timing.beats[2].start, timing.beats[0].total + timing.beats[1].total);
  });
});

describe("revealUnits", () => {
  it("is one unit per character for a typewriter", () => {
    const project = { ...defaultProject(), reveal: "typewriter" as const };
    const scene = sceneWith([0]);
    assert.equal(revealUnits(scene, scene.beats[0], project).length, "const a = 1;".length);
  });

  it("is one unit per line when lines land whole", () => {
    const project = { ...defaultProject(), reveal: "lines" as const };
    const scene = sceneWith([0, 1, 2]);
    assert.equal(revealUnits(scene, scene.beats[0], project).length, 3);
  });

  it("gives a blank line a unit, so the typing does not stall on it", () => {
    const project = { ...defaultProject(), reveal: "lines" as const };
    const scene = normalizeScene({ code: "a\n\nb", beats: [{ lines: [0, 1, 2] }] });
    assert.equal(revealUnits(scene, scene.beats[0], project).length, 3);
  });

  it("covers a token-revealed line completely", () => {
    // Whichever way the reveal steps, the finished line has to be the whole
    // line, or the last frame of the video is a truncated file.
    const project = { ...defaultProject(), reveal: "token" as const };
    const scene = sceneWith([0]);
    const units = revealUnits(scene, scene.beats[0], project);
    const covered = units.reduce((sum, u) => sum + (u.to - u.from), 0);
    assert.equal(covered, "const a = 1;".length);
  });

  it("has nothing to reveal in a sub-scene with no lines", () => {
    const project = defaultProject();
    const scene = sceneWith([]);
    assert.deepEqual(revealUnits(scene, scene.beats[0], project), []);
  });
});

describe("beatProgress", () => {
  it("reveals nothing at the start and everything at the end of the typing", () => {
    const project = projectOf(sceneWith([0]));
    const scene = project.scenes[0];
    const beat = scene.beats[0];
    const timing = beatTiming(scene, beat, project);
    assert.equal(beatProgress(scene, beat, project, 0).done, 0);
    assert.equal(beatProgress(scene, beat, project, timing.typing).done, timing.units);
  });

  it("is partway through a unit mid-type", () => {
    const project = projectOf(sceneWith([0]));
    const scene = project.scenes[0];
    const beat = scene.beats[0];
    const timing = beatTiming(scene, beat, project);
    // Halfway through the *twelfth* unit, not halfway through the sub-scene: half
    // of an even number of units lands exactly on a boundary, where the partial
    // is legitimately zero and the test would prove nothing.
    const local = timing.typing * (timing.units * 0.5 + 0.5) / timing.units;
    const mid = beatProgress(scene, beat, project, local);
    assert.equal(mid.done, Math.floor(timing.units * 0.5));
    assert.equal(mid.partial, 0.5);
  });

  it("stays complete through the rest of the sub-scene", () => {
    // The rest of the authored length is reading time. If progress fell back
    // during it, the code would start un-typing while the viewer was still
    // reading it.
    const project = projectOf(sceneWith([0]));
    const scene = project.scenes[0];
    const beat = scene.beats[0];
    const timing = beatTiming(scene, beat, project);
    const at = beatProgress(scene, beat, project, timing.total);
    assert.equal(at.done, timing.units);
    assert.equal(at.partial, 0);
  });

  it("clamps a time outside the sub-scene", () => {
    const project = projectOf(sceneWith([0]));
    const scene = project.scenes[0];
    const beat = scene.beats[0];
    assert.equal(beatProgress(scene, beat, project, -5).done, 0);
    assert.equal(beatProgress(scene, beat, project, 9_999).partial, 0);
  });
});

describe("playableBeats", () => {
  it("leaves out the sub-scenes with nothing on screen", () => {
    const scene = sceneOf(newBeat([0]), newBeat([]), newBeat([1]));
    assert.equal(playableBeats(scene).length, 2);
  });
});

describe("the defaults", () => {
  it("opens on a dark editor, a typewriter and a phone held upright", () => {
    const project = defaultProject();
    assert.equal(project.styleId, "midnight");
    assert.equal(project.reveal, "typewriter");
    assert.equal(project.formatId, "phone-vertical");
    assert.equal(project.speed, SPEED_DEFAULT);
    assert.equal(project.scenes.length, 0);
    assert.equal(project.audio, null);
  });

  it("gives two projects different ids", () => {
    // A rename must not be able to orphan a project's stored voice-over.
    assert.notEqual(defaultProject().id, defaultProject().id);
  });

  it("shows the whole file in a new scene", () => {
    const scene = newScene("a\nb\nc");
    assert.deepEqual(scene.beats[0].lines, [0, 1, 2]);
    assert.equal(scene.hold, HOLD_DEFAULT);
  });

  it("has no sub-scene in a new scene over no code", () => {
    assert.deepEqual(newScene("").beats, []);
  });

  it("falls back to midnight for an unknown style", () => {
    assert.equal(styleById("hologram").id, "midnight");
  });
});
