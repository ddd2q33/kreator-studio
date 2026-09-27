/**
 * Tests for the asset library's catalog, search and blob lifecycle.
 *
 * Storage is injected throughout, so these run without a browser and without
 * IndexedDB: the fake blob store is a Map, and the fake localStorage is an
 * object that can be told to fail the way a full quota does.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ASSET_KINDS,
  addAsset,
  allTags,
  createAssetBlobs,
  guessKind,
  isImageAssetKind,
  isSupportedAsset,
  loadAssetFile,
  loadAssets,
  normalizeAssetName,
  normalizeForSearch,
  normalizeTags,
  pruneAssetBlobs,
  readCatalog,
  removeAsset,
  searchAssets,
  totalBytes,
  updateAsset,
  writeCatalog,
  type AddAssetResult,
  type Asset,
} from "../lib/asset-library.ts";
import type { BlobStore } from "../lib/blob-store.ts";

/** In-memory stand-in for IndexedDB. */
function fakeBlobs(): BlobStore & { map: Map<string, Blob> } {
  const map = new Map<string, Blob>();
  return {
    map,
    isAvailable: () => true,
    async put(key, blob) {
      map.set(key, blob);
      return true;
    },
    async get(key) {
      return map.get(key) ?? null;
    },
    async remove(key) {
      map.delete(key);
    },
    async keys() {
      return [...map.keys()];
    },
    async clear() {
      map.clear();
    },
  };
}

/** In-memory stand-in for localStorage, with a switch to simulate a full quota. */
function fakeStorage(initial: Record<string, string> = {}) {
  const data: Record<string, string> = { ...initial };
  const store = {
    data,
    failWrites: false,
    getItem(key: string) {
      return key in data ? data[key] : null;
    },
    setItem(key: string, value: string) {
      if (store.failWrites) throw new Error("QuotaExceededError");
      data[key] = value;
    },
  };
  return store;
}

/** A named blob, which is all the library reads off a file. */
function fakeFile(name: string, type: string, size = 10): Blob {
  const blob = new Blob([new Uint8Array(size)], { type });
  Object.defineProperty(blob, "name", { value: name });
  return blob as Blob;
}

/** Unwraps a successful add, failing the test if it was not one. */
function added(result: AddAssetResult): Asset {
  if (!result.ok) assert.fail(`expected a successful add, got ${result.reason}`);
  return result.asset;
}

describe("normalizeForSearch", () => {
  it("folds case, accents and surrounding space", () => {
    assert.equal(normalizeForSearch("  DISEÑO  "), "diseno");
    assert.equal(normalizeForSearch("Ilustración"), "ilustracion");
    assert.equal(normalizeForSearch("ÁÉÍÓÚ"), "aeiou");
  });

  it("leaves a word it cannot fold alone", () => {
    assert.equal(normalizeForSearch("logo"), "logo");
    assert.equal(normalizeForSearch(""), "");
  });
});

describe("normalizeTags", () => {
  it("trims, de-duplicates and drops blanks", () => {
    assert.deepEqual(normalizeTags([" azul ", "AZUL", "", "   ", "Azul"]), [
      "azul",
    ]);
  });

  it("keeps the accent the author typed, and de-dupes on the folded form", () => {
    assert.deepEqual(normalizeTags(["Diseño", "Diseño"]), ["Diseño"]);
    // Same word, two spellings: one chip, and the one shown is the first typed.
    assert.deepEqual(normalizeTags(["Diseño", "Diseno", "diseño"]), ["Diseño"]);
  });

  it("collapses inner whitespace", () => {
    assert.deepEqual(normalizeTags(["  red   oscuro "]), ["red oscuro"]);
  });

  it("caps the count and the length of each tag", () => {
    const many = Array.from({ length: 50 }, (_, i) => `t${i}`);
    assert.equal(normalizeTags(many).length, 24);
    assert.equal(normalizeTags(["x".repeat(100)])[0].length, 32);
  });

  it("survives undefined", () => {
    assert.deepEqual(normalizeTags(undefined), []);
  });
});

describe("normalizeAssetName", () => {
  it("trims and caps the length", () => {
    assert.equal(normalizeAssetName("  hero  "), "hero");
    assert.equal(normalizeAssetName("y".repeat(300)).length, 120);
  });
});

