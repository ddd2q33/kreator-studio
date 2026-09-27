import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_EXPORT_TARGET,
  EXPORT_FORMATS,
  exportFormat,
  probeTarget,
  unavailableReason,
  type EncodeProbe,
  type ExportTarget,
} from "../lib/export-formats.ts";

const byId = (id: ExportTarget) => exportFormat(id);

const RENDER = {
  width: 1080,
  height: 1920,
  frameRate: 30,
  withAudio: true,
};

const RENDER_SILENT = { ...RENDER, withAudio: false };

/**
 * A browser that can encode exactly the codecs named.
 *
 * The lists are plain strings because they model a browser, not this app: a
 * Firefox build advertises Vorbis and AV1, which are never offered here, and
 * the point of these tests is what happens when the codec the container needs is
 * absent from the browser's list.
 */
function browser(video: string[], audio: string[] = []): EncodeProbe {
  return {
    webCodecs: true,
    canEncodeVideo: async (codec) => video.includes(codec),
    canEncodeAudio: async (codec) => audio.includes(codec),
  };
}

/** A browser with no WebCodecs at all. */
const NO_WEBCODECS: EncodeProbe = {
  webCodecs: false,
  canEncodeVideo: async () => false,
  canEncodeAudio: async () => false,
};

describe("the export catalog", () => {
  it("offers both video containers and the project files", () => {
    const ids = EXPORT_FORMATS.map((f) => f.id);
    assert.ok(ids.includes("mp4"));
    assert.ok(ids.includes("webm"));
    assert.ok(ids.includes("capcut"));
    assert.ok(ids.includes("json"));
  });

  it("defaults to MP4, the container that plays everywhere", () => {
    assert.equal(byId(DEFAULT_EXPORT_TARGET).id, "mp4");
  });

  it("has a unique id and a usable extension for every entry", () => {
    const ids = new Set(EXPORT_FORMATS.map((f) => f.id));
    assert.equal(ids.size, EXPORT_FORMATS.length);
    for (const f of EXPORT_FORMATS) {
      assert.ok(f.label.length > 0, `${f.id} has no label`);
      assert.ok(f.hint.length > 0, `${f.id} has no hint`);
      assert.ok(f.extension.length > 0, `${f.id} has no extension`);
      assert.ok(!f.extension.includes("."), `${f.id} extension has a dot`);
    }
  });

  it("falls back to the default for an unknown target", () => {
    assert.equal(
      exportFormat("nonsense" as ExportTarget).id,
      DEFAULT_EXPORT_TARGET,
    );
  });
});

describe("container codec pairs", () => {
  it("gives MP4 H.264 and AAC, the pair every player accepts", () => {
    const mp4 = byId("mp4");
    assert.equal(mp4.videoCodec, "avc");
    assert.equal(mp4.audioCodec, "aac");
  });

  it("gives WebM VP9 and Opus, which is what WebM is defined to carry", () => {
    const webm = byId("webm");
    assert.equal(webm.videoCodec, "vp9");
    assert.equal(webm.audioCodec, "opus");
  });

  it("leaves the project files without codecs", () => {
    for (const id of ["capcut", "json"] as const) {
      const f = byId(id);
      assert.equal(f.videoCodec, null, `${id} should have no video codec`);
      assert.equal(f.audioCodec, null, `${id} should have no audio codec`);
    }
  });

  it("marks only the two video containers as video", () => {
    const video = EXPORT_FORMATS.filter((f) => f.isVideo).map((f) => f.id);
    assert.deepEqual(video.sort(), ["mp4", "webm"]);
  });
});

describe("probeTarget", () => {
  it("never needs an encoder for the project files", async () => {
    for (const id of ["capcut", "json"] as const) {
      assert.equal(
        await probeTarget(byId(id), RENDER, NO_WEBCODECS),
        true,
        `${id} must not depend on WebCodecs`,
      );
    }
  });

  it("blocks video when the browser has no WebCodecs", async () => {
    assert.equal(await probeTarget(byId("mp4"), RENDER, NO_WEBCODECS), false);
    assert.equal(await probeTarget(byId("webm"), RENDER, NO_WEBCODECS), false);
  });

  it("reports MP4 unavailable on a browser that cannot do H.264", async () => {
    // The realistic case: a Linux Firefox build with VP9/Opus but no H.264.
    const firefoxLike = browser(["vp9", "vp8", "av1"], ["opus", "vorbis"]);
    assert.equal(await probeTarget(byId("mp4"), RENDER, firefoxLike), false);
  });

  it("reports WebM available on that same browser", async () => {
    const firefoxLike = browser(["vp9", "vp8", "av1"], ["opus", "vorbis"]);
    assert.equal(await probeTarget(byId("webm"), RENDER, firefoxLike), true);
  });

  it("reports both available on a browser with H.264 and AAC", async () => {
    const chromeLike = browser(["avc", "vp9"], ["aac", "opus"]);
    assert.equal(await probeTarget(byId("mp4"), RENDER, chromeLike), true);
    assert.equal(await probeTarget(byId("webm"), RENDER, chromeLike), true);
  });

  it("rejects a container whose audio codec is missing", async () => {
    // Video without audio is not a valid MP4 here, and a silent WebM would
    // silently drop the voice-over, so neither counts as available.
    const videoOnly = browser(["avc", "vp9"], []);
    assert.equal(await probeTarget(byId("mp4"), RENDER, videoOnly), false);
    assert.equal(await probeTarget(byId("webm"), RENDER, videoOnly), false);
  });

  it("does not ask about audio when the project is silent", async () => {
    let asked = false;
    const probe: EncodeProbe = {
      webCodecs: true,
      canEncodeVideo: async () => true,
      canEncodeAudio: async () => {
        asked = true;
        return true;
      },
    };
    // A video-only browser must still be able to export a project with no audio.
    assert.equal(await probeTarget(byId("mp4"), RENDER_SILENT, probe), true);
    assert.equal(asked, false, "audio must not be probed for a silent export");
  });

  it("tolerates a missing audio probe instead of failing", async () => {
    // An inconclusive capability query must not block a working video export.
    const probe: EncodeProbe = { webCodecs: true, canEncodeVideo: async () => true };
    assert.equal(await probeTarget(byId("mp4"), RENDER, probe), true);
  });
});

describe("unavailableReason", () => {
  it("has no reason for the project files", () => {
    assert.equal(unavailableReason("json", { webCodecs: false }), null);
    assert.equal(unavailableReason("capcut", { webCodecs: false }), null);
  });

  it("has no reason before the probe has answered", () => {
    // Greying out a container for a frame on every browser would be a lie.
    assert.equal(
      unavailableReason("mp4", { webCodecs: true, probed: false }),
      null,
    );
  });

  it("says so plainly when the browser has no encoder at all", () => {
    assert.match(
      unavailableReason("mp4", { webCodecs: false }) ?? "",
      /no WebCodecs/,
    );
  });

  it("names the codecs that are missing when WebCodecs exists", () => {
    const mp4 = unavailableReason("mp4", { webCodecs: true });
    assert.ok(mp4);
    assert.match(mp4, /H\.264|AAC/);
    const webm = unavailableReason("webm", { webCodecs: true });
    assert.ok(webm);
    assert.match(webm, /VP9|Opus/);
  });
});
