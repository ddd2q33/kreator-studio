import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_BRAND,
  SCENE_FORMAT_VERSION,
  normalizeFirstScene,
  normalizeScene,
  normalizeSceneAudio,
  normalizeSceneDocument,
  normalizeSceneInput,
  normalizeScenes,
} from "../lib/scene-schema.ts";

/** Deterministic id factory so ids can be asserted without stubbing Date/Math. */
let counter = 0;
const newId = () => `scene-test-${++counter}`;

const resetIds = () => {
  counter = 0;
};

describe("normalizeSceneAudio", () => {
  it("treats missing, empty or non-object input as no audio", () => {
    for (const input of [undefined, null, 42, "clip", [], {}, { key: "  " }]) {
      const { audio, warnings } = normalizeSceneAudio(input);
      assert.equal(audio, null);
      assert.equal(warnings.length, 0);
    }
  });

  it("keeps a descriptor and rounds its numbers", () => {
    const { audio, warnings } = normalizeSceneAudio({
      key: "clip-1",
      name: "vo.wav",
      duration: 7.126,
      bytes: 1234.6,
      type: "audio/wav",
    });
    assert.deepEqual(audio, {
      key: "clip-1",
      name: "vo.wav",
      duration: 7.13,
      bytes: 1235,
      type: "audio/wav",
      regions: [],
    });
    assert.equal(warnings.length, 0);
  });

  it("keeps measured speech regions and rounds them", () => {
    const { audio } = normalizeSceneAudio({
      key: "clip-r",
      regions: [
        { start: 0, end: 2.456 },
        { start: 2.9, end: 5 },
      ],
    });
    assert.deepEqual(audio?.regions, [
      { start: 0, end: 2.46 },
      { start: 2.9, end: 5 },
    ]);
  });

  it("drops regions that would break the word aligner", () => {
    const { audio } = normalizeSceneAudio({
      key: "clip-bad",
      regions: [
        { start: 1, end: 1 },      // zero length
        { start: 2, end: 1 },      // reversed
        "nope",                     // not a region at all
        { start: 4, end: 6 },
        { start: 5, end: 7 },      // overlaps the previous one
        { start: 8, end: 9 },
      ],
    });
    assert.deepEqual(audio?.regions, [
      { start: 4, end: 6 },
      { start: 8, end: 9 },
    ]);
  });

  it("fills in a name and type when the file did not report them", () => {
    const { audio } = normalizeSceneAudio({ key: "clip-2" });
    assert.equal(audio?.name, "clip-2");
    assert.equal(audio?.type, "audio/mpeg");
    assert.equal(audio?.duration, 0);
    assert.equal(audio?.bytes, 0);
  });

  it("never lets a negative or non-numeric length through", () => {
    const { audio } = normalizeSceneAudio({
      key: "clip-3",
      duration: -5,
      bytes: "not a number",
    });
    assert.equal(audio?.duration, 0);
    assert.equal(audio?.bytes, 0);
  });

  it("clears a clip the browser no longer holds, and says so", () => {
    const { audio, warnings } = normalizeSceneAudio(
      { key: "clip-gone", duration: 3 },
      { audioKeys: ["clip-1", "clip-2"] },
    );
    assert.equal(audio, null);
    assert.match(warnings.join(" "), /no longer in browser storage/);
  });

  it("keeps a clip that is present in storage", () => {
    const { audio, warnings } = normalizeSceneAudio(
      { key: "clip-1", duration: 3 },
      { audioKeys: ["clip-1"] },
    );
    assert.equal(audio?.key, "clip-1");
    assert.equal(warnings.length, 0);
  });
});

