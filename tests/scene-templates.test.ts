import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_SCENE_JSON_TEMPLATE_ID,
  SCENE_JSON_TEMPLATES,
  sceneJsonTemplate,
} from "../lib/scene-templates.ts";
import { normalizeSceneInput } from "../lib/scene-schema.ts";
import { groupLabels } from "../lib/scene-groups.ts";

/** Imports a template the way the Scene JSON editor does. */
const applyTemplate = (id: string) => {
  const t = sceneJsonTemplate(id);
  assert.ok(t, `${id} is not a template`);
  return normalizeSceneInput(JSON.parse(t.json));
};

describe("scene JSON templates", () => {
  it("every template is a JSON object with a label and a hint", () => {
    for (const t of SCENE_JSON_TEMPLATES) {
      assert.ok(t.id.length > 0, "template is missing an id");
      assert.ok(t.label.length > 0, `${t.id} is missing a label`);
      assert.ok(t.hint.length > 0, `${t.id} is missing a hint`);
      const parsed = JSON.parse(t.json) as unknown;
      assert.equal(typeof parsed, "object", `${t.id} is not a JSON object`);
      assert.notEqual(parsed, null, `${t.id} parsed as null`);
      assert.ok(
        !Array.isArray(parsed),
        `${t.id} is an array, but the editor rejects bare arrays`,
      );
    }
  });

  it("every template imports without warnings and yields at least one scene", () => {
    // A broken example is worse than no example: the author cannot tell their
    // own mistake apart from the sample's.
    for (const t of SCENE_JSON_TEMPLATES) {
      const { document, warnings } = normalizeSceneInput(JSON.parse(t.json));
      assert.deepEqual(
        warnings,
        [],
        `${t.id} produced warnings: ${warnings.join("; ")}`,
      );
      assert.ok(
        (document?.scenes.length ?? 0) > 0,
        `${t.id} produced no scenes`,
      );
    }
  });

  it("the section template becomes one run of scenes", () => {
    const { document } = applyTemplate("section");
    assert.equal(document?.scenes.length, 3);
    assert.deepEqual(groupLabels(document!.scenes), ["The Silence"]);
  });

  it("the episode template becomes several sections in order", () => {
    const { document } = applyTemplate("episode");
    assert.deepEqual(groupLabels(document!.scenes), [
      "The Silence",
      "The Message",
      "Understanding",
    ]);
    // 3 + 4 + 2 subscenes.
    assert.equal(document?.scenes.length, 9);
  });

  it("the media template keeps the image and audio references", () => {
    const { document } = applyTemplate("media");
    const scene = document?.scenes[0];
    assert.equal(scene?.imageKey, "img-replace-me");
    assert.equal(scene?.audio?.key, "clip-replace-me");
  });

  it("the portrait template is a full document with canvas settings", () => {
    const { document, warnings } = applyTemplate("portrait");
    assert.deepEqual(warnings, []);
    assert.equal(document?.version, 1);
    assert.equal(document?.portrait, true);
    assert.equal(document?.brand, "#0d9488");
    assert.equal(document?.subtitleStyleId, "reels");
    assert.equal(document?.scenes.length, 2);
  });

  it("the every-field template shows every optional scene field", () => {
    const { document, warnings } = applyTemplate("all-fields");
    assert.deepEqual(warnings, []);
    const scene = document?.scenes[0];
    assert.equal(scene?.imageFit, "cover");
    assert.equal(scene?.volume, 0.85);
    assert.equal(scene?.muted, false);
    assert.equal(scene?.transition, "zoom");
    assert.equal(scene?.audio?.regions.length, 2);
    assert.equal(scene?.code?.reveal, "typed");
    // The template's own id is authorship, not editor state: the app never
    // writes ids into the file, but reading one back must not be a warning.
    assert.equal(scene?.id, "hand-written-scene");
  });

  it("the programming template lands a snippet on each code scene", () => {
    const { document, warnings } = applyTemplate("programming");
    assert.deepEqual(warnings, []);
    const scenes = document!.scenes;
    const withCode = scenes.filter((s) => s.code !== null);
    // The two framing scenes have no snippet on purpose: a lesson that opens and
    // closes on a wall of code is harder to follow, not easier.
    assert.equal(withCode.length, 3, `${scenes.length} scenes, ${withCode.length} with code`);
    assert.deepEqual(
      withCode.map((s) => s.code!.language),
      ["typescript", "typescript", "python"],
    );
    // Each reveal is a different one, so the template demonstrates all three
    // rather than repeating whichever was typed last.
    assert.deepEqual(
      withCode.map((s) => s.code!.reveal),
      ["lines", "typed", "all"],
    );
    // The line-by-line snippet is the only one that has to stay under the
    // painter's frame cap, so it is the one worth pinning.
    assert.equal(withCode[0]!.code!.source.split("\n").length, 9);
    // Every scene in the run is editable text, so nothing here can be a typo
    // the author has no way to see.
    assert.equal(scenes.every((s) => s.group === "How a memo cache works"), true);
  });

  it("the single-scene template is one scene and not a document", () => {
    // Guards the routing the editor depends on: an object without a `scenes`
    // array must not be read as a document, or the `scenes` key of a real
    // episode document would be ignored the other way round.
    const { document, warnings } = applyTemplate("scene");
    assert.deepEqual(warnings, []);
    assert.equal(document?.scenes.length, 1);
    assert.equal(document?.scenes[0]?.title, "The opening line");
  });

  it("returns null for an unknown id instead of throwing", () => {
    assert.equal(sceneJsonTemplate("nope"), null);
  });

  it("the default template exists", () => {
    const t = sceneJsonTemplate(DEFAULT_SCENE_JSON_TEMPLATE_ID);
    assert.ok(t, `${DEFAULT_SCENE_JSON_TEMPLATE_ID} is not in the list`);
  });
});
