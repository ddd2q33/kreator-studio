/**
 * The asset library: one catalog of images, illustrations, logos, icons, audio
 * and video, with tags, a category and search, reusable across both studios.
 *
 * The split from `audio-store` is deliberate and the reason is capacity. Scene
 * images live in `localStorage` as data URLs, which is fine for a handful of
 * pictures and useless for a library: the origin quota is around 5 MB and base64
 * inflates every image by a third, so a dozen illustrations would fill it and
 * the next write would fail. Here the bytes go to IndexedDB as Blobs, exactly
 * like the scene audio clips already do, and `localStorage` holds only the small
 * metadata record. That is what makes "a library" possible rather than a demo.
 *
 * It coexists with the two existing pools on purpose. A library that replaced
 * them would have to migrate every saved scene's `imageKey` and `audio.key`, and
 * the history in `video-image-store.ts` shows what goes wrong when one shared key
 * is cleared by an unrelated editor. Nothing here is referenced by a scene, so
 * deleting an asset can never orphan a project.
 *
 * Storage is injectable so this is testable without a DOM.
 */

import { createBlobStore, type BlobStore } from "./blob-store.ts";

/** Key owned exclusively by the asset library. */
export const ASSET_CATALOG_KEY = "book-studio-assets";

/** The six categories, in the order the picker shows them. */
export const ASSET_KINDS = [
  "image",
  "illustration",
  "logo",
  "icon",
  "audio",
  "video",
] as const;

export type AssetKind = (typeof ASSET_KINDS)[number];

/** Human labels, so the UI never has to hardcode the words. */
export const ASSET_KIND_LABELS: Record<AssetKind, string> = {
  image: "Images",
  illustration: "Illustrations",
  logo: "Logos",
  icon: "Icons",
  audio: "Audio",
  video: "Videos",
};

/** Kinds whose bytes are a picture the UI can thumbnail. */
export const IMAGE_ASSET_KINDS: readonly AssetKind[] = [
  "image",
  "illustration",
  "logo",
  "icon",
];

export function isImageAssetKind(kind: AssetKind): boolean {
  return IMAGE_ASSET_KINDS.includes(kind);
}

/** Just the Storage surface used for metadata, so tests can pass a plain object. */
type LikeStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type Asset = {
  id: string;
  kind: AssetKind;
  name: string;
  tags: string[];
  bytes: number;
  mime: string;
  /** Epoch ms, for the "recently added" ordering. */
  addedAt: number;
  /** Where the bytes live in IndexedDB. */
  blobKey: string;
  /** Pictures and video, when the browser could measure them. */
  width?: number;
  height?: number;
  /** Audio and video, in seconds. */
  duration?: number;
};

/** Extra facts the browser can measure but the store cannot on its own. */
export type AssetFacts = {
  width?: number;
  height?: number;
  duration?: number;
};

const MAX_NAME = 120;
const MAX_TAGS = 24;
const MAX_TAG_LENGTH = 32;

/**
 * A localStorage stand-in for a server render, where `window` does not exist.
 *
 * Reads come back empty and writes go nowhere, which is the right answer for a
 * render that only has to produce markup: the browser's own `localStorage` takes
 * over on the client, before the author can add anything.
 */
export function memoryStorage(): LikeStorage & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

/**
 * Folds a string down to something comparable.
 *
 * Accents are stripped on purpose: the library is used in Spanish, and a search
 * for "logo diseno" has to find "Logo Diseño". Case and surrounding space go
 * too, so "Logo" and " logo " are one tag.
 */