describe("normalizeScene", () => {
  it("fills every field from a title-only scene", () => {
    const { scene, warnings } = normalizeScene({ title: "The threshold" }, 0, {
      newId,
    });
    assert.ok(scene);
    assert.equal(scene.title, "The threshold");
    assert.equal(scene.kicker, "");
    assert.equal(scene.subtitle, "");
    assert.equal(scene.narration, "");
    assert.equal(scene.imageKey, null);
    assert.equal(scene.chapterId, null);
    assert.equal(scene.duration, 4);
    assert.equal(scene.transition, "fade");
    assert.equal(scene.audio, null);
    assert.equal(warnings.length, 0);
  });

  it("keeps a scene with no title as a blank frame and reports it", () => {
    const { scene, warnings } = normalizeScene({ subtitle: "orphan" }, 0, {
      newId,
    });
    // Scenes are authored blank, so a missing title must not drop the scene:
    // the per-scene JSON editor round-trips through this function.
    assert.notEqual(scene, null);
    assert.equal(scene?.title, "");
    assert.equal(scene?.subtitle, "orphan");
    assert.match(warnings.join(" "), /Scene 1 has no "title"/);
  });

  it("still drops an entry that is not an object", () => {
    const { scene, warnings } = normalizeScene("nope", 0, { newId });
    assert.equal(scene, null);
    assert.match(warnings.join(" "), /is not an object/);
  });

  it("round-trips a brand new blank scene through the document pipeline", () => {
    // What the per-scene JSON editor does: take the current scene object and
    // push it back through normalizeSceneDocument. A new scene has an empty
    // title, and that used to be rejected with
    // 'A scene needs at least a "title" field.'
    const blank = {
      id: "scene-1",
      group: null,
      kicker: "",
      title: "",
      subtitle: "",
      narration: "Hola",
      imageKey: null,
      duration: 4,
      transition: "fade",
    };
    const { document } = normalizeSceneDocument({ scenes: [blank] }, { newId });
    assert.notEqual(document, null);
    assert.equal(document?.scenes.length, 1);
    assert.equal(document?.scenes[0]?.title, "");
    assert.equal(document?.scenes[0]?.narration, "Hola");
  });

  it("keeps a valid id and only generates a missing one", () => {
    resetIds();
    const kept = normalizeScene({ id: "mine", title: "A" }, 0, { newId });
    assert.equal(kept.scene?.id, "mine");
    const made = normalizeScene({ title: "B" }, 0, { newId });
    assert.equal(made.scene?.id, "scene-test-1");
  });

  it("clamps duration into the slider range", () => {
    const short = normalizeScene({ title: "A", duration: 0 }, 0, { newId });
    assert.equal(short.scene?.duration, 1);
    assert.match(short.warnings.join(" "), /clamped to 1s/);

    const long = normalizeScene({ title: "A", duration: 99 }, 0, { newId });
    assert.equal(long.scene?.duration, 20);

    const ok = normalizeScene({ title: "A", duration: 4.5 }, 0, { newId });
    assert.equal(ok.scene?.duration, 4.5);
    assert.equal(ok.warnings.length, 0);
  });

  it("accepts numeric strings for duration", () => {
    const { scene, warnings } = normalizeScene({ title: "A", duration: "7.5" }, 0, {
      newId,
    });
    assert.equal(scene?.duration, 7.5);
    assert.equal(warnings.length, 0);
  });

  it("falls back to 4s on an unreadable duration", () => {
    const { scene, warnings } = normalizeScene(
      { title: "A", duration: "four" },
      0,
      { newId },
    );
    assert.equal(scene?.duration, 4);
    assert.match(warnings.join(" "), /unreadable duration/);
  });

  it("rejects unknown transitions", () => {
    const { scene, warnings } = normalizeScene(
      { title: "A", transition: "dissolve" },
      0,
      { newId },
    );
    assert.equal(scene?.transition, "fade");
    assert.match(warnings.join(" "), /unknown transition "dissolve"/);
  });

  it("clears an imageKey that is not in the current image map", () => {
    const { scene, warnings } = normalizeScene(
      { title: "A", imageKey: "missing.png" },
      0,
      { imageKeys: ["cover.png"], newId },
    );
    assert.equal(scene?.imageKey, null);
    assert.match(warnings.join(" "), /not in the current image map/);
  });

  it("keeps an imageKey that exists, and skips the check when no map is given", () => {
    const known = normalizeScene(
      { title: "A", imageKey: "cover.png" },
      0,
      { imageKeys: ["cover.png"], newId },
    );
    assert.equal(known.scene?.imageKey, "cover.png");
    assert.equal(known.warnings.length, 0);

    const unchecked = normalizeScene(
      { title: "A", imageKey: "whatever.png" },
      0,
      { newId },
    );
    assert.equal(unchecked.scene?.imageKey, "whatever.png");
  });

  it("defaults imageFit, volume and mute for a scene that omits them", () => {
    // This is the path every project saved before these fields existed takes on
    // reload, so the defaults are what keeps an old project looking unchanged.
    const scene = normalizeScene({ title: "A" }, 0, { newId }).scene;
    assert.equal(scene?.imageFit, "contain");
    assert.equal(scene?.volume, 1);
    assert.equal(scene?.muted, false);
  });

  it("keeps a known imageFit and rejects an unknown one", () => {
    assert.equal(
      normalizeScene({ title: "A", imageFit: "cover" }, 0, { newId }).scene?.imageFit,
      "cover",
    );
    assert.equal(
      normalizeScene({ title: "A", imageFit: "stretch" }, 0, { newId }).scene?.imageFit,
      "contain",
    );
  });

  it("clamps a volume outside 0..1 rather than rejecting the scene", () => {
    assert.equal(normalizeScene({ title: "A", volume: 3 }, 0, { newId }).scene?.volume, 1);
    assert.equal(normalizeScene({ title: "A", volume: -1 }, 0, { newId }).scene?.volume, 0);
    assert.equal(
      normalizeScene({ title: "A", volume: "0.5" }, 0, { newId }).scene?.volume,
      0.5,
    );
  });

  it("reads mute from a boolean true only", () => {
    assert.equal(normalizeScene({ title: "A", muted: true }, 0, { newId }).scene?.muted, true);
    assert.equal(normalizeScene({ title: "A", muted: "yes" }, 0, { newId }).scene?.muted, false);
  });

  it("passes a group's imageFit, volume and mute down to its subscenes", () => {
    const { scenes } = normalizeScenes(
      [
        {
          scene: "Section",
          imageFit: "cover",
          volume: 0.5,
          muted: true,
          subscenes: [{ title: "one" }, { title: "two" }],
        },
      ],
      { newId },
    );
    assert.equal(scenes.length, 2);
    for (const scene of scenes) {
      assert.equal(scene.imageFit, "cover");
      assert.equal(scene.volume, 0.5);
      assert.equal(scene.muted, true);
    }
  });

  it("lets a subscene override the group's imageFit and volume", () => {
    const { scenes } = normalizeScenes(
      [
        {
          scene: "Section",
          imageFit: "cover",
          volume: 0.5,
          subscenes: [{ title: "one" }, { title: "two", imageFit: "fill", volume: 1 }],
        },
      ],
      { newId },
    );
    assert.equal(scenes[0]?.imageFit, "cover");
    assert.equal(scenes[0]?.volume, 0.5);
    assert.equal(scenes[1]?.imageFit, "fill");
    assert.equal(scenes[1]?.volume, 1);
  });

  it("treats an empty imageKey as null", () => {
    const { scene } = normalizeScene({ title: "A", imageKey: "  " }, 0, {
      newId,
    });
    assert.equal(scene?.imageKey, null);
  });

  it("flags a chapterId that matches no chapter", () => {
    const { scene, warnings } = normalizeScene(
      { title: "A", chapterId: "ch-9" },
      0,
      { chapterIds: ["ch-1"], newId },
    );
    assert.equal(scene?.chapterId, "ch-9");
    assert.match(warnings.join(" "), /matches no chapter/);
  });

  it("accepts a chapterId that exists", () => {
    const { scene, warnings } = normalizeScene(
      { title: "A", chapterId: "ch-1" },
      0,
      { chapterIds: ["ch-1"], newId },
    );
    assert.equal(scene?.chapterId, "ch-1");
    assert.equal(warnings.length, 0);
  });

  it("warns when narration is unusually long", () => {
    const { warnings } = normalizeScene(
      { title: "A", narration: "x".repeat(5001) },
      0,
      { newId },
    );
    assert.match(warnings.join(" "), /trimmed to 5000/);
  });

  it("survives a non-object scene", () => {
    const { scene, warnings } = normalizeScene("nope", 3, { newId });
    assert.equal(scene, null);
    assert.match(warnings.join(" "), /Scene 4 is not an object/);
  });
});