describe("guessKind", () => {
  it("reads audio and video off the MIME type", () => {
    assert.equal(guessKind("audio/mpeg"), "audio");
    assert.equal(guessKind("video/mp4"), "video");
  });

  it("defaults every picture to image rather than guessing logo or icon", () => {
    assert.equal(guessKind("image/png"), "image");
    assert.equal(guessKind("image/svg+xml"), "image");
    assert.equal(guessKind(""), "image");
  });
});

describe("isSupportedAsset", () => {
  it("accepts the three media families and nothing else", () => {
    assert.equal(isSupportedAsset("image/png"), true);
    assert.equal(isSupportedAsset("audio/wav"), true);
    assert.equal(isSupportedAsset("video/webm"), true);
    assert.equal(isSupportedAsset("application/pdf"), false);
    assert.equal(isSupportedAsset("text/plain"), false);
  });
});

describe("isImageAssetKind", () => {
  it("covers the four picture categories only", () => {
    assert.equal(isImageAssetKind("logo"), true);
    assert.equal(isImageAssetKind("icon"), true);
    assert.equal(isImageAssetKind("audio"), false);
    assert.equal(isImageAssetKind("video"), false);
  });
});

describe("readCatalog", () => {
  it("returns nothing for a missing key", () => {
    assert.deepEqual(readCatalog(fakeStorage()), []);
  });

  it("returns nothing for unparseable or wrongly shaped data", () => {
    assert.deepEqual(readCatalog(fakeStorage({ "book-studio-assets": "{" })), []);
    assert.deepEqual(
      readCatalog(fakeStorage({ "book-studio-assets": '{"assets":3}' })),
      [],
    );
  });

  it("skips a broken entry but keeps its neighbours", () => {
    const storage = fakeStorage({
      "book-studio-assets": JSON.stringify({
        assets: [
          { id: "a", kind: "image", name: "A", blobKey: "a", bytes: 1 },
          { kind: "image", name: "no id", blobKey: "b" },
          { id: "c", kind: "nonsense", name: "C", blobKey: "c" },
          { id: "d", kind: "logo", name: "D" },
        ],
      }),
    });
    assert.deepEqual(
      readCatalog(storage).map((a) => a.id),
      ["a"],
    );
  });

  it("survives a storage that throws on read", () => {
    const hostile = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {},
    };
    assert.deepEqual(readCatalog(hostile), []);
  });
});

describe("writeCatalog", () => {
  it("reports a full quota instead of throwing", () => {
    const storage = fakeStorage();
    storage.failWrites = true;
    assert.equal(writeCatalog([], storage), false);
  });
});

