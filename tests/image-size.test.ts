import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { dataUrlToBuffer, imageSizeFromDataUrl } from "../lib/image-size.ts";

/** 1×1 red PNG. */
const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
/** 3×5 PNG (same classic sample, height 5). */
const PNG_3X5 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAMAAAAFCAYAAABnEqhDAAAAEklEQVR4nGP8z8DwnwEKmBgzAQAxOgPzk+ZlkgAAAABJRU5ErkJggg==";

// 16×16 JPEG built at test time: SOI + APP0(JFIF) + SOF0 with 16/16 + EOI.
function jpeg16DataUrl(): string {
  const b = [
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
    0x00, 0x01, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x10, 0x03, 0x01, 0x22,
    0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9,
  ];
  const buf = Buffer.from(b);
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

describe("dataUrlToBuffer", () => {
  it("decodes base64 data URLs", () => {
    const buf = dataUrlToBuffer("data:image/png;base64,AAECAw==");
    assert.ok(buf);
    assert.deepEqual([...buf], [0x00, 0x01, 0x02, 0x03]);
  });

  it("rejects non-base64 and non-data URLs", () => {
    assert.equal(dataUrlToBuffer("data:image/png;utf8,hello"), null);
    assert.equal(dataUrlToBuffer("https://example.com/x.png"), null);
    assert.equal(dataUrlToBuffer("nope"), null);
  });
});

describe("imageSizeFromDataUrl", () => {
  it("reads PNG dimensions from the IHDR chunk", () => {
    assert.deepEqual(imageSizeFromDataUrl(PNG_1PX), { width: 1, height: 1 });
    assert.deepEqual(imageSizeFromDataUrl(PNG_3X5), { width: 3, height: 5 });
  });

  it("reads JPEG dimensions by walking segments to SOF0", () => {
    assert.deepEqual(imageSizeFromDataUrl(jpeg16DataUrl()), { width: 16, height: 16 });
  });

  it("returns null for unsupported or truncated data", () => {
    assert.equal(imageSizeFromDataUrl("data:image/webp;base64,UklGRg=="), null);
    assert.equal(imageSizeFromDataUrl("data:image/png;base64,iVBORw0K"), null);
    assert.equal(imageSizeFromDataUrl("data:text/plain;base64,SGVsbG8="), null);
  });
});