describe("normalizeScenes", () => {
  it("keeps the good scenes and reports the dropped ones", () => {
    const { scenes, warnings } = normalizeScenes(
      [{ title: "One" }, "not an object", { title: "Two" }],
      { newId },
    );
    assert.equal(scenes.length, 2);
    assert.equal(scenes[0]?.title, "One");
    assert.equal(scenes[1]?.title, "Two");
    assert.equal(warnings.length, 1);
  });

  it("keeps a title-less scene and only warns about it", () => {
    const { scenes, warnings } = normalizeScenes(
      [{ title: "One" }, { subtitle: "blank title" }],
      { newId },
    );
    assert.equal(scenes.length, 2);
    assert.equal(scenes[1]?.title, "");
    assert.equal(scenes[1]?.subtitle, "blank title");
    assert.match(warnings.join(" "), /has no "title"/);
  });

  it("leaves kickers empty instead of numbering them by position", () => {
    const { scenes } = normalizeScenes([{ title: "A" }, { title: "B" }], {
      newId,
    });
    assert.equal(scenes[0]?.kicker, "");
    assert.equal(scenes[1]?.kicker, "");
  });

  it("keeps an explicit kicker verbatim, without renumbering it", () => {
    const { scenes } = normalizeScenes(
      [{ title: "A" }, { title: "B", kicker: "CHAPTER" }],
      { newId },
    );
    assert.equal(scenes[0]?.kicker, "");
    assert.equal(scenes[1]?.kicker, "CHAPTER");
  });

  it("rejects a non-array", () => {
    const { scenes, warnings } = normalizeScenes({ title: "A" });
    assert.deepEqual(scenes, []);
    assert.match(warnings.join(" "), /not an array/);
  });

  it("reports when nothing is usable", () => {
    // Only non-object entries are unusable now; a title-less object is kept.
    const { scenes, warnings } = normalizeScenes(["nope", 7, null], { newId });
    assert.deepEqual(scenes, []);
    assert.match(warnings.join(" "), /No usable scenes found/);
  });
});