describe("addAsset", () => {
  it("stores the bytes and a record, and lists them newest first", async () => {
    const blobs = fakeBlobs();
    const storage = fakeStorage();

    const first = await addAsset(
      fakeFile("logo-azul.png", "image/png"),
      blobs,
      storage,
      { now: 100 },
    );
    const second = await addAsset(fakeFile("voz.mp3", "audio/mpeg"), blobs, storage, {
      now: 200,
    });

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(blobs.map.size, 2);
    assert.deepEqual(
      loadAssets(storage).map((a) => a.name),
      ["voz.mp3", "logo-azul.png"],
    );
  });

  it("refuses a file that is not media and stores nothing", async () => {
    const blobs = fakeBlobs();
    const result = await addAsset(
      fakeFile("notes.txt", "text/plain"),
      blobs,
      fakeStorage(),
    );
    assert.deepEqual(result, { ok: false, reason: "unsupported" });
    assert.equal(blobs.map.size, 0);
  });

  it("keeps no record when the blob will not store", async () => {
    const blobs = fakeBlobs();
    blobs.put = async () => false;
    const storage = fakeStorage();
    const result = await addAsset(fakeFile("a.png", "image/png"), blobs, storage);
    assert.deepEqual(result, { ok: false, reason: "blob-failed" });
    assert.deepEqual(loadAssets(storage), []);
  });

  it("takes the bytes back when the catalog will not fit", async () => {
    const blobs = fakeBlobs();
    const storage = fakeStorage();
    storage.failWrites = true;
    const result = await addAsset(fakeFile("a.png", "image/png"), blobs, storage);
    assert.deepEqual(result, { ok: false, reason: "catalog-failed" });
    // The important half: no orphaned blob left behind.
    assert.equal(blobs.map.size, 0);
  });

  it("seeds tags from the file name when the author gives none", async () => {
    const blobs = fakeBlobs();
    const result = await addAsset(
      fakeFile("Portada Del Libro.png", "image/png"),
      blobs,
      fakeStorage(),
    );
    assert.deepEqual(added(result).tags, ["Portada", "Del", "Libro"]);
  });

  it("prefers the tags it is given, and falls back when the list is empty", async () => {
    const blobs = fakeBlobs();
    const withTags = await addAsset(
      fakeFile("a.png", "image/png"),
      blobs,
      fakeStorage(),
      { tags: ["hero", "draft"] },
    );
    assert.deepEqual(added(withTags).tags, ["hero", "draft"]);

    const guessed = await addAsset(
      fakeFile("a.png", "image/png"),
      blobs,
      fakeStorage(),
    );
    assert.deepEqual(added(guessed).tags, ["a"]);
  });

  it("keeps the category, name and measured facts it was given", async () => {
    const blobs = fakeBlobs();
    const result = await addAsset(
      fakeFile("clip.mp4", "video/mp4"),
      blobs,
      fakeStorage(),
      {
        kind: "video",
        name: "Intro animada",
        tags: ["intro"],
        facts: { width: 1080, height: 1920, duration: 4.5 },
      },
    );
    const asset = added(result);
    assert.equal(asset.kind, "video");
    assert.equal(asset.name, "Intro animada");
    assert.equal(asset.width, 1080);
    assert.equal(asset.duration, 4.5);
  });
});

describe("updateAsset", () => {
  it("renames, recategorises and retags one asset", async () => {
    const blobs = fakeBlobs();
    const storage = fakeStorage();
    const asset = added(
      await addAsset(fakeFile("a.png", "image/png"), blobs, storage),
    );

    assert.equal(
      updateAsset(
        readCatalog(storage),
        asset.id,
        {
          name: " Portada final ",
          kind: "logo",
          tags: [" Portada ", "portada", "final"],
        },
        storage,
      ),
      true,
    );

    const [updated] = readCatalog(storage);
    assert.equal(updated.name, "Portada final");
    assert.equal(updated.kind, "logo");
    assert.deepEqual(updated.tags, ["Portada", "final"]);
  });

  it("reports false for an unknown id and writes nothing", () => {
    assert.equal(updateAsset([], "nope", { name: "x" }, fakeStorage()), false);
  });

  it("reports false and keeps the catalog when the write fails", async () => {
    const blobs = fakeBlobs();
    const storage = fakeStorage();
    const asset = added(
      await addAsset(fakeFile("a.png", "image/png"), blobs, storage),
    );
    storage.failWrites = true;
    assert.equal(
      updateAsset(readCatalog(storage), asset.id, { name: "b" }, storage),
      false,
    );
    storage.failWrites = false;
    assert.equal(readCatalog(storage)[0].name, "a.png");
  });

  it("leaves a partial patch alone: only the given fields change", async () => {
    const blobs = fakeBlobs();
    const storage = fakeStorage();
    const asset = added(
      await addAsset(fakeFile("a.png", "image/png"), blobs, storage, {
        kind: "icon",
        tags: ["keep"],
      }),
    );
    updateAsset(readCatalog(storage), asset.id, { name: "renamed" }, storage);
    const [updated] = readCatalog(storage);
    assert.equal(updated.name, "renamed");
    assert.equal(updated.kind, "icon");
    assert.deepEqual(updated.tags, ["keep"]);
  });
});

