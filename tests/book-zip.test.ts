import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bookToZip, zipToBook } from "../lib/book-zip.ts";
import type { BookFile } from "../lib/book-files.ts";

const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const book: BookFile = {
  name: "Zip Book",
  templateId: "technical",
  presetId: null,
  bookMode: true,
  chapters: [
    { id: "ch-1", title: "Getting Started", markdown: "# Getting Started\n\nHello" },
    { id: "ch-2", title: "Deep Dive", markdown: "# Deep Dive\n\nWorld" },
  ],
};

describe("bookToZip / zipToBook round-trip", () => {
  it("preserves manifest, chapter order, titles and bodies", async () => {
    const zip = await bookToZip(book);
    const { book: loaded } = await zipToBook(zip);

    assert.equal(loaded.name, "Zip Book");
    assert.equal(loaded.templateId, "technical");
    assert.equal(loaded.bookMode, true);
    assert.deepEqual(
      loaded.chapters.map((c) => [c.id, c.title]),
      book.chapters.map((c) => [c.id, c.title]),
    );
    assert.deepEqual(
      loaded.chapters.map((c) => c.markdown),
      book.chapters.map((c) => c.markdown),
    );
  });

  it("round-trips images as lowercase-keyed data URLs", async () => {
    const zip = await bookToZip(book, { "Cover.PNG": PNG_DATA_URL });
    const { book: loaded, images } = await zipToBook(zip);

    assert.equal(loaded.name, "Zip Book");
    assert.deepEqual(Object.keys(images), ["cover.png"]);
    assert.match(images["cover.png"] ?? "", /^data:image\/png;base64,/);
    // Bytes survive the base64 detour.
    const raw = (images["cover.png"] ?? "").split(",")[1] ?? "";
    const original = PNG_DATA_URL.split(",")[1] ?? "";
    assert.equal(raw, original);
  });

  it("orders chapters by the manifest even when file names differ", async () => {
    const zip = await bookToZip(book);
    const { book: loaded } = await zipToBook(zip);
    assert.equal(loaded.chapters[0].title, "Getting Started");
    assert.equal(loaded.chapters[1].title, "Deep Dive");
  });

  it("falls back to zip file order for books without a manifest", async () => {
    const { default: JSZip } = await import("jszip");
    const zip = await new JSZip()
      .file("chapters/01-second.md", "# Second")
      .file("chapters/02-first.md", "# First")
      .generateAsync({ type: "blob" });
    const { book: loaded } = await zipToBook(zip);
    // No manifest: titles come from each file's first heading, in zip order.
    assert.deepEqual(loaded.chapters.map((c) => c.title), ["Second", "First"]);
    assert.equal(loaded.templateId, null);
  });
});

describe("zipToBook error handling", () => {
  it("rejects zips with no chapter files", async () => {
    const { default: JSZip } = await import("jszip");
    const empty = await new JSZip()
      .file("readme.txt", "not a book")
      .generateAsync({ type: "blob" });
    await assert.rejects(() => zipToBook(empty), /No chapter/);
  });

  it("rejects a corrupt book.json with a readable message", async () => {
    const { default: JSZip } = await import("jszip");
    const broken = await new JSZip()
      .file("book.json", "{nope")
      .file("chapters/01-a.md", "# A")
      .generateAsync({ type: "blob" });
    await assert.rejects(() => zipToBook(broken), /not valid JSON/);
  });

  it("rejects non-zip input", async () => {
    const garbage = new Blob(["this is not a zip file"]);
    await assert.rejects(() => zipToBook(garbage));
  });
});