describe("normalizeSceneDocument", () => {
  it("accepts the smallest useful file", () => {
    const { document, warnings } = normalizeSceneDocument({
      scenes: [{ title: "Only this" }],
    });
    assert.ok(document);
    assert.equal(document.version, SCENE_FORMAT_VERSION);
    assert.equal(document.brand, DEFAULT_BRAND);
    assert.equal(document.portrait, false);
    assert.equal(document.scenes.length, 1);
    assert.equal(warnings.length, 0);
  });

  it("accepts a bare array of scenes", () => {
    const { document } = normalizeSceneDocument([{ title: "A" }, { title: "B" }]);
    assert.equal(document?.scenes.length, 2);
  });

  it("round-trips its own output unchanged", () => {
    const first = normalizeSceneDocument({
      version: 1,
      brand: "#ff0000",
      portrait: true,
      scenes: [
        {
          id: "keep-me",
          chapterId: "ch-2",
          kicker: "CHAPTER",
          title: "Round trip",
          subtitle: "sub",
          narration: "narration",
          imageKey: null,
          duration: 6.25,
          transition: "zoom",
          audio: {
            key: "clip-rt",
            name: "vo.wav",
            duration: 6.25,
            bytes: 2048,
            type: "audio/wav",
          },
        },
      ],
    });
    const second = normalizeSceneDocument(JSON.parse(JSON.stringify(first.document)));
    assert.deepEqual(second.document, first.document);
    assert.deepEqual(second.warnings, []);
  });

  it("rejects a bad brand colour but keeps the file", () => {
    const { document, warnings } = normalizeSceneDocument({
      brand: "teal",
      scenes: [{ title: "A" }],
    });
    assert.equal(document?.brand, DEFAULT_BRAND);
    assert.match(warnings.join(" "), /not a hex color/);
  });

  it("keeps 3 and 6 digit hex brands", () => {
    for (const brand of ["#abc", "#A1B2C3"]) {
      const { document } = normalizeSceneDocument({
        brand,
        scenes: [{ title: "A" }],
      });
      assert.equal(document?.brand, brand);
    }
  });

  it("warns about a newer file version but still imports", () => {
    const { document, warnings } = normalizeSceneDocument({
      version: 99,
      scenes: [{ title: "A" }],
    });
    assert.equal(document?.scenes.length, 1);
    assert.match(warnings.join(" "), /this build understands v1/);
  });

  it("returns null with a reason for unusable input", () => {
    for (const input of [null, "text", 42]) {
      const { document, warnings } = normalizeSceneDocument(input);
      assert.equal(document, null);
      assert.match(warnings.join(" "), /must be an object/);
    }
  });

  it("returns null when every scene is dropped", () => {
    const { document, warnings } = normalizeSceneDocument({ scenes: [] });
    assert.equal(document, null);
    assert.match(warnings.join(" "), /not an array|No usable scenes/);
  });
});

