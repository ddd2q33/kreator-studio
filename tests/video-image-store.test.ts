import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LEGACY_IMAGES_KEY,
  VIDEO_IMAGES_KEY,
  loadVideoImages,
  writeVideoImages,
  type ImagePool,
} from "../lib/video-image-store.ts";

/** Minimal in-memory Storage, so the tests never touch a real browser. */
function fakeStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  let failWrites = false;
  return {
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      if (failWrites) throw new Error("QuotaExceededError");
      data[key] = value;
    },
    /** Test hook: simulate a full quota. */
    breakWrites() {
      failWrites = true;
    },
    peek: (key: string) => data[key],
  };
}

const pool = (entries: Record<string, string>): string =>
  JSON.stringify({ images: entries });

describe("video image store", () => {
  it("seeds the video pool from the legacy shared key on first load", () => {
    const legacy = { "cover.png": "data:image/png;base64,AAA" };
    const storage = fakeStorage({ [LEGACY_IMAGES_KEY]: pool(legacy) });

    const result = loadVideoImages(storage);

    assert.deepEqual(result.images, legacy);
    assert.deepEqual(result.migration, { seeded: true, persisted: true });
    // The copy is written to the video studio's own key…
    assert.equal(
      storage.peek(VIDEO_IMAGES_KEY),
      pool(legacy),
      "migrated pool should be persisted under the video key",
    );
    // …and the manuscript's own key is left exactly as it was.
    assert.equal(storage.peek(LEGACY_IMAGES_KEY), pool(legacy));
  });

  it("never re-reads the legacy key once the video pool exists", () => {
    const storage = fakeStorage({
      [VIDEO_IMAGES_KEY]: pool({ "mine.png": "data:image/png;base64,BBB" }),
      [LEGACY_IMAGES_KEY]: pool({ "theirs.png": "data:image/png;base64,CCC" }),
    });

    const result = loadVideoImages(storage);

    // The manuscript's later upload must not leak in.
    assert.deepEqual(result.images, { "mine.png": "data:image/png;base64,BBB" });
    assert.equal(result.migration, null);
  });

  it("does not re-seed a pool the user deliberately emptied", () => {
    const storage = fakeStorage({
      [VIDEO_IMAGES_KEY]: pool({}),
      [LEGACY_IMAGES_KEY]: pool({ "old.png": "data:image/png;base64,DDD" }),
    });

    const result = loadVideoImages(storage);

    assert.deepEqual(result.images, {});
    assert.equal(result.migration, null);
  });

  it("starts empty when there is no legacy pool to copy", () => {
    const result = loadVideoImages(fakeStorage());
    assert.deepEqual(result.images, {});
    assert.equal(result.migration, null);
  });

  it("still returns the images when the seed copy cannot be saved", () => {
    const legacy = { "cover.png": "data:image/png;base64,EEE" };
    const storage = fakeStorage({ [LEGACY_IMAGES_KEY]: pool(legacy) });
    storage.breakWrites();

    const result = loadVideoImages(storage);

    // Usable this session, but the caller is told the copy did not stick.
    assert.deepEqual(result.images, legacy);
    assert.deepEqual(result.migration, { seeded: true, persisted: false });
  });

  it("reports a failed write instead of throwing", () => {
    const storage = fakeStorage();
    storage.breakWrites();
    const images: ImagePool = { "a.png": "data:image/png;base64,FFF" };
    assert.equal(writeVideoImages(images, storage), false);
  });

  it("reports a successful migration as persisted, not as a problem", () => {
    // The UI keys its storage warning off `persisted`, so a migration that
    // worked has to be distinguishable from one that did not. Reporting the
    // success as a failure is how a working upgrade announces itself as broken.
    const storage = fakeStorage({
      [LEGACY_IMAGES_KEY]: pool({ "cover.png": "data:image/png;base64,AAA" }),
    });

    const result = loadVideoImages(storage);

    assert.equal(result.migration?.seeded, true);
    assert.equal(result.migration?.persisted, true);
  });

  it("ignores malformed stored data instead of throwing", () => {
    const cases = [
      "not json at all",
      "[]",
      '{"images":"nope"}',
      '{"images":[1,2,3]}',
      JSON.stringify({ images: { good: "data:image/png;base64,GG", bad: 42 } }),
    ];
    for (const raw of cases) {
      const storage = fakeStorage({ [VIDEO_IMAGES_KEY]: raw });
      const result = loadVideoImages(storage);
      // Whatever survives must be a usable string->string map.
      for (const [k, v] of Object.entries(result.images)) {
        assert.equal(typeof k, "string");
        assert.equal(typeof v, "string");
      }
    }
  });

  it("drops non-string entries but keeps the good ones", () => {
    const storage = fakeStorage({
      [VIDEO_IMAGES_KEY]: JSON.stringify({
        images: { good: "data:image/png;base64,HH", bad: 42, empty: "" },
      }),
    });
    assert.deepEqual(loadVideoImages(storage).images, {
      good: "data:image/png;base64,HH",
    });
  });
});
