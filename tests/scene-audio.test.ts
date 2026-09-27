import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AUDIO_ACCEPT,
  buildAudioSchedule,
  formatAudioDuration,
  isAudioFile,
  MAX_AUDIO_BYTES,
  MAX_SCENE_DURATION,
  MIN_SCENE_DURATION,
  scenesDuration,
  targetSceneDuration,
} from "../lib/scene-audio.ts";

describe("isAudioFile", () => {
  it("accepts anything the browser labels as audio", () => {
    for (const type of ["audio/mpeg", "audio/wav", "audio/x-m4a", "audio/ogg"]) {
      assert.equal(isAudioFile({ name: "no-extension", type }), true, type);
    }
  });

  it("accepts known extensions when the browser reports no type", () => {
    for (const name of ["a.mp3", "a.WAV", "a.m4a", "a.aac", "a.opus", "a.flac"]) {
      assert.equal(isAudioFile({ name, type: "" }), true, name);
    }
  });

  it("rejects images, video and unknown extensions", () => {
    for (const name of ["a.png", "a.mp4", "a.json", "notes.txt", "noext"]) {
      assert.equal(isAudioFile({ name, type: "" }), false, name);
    }
  });

  it("lets an explicit video type win over an audio extension", () => {
    // .ogg and .webm are dual-purpose containers.
    assert.equal(isAudioFile({ name: "clip.ogg", type: "video/ogg" }), false);
    assert.equal(isAudioFile({ name: "clip.webm", type: "video/webm" }), false);
    assert.equal(isAudioFile({ name: "clip.ogg", type: "audio/ogg" }), true);
  });

  it("advertises the formats it accepts", () => {
    assert.match(AUDIO_ACCEPT, /audio\/\*/);
    assert.match(AUDIO_ACCEPT, /\.mp3/);
    assert.match(AUDIO_ACCEPT, /\.flac/);
  });
});

describe("targetSceneDuration", () => {
  it("stretches a scene to fit a longer clip", () => {
    assert.equal(targetSceneDuration(4, 8.5), 8.5);
  });

  it("leaves the duration alone for a shorter clip", () => {
    assert.equal(targetSceneDuration(10, 3), 10);
  });

  it("keeps the current duration when the length is unusable", () => {
    for (const bad of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(targetSceneDuration(6, bad), 6, String(bad));
    }
  });

  it("never leaves the scene outside the editor's bounds", () => {
    assert.equal(targetSceneDuration(4, 999), MAX_SCENE_DURATION);
    assert.equal(targetSceneDuration(MIN_SCENE_DURATION - 5, 0), MIN_SCENE_DURATION);
  });

  it("agrees with the maximum clip size being finite", () => {
    assert.ok(MAX_AUDIO_BYTES > 0);
    assert.equal(MAX_AUDIO_BYTES % 1024, 0);
  });
});

describe("buildAudioSchedule", () => {
  const scene = (duration: number, audioDuration: number | null) => ({
    duration,
    audio: audioDuration === null ? null : { key: `k${audioDuration}`, duration: audioDuration },
  });

  it("stacks clips at each scene's start offset", () => {
    const slots = buildAudioSchedule([scene(2, 2), scene(3, 3), scene(1, 1)]);
    assert.deepEqual(
      slots.map((s) => [s.start, s.duration]),
      [
        [0, 2],
        [2, 3],
        [5, 1],
      ],
    );
  });

  it("skips a scene with no clip but keeps the offset", () => {
    const slots = buildAudioSchedule([scene(4, null), scene(2, 2)]);
    assert.equal(slots.length, 1);
    assert.equal(slots[0].start, 4);
    assert.equal(slots[0].duration, 2);
  });

  it("cuts the tail of a clip that outlasts its scene", () => {
    const slots = buildAudioSchedule([scene(2, 9)]);
    assert.equal(slots[0].duration, 2);
    assert.equal(slots[0].offset, 0);
  });

  it("ignores a clip with no measured length", () => {
    assert.deepEqual(buildAudioSchedule([scene(4, 0)]), []);
  });

  it("drops slots that already finished before the playhead", () => {
    const slots = buildAudioSchedule([scene(2, 2), scene(2, 2)], 3);
    assert.equal(slots.length, 1);
    assert.equal(slots[0].start, 2);
  });

  it("returns nothing for an empty project", () => {
    assert.deepEqual(buildAudioSchedule([]), []);
  });
});

describe("buildAudioSchedule gain", () => {
  const scene = (
    duration: number,
    extra: { volume?: number; muted?: boolean } = {},
  ) => ({
    duration,
    audio: { key: "k", duration },
    ...extra,
  });

  it("defaults to full gain when a scene says nothing", () => {
    assert.equal(buildAudioSchedule([scene(2)])[0].gain, 1);
  });

  it("carries a scene's own volume", () => {
    assert.equal(buildAudioSchedule([scene(2, { volume: 0.4 })])[0].gain, 0.4);
  });

  it("keeps a muted scene's slot at gain 0 rather than removing it", () => {
    // A mute has to stay visible in the schedule, or the mixer cannot tell a
    // deliberate silence from a scene that simply has no clip.
    const slots = buildAudioSchedule([scene(2, { muted: true })]);
    assert.equal(slots.length, 1);
    assert.equal(slots[0].gain, 0);
    assert.equal(slots[0].key, "k");
  });

  it("lets a mute win over a volume", () => {
    assert.equal(buildAudioSchedule([scene(2, { volume: 1, muted: true })])[0].gain, 0);
  });

  it("clamps a volume outside 0..1", () => {
    assert.equal(buildAudioSchedule([scene(2, { volume: 4 })])[0].gain, 1);
    assert.equal(buildAudioSchedule([scene(2, { volume: -2 })])[0].gain, 0);
  });

  it("falls back to full gain for a volume that is not a number", () => {
    const slots = buildAudioSchedule([
      { duration: 2, audio: { key: "k", duration: 2 }, volume: Number.NaN },
    ]);
    assert.equal(slots[0].gain, 1);
  });
});

describe("scenesDuration", () => {
  it("sums the scene lengths", () => {
    assert.equal(scenesDuration([{ duration: 2 }, { duration: 3.5 }]), 5.5);
  });

  it("treats a negative length as zero", () => {
    assert.equal(scenesDuration([{ duration: 2 }, { duration: -4 }]), 2);
  });

  it("is zero for no scenes", () => {
    assert.equal(scenesDuration([]), 0);
  });
});

describe("formatAudioDuration", () => {
  it("formats as m:ss", () => {
    assert.equal(formatAudioDuration(0), "0:00");
    assert.equal(formatAudioDuration(9), "0:09");
    assert.equal(formatAudioDuration(75), "1:15");
    assert.equal(formatAudioDuration(605), "10:05");
  });

  it("clamps nonsense to 0:00", () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(formatAudioDuration(bad), "0:00", String(bad));
    }
  });
});