describe("normalizeSceneInput", () => {
  it("reads an object with a scenes array as a whole document", () => {
    // The bug this guards: wrapping a pasted document as one scene made the
    // top-level `scenes` key an unknown field, so a 32-scene episode collapsed
    // into a single blank frame.
    resetIds();
    const { document, warnings } = normalizeSceneInput({
      episode: "An episode",
      scenes: [
        { scene: "One", subscenes: [{ narration: "a" }, { narration: "b" }] },
        { scene: "Two", subscenes: [{ narration: "c" }] },
      ],
    });
    assert.deepEqual(warnings, []);
    assert.equal(document?.scenes.length, 3);
  });

  it("reads any other object as a single scene", () => {
    const { document, warnings } = normalizeSceneInput({
      title: "Just one",
      duration: 5,
    });
    assert.deepEqual(warnings, []);
    assert.equal(document?.scenes.length, 1);
    assert.equal(document?.scenes[0]?.title, "Just one");
    assert.equal(document?.scenes[0]?.duration, 5);
  });

  it("reads a grouped object as one section", () => {
    const { document, warnings } = normalizeSceneInput({
      scene: "A section",
      subscenes: [{ narration: "a" }, { narration: "b" }],
    });
    assert.deepEqual(warnings, []);
    assert.equal(document?.scenes.length, 2);
  });

  it("rejects a bare array with a message that says what to do", () => {
    const { document, warnings } = normalizeSceneInput([{ title: "A" }]);
    assert.equal(document, null);
    assert.match(warnings.join(" "), /not a bare array/);
  });

  it("rejects a primitive", () => {
    for (const input of [null, 7, "text", true]) {
      const { document, warnings } = normalizeSceneInput(input);
      assert.equal(document, null);
      assert.match(warnings.join(" "), /must be a JSON object/);
    }
  });
});