describe("removeAsset", () => {
  it("drops the record and returns the new list", async () => {
    const blobs = fakeBlobs();
    const storage = fakeStorage();
    const asset = added(
      await addAsset(fakeFile("a.png", "image/png"), blobs, storage),
    );
    assert.deepEqual(removeAsset(readCatalog(storage), asset.id, storage), []);
    assert.deepEqual(loadAssets(storage), []);
  });

  it("returns the original list when the write fails", async () => {
    const blobs = fakeBlobs();
    const storage = fakeStorage();
    const asset = added(
      await addAsset(fakeFile("a.png", "image/png"), blobs, storage),
    );
    const before = readCatalog(storage);
    storage.failWrites = true;
    assert.equal(removeAsset(before, asset.id, storage), before);
  });
});

describe("pruneAssetBlobs", () => {
  it("sweeps blobs the catalog forgot and keeps the live ones", async () => {
    const blobs = fakeBlobs();
    const storage = fakeStorage();
    const asset = added(
      await addAsset(fakeFile("live.png", "image/png"), blobs, storage),
    );
    await blobs.put("orphan-1", fakeFile("x", "image/png"));
    await blobs.put("orphan-2", fakeFile("y", "image/png"));

    assert.equal(await pruneAssetBlobs(readCatalog(storage), blobs), 2);
    assert.deepEqual(await blobs.keys(), [asset.blobKey]);
  });

  it("has nothing to do for a tidy store", async () => {
    const blobs = fakeBlobs();
    const storage = fakeStorage();
    await addAsset(fakeFile("a.png", "image/png"), blobs, storage);
    assert.equal(await pruneAssetBlobs(readCatalog(storage), blobs), 0);
  });
});

describe("allTags", () => {
  it("lists tags most used first, then alphabetically", () => {
    const assets: Asset[] = [
      { id: "1", kind: "image", name: "a", tags: ["hero", "azul"], bytes: 0, mime: "", addedAt: 0, blobKey: "1" },
      { id: "2", kind: "image", name: "b", tags: ["hero"], bytes: 0, mime: "", addedAt: 0, blobKey: "2" },
      { id: "3", kind: "image", name: "c", tags: ["zeta", "alfa"], bytes: 0, mime: "", addedAt: 0, blobKey: "3" },
    ];
    assert.deepEqual(allTags(assets), ["hero", "alfa", "azul", "zeta"]);
  });

  it("folds case so Hero and hero are one filter chip", () => {
    const assets: Asset[] = [
      { id: "1", kind: "logo", name: "a", tags: ["Hero"], bytes: 0, mime: "", addedAt: 0, blobKey: "1" },
      { id: "2", kind: "logo", name: "b", tags: ["hero"], bytes: 0, mime: "", addedAt: 0, blobKey: "2" },
    ];
    assert.deepEqual(allTags(assets), ["Hero"]);
  });

  it("is empty when no asset is tagged", () => {
    assert.deepEqual(allTags([]), []);
  });
});