export function normalizeForSearch(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/**
 * Cleans a tag list: trimmed, de-duplicated, capped, in a stable order.
 *
 * Accents are deliberately kept. A tag is something the author reads back in the
 * filter row, so folding "Diseño" to "Diseno" would be visible data loss. The
 * accent-insensitive comparison belongs in `normalizeForSearch`, which is only
 * ever used to decide whether two things match.
 */
export function normalizeTags(tags: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags ?? []) {
    const clean = String(raw ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, MAX_TAG_LENGTH);
    if (!clean) continue;
    const fold = normalizeForSearch(clean);
    if (seen.has(fold)) continue;
    seen.add(fold);
    out.push(clean);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/** The tag a file lands with when the author does not type one. */
function guessTags(name: string): string[] {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return normalizeTags(stem.split(/[\s_\-.]+/));
}

export function normalizeAssetName(name: string): string {
  return String(name ?? "").trim().slice(0, MAX_NAME);
}

/**
 * Picks the category from the MIME type.
 *
 * Only the three that are unambiguous. "logo" and "icon" are equally valid
 * images, and guessing wrong would file a real logo under Images, so those stay
 * for the author to pick.
 */
export function guessKind(mime: string): AssetKind {
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "image";
  return "image";
}

/** True when a file is something the library should accept at all. */
export function isSupportedAsset(mime: string): boolean {
  return (
    mime.startsWith("image/") ||
    mime.startsWith("audio/") ||
    mime.startsWith("video/")
  );
}

/** The blob store the library writes to. Swappable for tests. */
export function createAssetBlobs(): BlobStore {
  return createBlobStore("book-studio-assets", "blobs");
}

/**
 * Reads the catalog, dropping anything malformed.
 *
 * A record is only worth keeping if it can actually be found again, so a broken
 * entry is skipped rather than crashing the load: one bad row should cost you
 * that asset, not the whole library.
 */
export function readCatalog(storage: LikeStorage): Asset[] {
  let raw: string | null;
  try {
    raw = storage.getItem(ASSET_CATALOG_KEY);
  } catch {
    return [];
  }
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = (parsed as { assets?: unknown })?.assets;
  if (!Array.isArray(list)) return [];

  const assets: Asset[] = [];
  for (const entry of list) {
    const a = entry as Partial<Asset>;
    if (!a || typeof a.id !== "string" || !a.id) continue;
    if (typeof a.blobKey !== "string" || !a.blobKey) continue;
    if (!ASSET_KINDS.includes(a.kind as AssetKind)) continue;
    assets.push({
      id: a.id,
      kind: a.kind as AssetKind,
      name: normalizeAssetName(typeof a.name === "string" ? a.name : a.id),
      tags: normalizeTags(Array.isArray(a.tags) ? a.tags : []),
      bytes: typeof a.bytes === "number" && a.bytes >= 0 ? a.bytes : 0,
      mime: typeof a.mime === "string" ? a.mime : "",
      addedAt: typeof a.addedAt === "number" ? a.addedAt : 0,
      blobKey: a.blobKey,
      ...(typeof a.width === "number" ? { width: a.width } : {}),
      ...(typeof a.height === "number" ? { height: a.height } : {}),
      ...(typeof a.duration === "number" ? { duration: a.duration } : {}),
    });
  }
  return assets;
}

/** Writes the catalog, reporting whether it stuck. False means the quota is full. */
export function writeCatalog(
  assets: readonly Asset[],
  storage: LikeStorage,
): boolean {
  try {
    storage.setItem(ASSET_CATALOG_KEY, JSON.stringify({ assets }));
    return true;
  } catch {
    return false;
  }
}

/** Every asset, newest first, which is the order the grid wants. */
export function loadAssets(storage: LikeStorage): Asset[] {
  return readCatalog(storage).sort((a, b) => b.addedAt - a.addedAt);
}

/** Every tag in use, most used first, for the filter row. */
export function allTags(assets: readonly Asset[]): string[] {
  const counts = new Map<string, { label: string; n: number }>();
  for (const asset of assets) {
    for (const tag of asset.tags) {
      const fold = normalizeForSearch(tag);
      const hit = counts.get(fold);
      if (hit) hit.n += 1;
      else counts.set(fold, { label: tag, n: 1 });
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
    .map((t) => t.label);
}

export type AssetFilter = {
  query?: string;
  kind?: AssetKind | null;
  tag?: string | null;
};

/**
 * The words a category answers to.
 *
 * Both numbers, because the labels are a mix: "Logos" is plural and "Audio" is
 * not, so a single form means that searching "logo" misses Logos and "audios"
 * misses Audio. Nobody expects a search box to care about that.
 */
function kindSearchTerms(kind: AssetKind): string[] {
  const label = ASSET_KIND_LABELS[kind].toLowerCase();
  return label.endsWith("s") ? [label, label.slice(0, -1)] : [label, `${label}s`];
}

/**
 * Searches the catalog. Every term has to match, and a term can match the name,
 * any tag, or the category label.
 *
 * AND rather than OR, because "logo azul" should not also return every red logo:
 * adding a word should narrow the result, the way a search box is expected to.
 */
export function searchAssets(
  assets: readonly Asset[],
  filter: AssetFilter = {},
): Asset[] {
  const terms = normalizeForSearch(filter.query ?? "")
    .split(/\s+/)
    .filter(Boolean);
  const wantKind = filter.kind ?? null;
  const wantTag = filter.tag ? normalizeForSearch(filter.tag) : null;

  return assets.filter((asset) => {
    if (wantKind && asset.kind !== wantKind) return false;
    if (wantTag && !asset.tags.some((t) => normalizeForSearch(t) === wantTag)) {
      return false;
    }
    if (terms.length === 0) return true;
    const haystack = [
      asset.name,
      ...kindSearchTerms(asset.kind),
      ...asset.tags,
    ]
      .map(normalizeForSearch)
      .join(" ");
    return terms.every((term) => haystack.includes(term));
  });
}

/** Sums the stored bytes, so the panel can show what the library is costing. */
export function totalBytes(assets: readonly Asset[]): number {
  return assets.reduce((sum, a) => sum + a.bytes, 0);
}

let counter = 0;

/** An id that stays unique inside one session without pulling in a uuid dep. */
function makeId(): string {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `asset-${Date.now().toString(36)}-${counter.toString(36)}-${rand}`;
}

export type AddAssetInput = {
  name?: string;
  kind?: AssetKind;
  tags?: string[];
  /** Measured by the caller, which is the only side with a DOM. */
  facts?: AssetFacts;
  now?: number;
};

export type AddAssetResult =
  | { ok: true; asset: Asset }
  | { ok: false; reason: "unsupported" | "blob-failed" | "catalog-failed" };

/**
 * Adds one file to the library.
 *
 * The bytes are written before the metadata, deliberately. The other order can
 * leave a catalog entry pointing at a blob that was never stored - an asset that
 * looks real and fails to open. A leftover blob is the harmless direction: it is
 * invisible and `pruneAssetBlobs` sweeps it up.
 */
export async function addAsset(
  file: File | Blob,
  blobs: BlobStore,
  storage: LikeStorage,
  input: AddAssetInput = {},
): Promise<AddAssetResult> {
  const mime = file.type;
  // Read the name off the object rather than with `instanceof File`: a named
  // Blob carries just as much meaning here, and `File` is missing entirely in
  // some of the runtimes this module is imported from.
  const declaredName = (file as { name?: unknown }).name;
  const defaultName =
    typeof declaredName === "string" && declaredName ? declaredName : "asset";
  const name = normalizeAssetName(input.name ?? defaultName);
  if (!isSupportedAsset(mime)) {
    return { ok: false, reason: "unsupported" };
  }

  const blobKey = makeId();
  if (!(await blobs.put(blobKey, file))) {
    return { ok: false, reason: "blob-failed" };
  }

  const asset: Asset = {
    id: blobKey,
    kind: input.kind ?? guessKind(mime),
    name,
    tags: normalizeTags(input.tags?.length ? input.tags : guessTags(name)),
    bytes: file.size,
    mime,
    addedAt: input.now ?? Date.now(),
    blobKey,
    ...(input.facts?.width ? { width: input.facts.width } : {}),
    ...(input.facts?.height ? { height: input.facts.height } : {}),
    ...(input.facts?.duration ? { duration: input.facts.duration } : {}),
  };

  const existing = readCatalog(storage);
  if (!writeCatalog([asset, ...existing], storage)) {
    // The metadata did not fit, so the asset never existed as far as the user
    // is concerned. Take the bytes back out rather than leaking them.
    await blobs.remove(blobKey);
    return { ok: false, reason: "catalog-failed" };
  }
  return { ok: true, asset };
}

export type AssetPatch = {
  name?: string;
  kind?: AssetKind;
  tags?: string[];
};

/** Rewrites one asset's metadata. Unknown ids report false. */
export function updateAsset(
  assets: readonly Asset[],
  id: string,
  patch: AssetPatch,
  storage: LikeStorage,
): boolean {
  let hit = false;
  const next = assets.map((asset) => {
    if (asset.id !== id) return asset;
    hit = true;
    return {
      ...asset,
      ...(patch.name !== undefined
        ? { name: normalizeAssetName(patch.name) }
        : {}),
      ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
      ...(patch.tags !== undefined ? { tags: normalizeTags(patch.tags) } : {}),
    };
  });
  if (!hit) return false;
  return writeCatalog(next, storage);
}

/** Removes one asset from the catalog, leaving the blob for the pruner. */
export function removeAsset(
  assets: readonly Asset[],
  id: string,
  storage: LikeStorage,
): readonly Asset[] {
  const next = assets.filter((a) => a.id !== id);
  return writeCatalog(next, storage) ? next : assets;
}

/** Drops a blob the catalog no longer mentions, returning how many went. */
export async function pruneAssetBlobs(
  assets: readonly Asset[],
  blobs: BlobStore,
): Promise<number> {
  const live = new Set(assets.map((a) => a.blobKey));
  const keys = await blobs.keys();
  let removed = 0;
  for (const key of keys) {
    if (live.has(key)) continue;
    await blobs.remove(key);
    removed += 1;
  }
  return removed;
}

/**
 * Hands an asset back as a File, which is the shape both editors already take.
 *
 * The name matters: the video studio names the scenes it creates after the
 * file, and the manuscript keys its pool by file name, so a restored asset has
 * to look like the file the author dropped in the first place.
 */
export async function loadAssetFile(
  asset: Asset,
  blobs: BlobStore,
): Promise<File | null> {
  const blob = await blobs.get(asset.blobKey);
  if (!blob) return null;
  const type = blob.type || asset.mime;
  const name = asset.name.includes(".") ? asset.name : `${asset.name}${extFor(asset)}`;
  try {
    return new File([blob], name, { type });
  } catch {
    // `File` is missing in some non-browser runtimes; a Blob with a name is
    // close enough for both call sites.
    const named = blob as Blob & { name?: string };
    named.name = name;
    return named as unknown as File;
  }
}

function extFor(asset: Asset): string {
  const known: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
  };
  return known[asset.mime] ?? "";
}