describe("grouped scene documents", () => {
  it("expands one object with subscenes into a whole run", () => {
    resetIds();
    const { document, warnings } = normalizeSceneDocument({
      scenes: [
        {
          scene: "The Silence",
          subscenes: [
            { narration: "one", duration: 2 },
            { narration: "two", duration: 3 },
            { narration: "three", duration: 6 },
          ],
        },
      ],
    });
    assert.equal(document?.scenes.length, 3);
    assert.deepEqual(
      document?.scenes.map((s) => s.group),
      ["The Silence", "The Silence", "The Silence"],
    );
    assert.deepEqual(
      document?.scenes.map((s) => s.duration),
      [2, 3, 6],
    );
    assert.deepEqual(warnings, []);
  });

  it("does not warn about the missing subscene titles", () => {
    // A grouped subscene is titled blank by design: the section header carries
    // the name. Warning about each one buried the warnings that do matter.
    const { document, warnings } = normalizeSceneDocument({
      scenes: [
        {
          scene: "The Silence",
          subscenes: [{ narration: "one" }, { narration: "two" }],
        },
      ],
    });
    assert.equal(document?.scenes.length, 2);
    assert.deepEqual(warnings, []);
  });

  it("gives every subscene a distinct id", () => {
    resetIds();
    const { document } = normalizeSceneDocument(
      {
        scenes: [
          {
            scene: "The Silence",
            subscenes: [{ narration: "one" }, { narration: "two" }],
          },
        ],
      },
      { newId },
    );
    const ids = document?.scenes.map((s) => s.id) ?? [];
    assert.equal(new Set(ids).size, ids.length);
  });

  it("puts the section name on the first subscene so the header agrees with it", () => {
    const { document } = normalizeSceneDocument({
      scenes: [
        {
          scene: "The Silence",
          subscenes: [{ narration: "one" }, { narration: "two" }],
        },
      ],
    });
    assert.equal(document?.scenes[0]?.title, "The Silence");
    assert.equal(document?.scenes[1]?.title, "");
  });

  it("lets a subscene override the section and start its own run", () => {
    const { document } = normalizeSceneDocument({
      scenes: [
        {
          scene: "The Silence",
          subscenes: [
            { narration: "one" },
            { group: "Aside", narration: "two" },
            { narration: "three" },
          ],
        },
      ],
    });
    assert.deepEqual(
      document?.scenes.map((s) => s.group),
      ["The Silence", "Aside", "The Silence"],
    );
  });

  it("keeps a usable subscene when a sibling is not an object", () => {
    const { document, warnings } = normalizeSceneDocument({
      scenes: [
        {
          scene: "The Silence",
          subscenes: [{ narration: "one" }, "junk", { narration: "two" }],
        },
      ],
    });
    assert.equal(document?.scenes.length, 2);
    assert.match(warnings.join(" "), /is not an object/);
  });

  it("reports a group whose subscenes are all unusable", () => {
    const { document, warnings } = normalizeSceneDocument({
      scenes: [{ scene: "The Silence", subscenes: ["junk", 7] }],
    });
    assert.equal(document, null);
    assert.match(warnings.join(" "), /no usable subscenes/);
  });

  it("falls back to a section name when the group has none", () => {
    const { document } = normalizeSceneDocument({
      scenes: [{ subscenes: [{ narration: "one" }] }],
    });
    assert.equal(document?.scenes[0]?.group, "Section 1");
  });

  it("expands an episode document of grouped sections", () => {
    resetIds();
    const { document, warnings } = normalizeSceneDocument({
      episode: "She Thought She Was Too Needy",
      scenes: [
        {
          scene: "The Silence",
          subscenes: [
            { narration: "She checked her phone again...", duration: 2 },
            { narration: "But silence felt louder than words.", duration: 3 },
          ],
        },
        {
          scene: "The Message",
          subscenes: [
            { narration: "Then finally...", duration: 2 },
            { narration: "A message appeared.", duration: 2 },
            { narration: "Goodnight.", duration: 4 },
          ],
        },
      ],
    });
    assert.equal(document?.scenes.length, 5);
    assert.deepEqual(
      document?.scenes.map((s) => s.group),
      [
        "The Silence",
        "The Silence",
        "The Message",
        "The Message",
        "The Message",
      ],
    );
    // The episode title is not part of the scene model, so it is ignored
    // quietly rather than reported as a problem with the file.
    assert.deepEqual(warnings, []);
  });

  it("keeps section runs in document order", () => {
    const { document } = normalizeSceneDocument({
      episode: "Two acts",
      scenes: [
        { scene: "Act I", subscenes: [{ narration: "a" }] },
        { scene: "Act II", subscenes: [{ narration: "b" }] },
        { scene: "Act III", subscenes: [{ narration: "c" }] },
      ],
    });
    assert.deepEqual(
      document?.scenes.map((s) => s.group),
      ["Act I", "Act II", "Act III"],
    );
    assert.deepEqual(
      document?.scenes.map((s) => s.narration),
      ["a", "b", "c"],
    );
  });
});

