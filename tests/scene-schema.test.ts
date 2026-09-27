import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_BRAND,
  DEFAULT_VOICE_ID,
  SCENE_FORMAT_VERSION,
  normalizeFirstScene,
  normalizeScene,
  normalizeSceneDocument,
  normalizeScenes,
  normalizeVoiceConfig,
} from "../lib/scene-schema.ts";

/** Deterministic id factory so ids can be asserted without stubbing Date/Math. */
let counter = 0;
const newId = () => `scene-test-${++counter}`;

const resetIds = () => {
  counter = 0;
};

describe("normalizeVoiceConfig", () => {
  it("falls back to defaults for missing or non-object input", () => {
    for (const input of [undefined, null, 42, "voice", []]) {
      const { voice, warnings } = normalizeVoiceConfig(input);
      assert.equal(voice.voiceId, DEFAULT_VOICE_ID);
      assert.equal(warnings.length, 0);
    }
  });

  it("clamps the 0-1 sliders instead of trusting the file", () => {
    const { voice } = normalizeVoiceConfig({
      voiceId: "custom",
      stability: 5,
      similarity: -2,
      style: 0.42,
    });
    assert.equal(voice.voiceId, "custom");
    assert.equal(voice.stability, 1);
    assert.equal(voice.similarity, 0);
    assert.equal(voice.style, 0.42);
  });

  it("rejects unknown models and says so", () => {
    const { voice, warnings } = normalizeVoiceConfig({ modelId: "gpt-4" });
    assert.equal(voice.modelId, "eleven_multilingual_v2");
    assert.match(warnings.join(" "), /unknown ElevenLabs model "gpt-4"/);
  });

  it("keeps every known model id", () => {
    for (const modelId of [
      "eleven_multilingual_v2",
      "eleven_flash_v2_5",
      "eleven_turbo_v2_5",
    ]) {
      const { voice, warnings } = normalizeVoiceConfig({ modelId });
      assert.equal(voice.modelId, modelId);
      assert.equal(warnings.length, 0);
    }
  });

  it("treats a blank voice id as absent", () => {
    const { voice } = normalizeVoiceConfig({ voiceId: "   " });
    assert.equal(voice.voiceId, DEFAULT_VOICE_ID);
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
    assert.equal(scene.voice.voiceId, DEFAULT_VOICE_ID);
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

  it("warns when narration exceeds the TTS limit", () => {
    const { warnings } = normalizeScene(
      { title: "A", narration: "x".repeat(5001) },
      0,
      { newId },
    );
    assert.match(warnings.join(" "), /over 5000/);
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
          voice: {
            voiceId: "EXAVITQu4vr4xnSDxMaL",
            modelId: "eleven_flash_v2_5",
            stability: 0.25,
            similarity: 0.9,
            style: 0,
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
      voice: { stability: 9 },
    });
    assert.equal(scene?.duration, 20);
    assert.equal(scene?.transition, "fade");
    assert.equal(scene?.voice.stability, 1);
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