describe("searchAssets", () => {
  const catalog: Asset[] = [
    { id: "1", kind: "logo", name: "Logo Azul", tags: ["marca", "azul"], bytes: 1, mime: "image/png", addedAt: 0, blobKey: "1" },
    { id: "2", kind: "logo", name: "Logo Rojo", tags: ["marca", "rojo"], bytes: 2, mime: "image/png", addedAt: 0, blobKey: "2" },
    { id: "3", kind: "image", name: "Portada", tags: ["libro"], bytes: 3, mime: "image/png", addedAt: 0, blobKey: "3" },
    { id: "4", kind: "audio", name: "Voz narración", tags: ["audio", "libro"], bytes: 4, mime: "audio/mpeg", addedAt: 0, blobKey: "4" },
    { id: "5", kind: "video", name: "Intro animada", tags: ["intro"], bytes: 5, mime: "video/mp4", addedAt: 0, blobKey: "5" },
  ];

  it("returns everything with no filter", () => {
    assert.equal(searchAssets(catalog).length, 5);
  });

  it("matches the name, ignoring case and accents", () => {
    assert.deepEqual(
      searchAssets(catalog, { query: "PORTADA" }).map((a) => a.id),
      ["3"],
    );
    assert.deepEqual(
      searchAssets(catalog, { query: "narracion" }).map((a) => a.id),
      ["4"],
    );
  });

  it("matches a tag", () => {
    assert.deepEqual(
      searchAssets(catalog, { query: "intro" }).map((a) => a.id),
      ["5"],
    );
  });

  it("matches the category label in either number", () => {
    assert.deepEqual(
      searchAssets(catalog, { query: "logos" }).map((a) => a.id),
      ["1", "2"],
    );
    assert.deepEqual(
      searchAssets(catalog, { query: "logo" }).map((a) => a.id),
      ["1", "2"],
    );
    // "Audio" is the label, so the plural has to reach it too.
    assert.deepEqual(
      searchAssets(catalog, { query: "audios" }).map((a) => a.id),
      ["4"],
    );
    assert.deepEqual(
      searchAssets(catalog, { query: "videos" }).map((a) => a.id),
      ["5"],
    );
  });

  it("requires every term, so more words mean fewer results", () => {
    assert.deepEqual(
      searchAssets(catalog, { query: "logo azul" }).map((a) => a.id),
      ["1"],
    );
    assert.equal(searchAssets(catalog, { query: "logo" }).length, 2);
  });

  it("finds nothing when a term is absent", () => {
    assert.deepEqual(searchAssets(catalog, { query: "logo verde" }), []);
  });

  it("filters by category", () => {
    assert.deepEqual(
      searchAssets(catalog, { kind: "logo" }).map((a) => a.id),
      ["1", "2"],
    );
    assert.deepEqual(
      searchAssets(catalog, { kind: "video" }).map((a) => a.id),
      ["5"],
    );
  });

  it("filters by tag, ignoring the spelling of the case", () => {
    assert.deepEqual(
      searchAssets(catalog, { tag: "LIBRO" }).map((a) => a.id),
      ["3", "4"],
    );
    assert.deepEqual(
      searchAssets(catalog, { tag: "libro", kind: "image" }).map((a) => a.id),
      ["3"],
    );
  });

  it("combines all three", () => {
    assert.deepEqual(
      searchAssets(catalog, { query: "libro", kind: "audio", tag: "libro" }).map(
        (a) => a.id,
      ),
      ["4"],
    );
    assert.deepEqual(searchAssets(catalog, { query: "libro", kind: "video" }), []);
  });

  it("ignores a blank query instead of matching nothing", () => {
    assert.equal(searchAssets(catalog, { query: "   " }).length, 5);
  });
});

describe("totalBytes", () => {
  it("adds up the stored sizes", () => {
    assert.equal(totalBytes([{ bytes: 10 }, { bytes: 32 }] as Asset[]), 42);
  });

  it("is zero for an empty library", () => {
    assert.equal(totalBytes([]), 0);
  });
});

describe("loadAssetFile", () => {
  it("hands back a File the editors can consume", async () => {
    const blobs = fakeBlobs();
    const storage = fakeStorage();
    const asset = added(
      await addAsset(fakeFile("portada.png", "image/png", 32), blobs, storage),
    );
    const file = await loadAssetFile(asset, blobs);
    assert.ok(file);
    assert.equal(file.name, "portada.png");
    assert.equal(file.type, "image/png");
    assert.equal(file.size, 32);
  });

  it("adds the extension an asset is missing from its name", async () => {
    const blobs = fakeBlobs();
    const storage = fakeStorage();
    const asset = added(await addAsset(fakeFile("voz", "audio/mpeg"), blobs, storage));
    const file = await loadAssetFile(asset, blobs);
    assert.equal(file?.name, "voz.mp3");
  });

  it("returns null when the bytes are gone", async () => {
    const blobs = fakeBlobs();
    const storage = fakeStorage();
    const asset = added(
      await addAsset(fakeFile("a.png", "image/png"), blobs, storage),
    );
    await blobs.remove(asset.blobKey);
    assert.equal(await loadAssetFile(asset, blobs), null);
  });
});

describe("createAssetBlobs", () => {
  it("builds a store that reports availability", () => {
    const store = createAssetBlobs();
    assert.equal(typeof store.isAvailable(), "boolean");
    assert.equal(typeof store.put, "function");
  });
});

describe("ASSET_KINDS", () => {
  it("is the six categories the library advertises", () => {
    assert.deepEqual([...ASSET_KINDS], [
      "image",
      "illustration",
      "logo",
      "icon",
      "audio",
      "video",
    ]);
  });
});