describe("normalizeFirstScene", () => {
  it("reads a bare single scene object", () => {
    const { scene, totalScenes, warnings } = normalizeFirstScene(
      { title: "Dropped on card" },
      { newId },
    );
    assert.equal(scene?.title, "Dropped on card");
    assert.equal(totalScenes, 1);
    assert.equal(warnings.length, 0);
  });

  it("reads a one-element array", () => {
    const { scene, totalScenes } = normalizeFirstScene([{ title: "From array" }], {
      newId,
    });
    assert.equal(scene?.title, "From array");
    assert.equal(totalScenes, 1);
  });

  it("reads the first scene of an exported document", () => {
    const { scene, totalScenes } = normalizeFirstScene({
      version: 1,
      brand: "#0d9488",
      portrait: true,
      scenes: [{ title: "One" }, { title: "Two" }],
    });
    assert.equal(scene?.title, "One");
    assert.equal(totalScenes, 2);
  });

  it("uses the first scene and reports the rest when several are present", () => {
    const { scene, totalScenes, warnings } = normalizeFirstScene({
      scenes: [{ title: "One" }, { title: "Two" }, { title: "Three" }],
    });
    assert.equal(scene?.title, "One");
    assert.equal(totalScenes, 3);
    assert.match(warnings.join(" "), /held 3 scenes — only the first was applied/);
  });

  it("does not confuse a document for a single scene", () => {
    const { scene, totalScenes } = normalizeFirstScene({
      scenes: [{ title: "Real" }],
    });
    assert.equal(scene?.title, "Real");
    assert.equal(totalScenes, 1);
  });

  it("repairs the dropped scene the same way as an import", () => {
    const { scene, warnings } = normalizeFirstScene({
      title: "A",
      duration: 99,
      transition: "dissolve",
      audio: { key: "clip-x", duration: -3, bytes: "nope" },
    });
    assert.equal(scene?.duration, 20);
    assert.equal(scene?.transition, "fade");
    assert.equal(scene?.audio?.key, "clip-x");
    assert.equal(scene?.audio?.duration, 0);
    assert.equal(scene?.audio?.bytes, 0);
    assert.match(warnings.join(" "), /clamped to 20s/);
  });

  it("returns null for an unusable drop", () => {
    for (const input of [null, "text", 7, [[]], [3, "x"]]) {
      const { scene, totalScenes } = normalizeFirstScene(input);
      assert.equal(scene, null);
      assert.equal(totalScenes, 0);
    }
  });

  it("accepts a blank first scene instead of rejecting the drop", () => {
    const { scene, totalScenes } = normalizeFirstScene({ title: "" });
    assert.notEqual(scene, null);
    assert.equal(scene?.title, "");
    assert.equal(totalScenes, 1);
  });
});
