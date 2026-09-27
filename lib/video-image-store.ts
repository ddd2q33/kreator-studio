/**
 * The video studio's own image pool.
 *
 * Images used to live in a single global pool that /manuscript-editor and
 * /video-editor both read and wrote, so an image dropped on a scene card turned
 * up in the manuscript gallery and vice versa. Worse, the manuscript's "clear
 * uploaded images" button rewrote that shared key with an empty object, which
 * silently left every saved video scene pointing at an image that no longer
 * existed.
 *
 * Each studio now keeps its own pool, so the two are independent. The video pool
 * is seeded once from the old shared key so scenes saved before the split keep
 * their pictures; after that the legacy key is never read or written again, and
 * the manuscript keeps its own copy of what it always had.
 *
 * Storage is injectable so this is testable without a DOM.
 */

/** Key owned exclusively by /video-editor. */
export const VIDEO_IMAGES_KEY = "book-studio-video-images";

/** The old shared key, read once for migration and then left alone. */
export const LEGACY_IMAGES_KEY = "markdown-converter-images";

/** Maps an image key (usually a file name) to a data URL. */
export type ImagePool = Record<string, string>;

/** Just the Storage surface used here, so tests can pass a plain object. */
type LikeStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/**
 * Reads a pool, returning null when the key is absent.
 *
 * An empty pool and a missing key are different answers on purpose: a missing
 * key is what triggers the one-time migration, and an existing empty pool means
 * the user really did clear their images and must not be re-seeded.
 */
function readPool(storage: LikeStorage, key: string): ImagePool | null {
  try {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as { images?: unknown };
    const images = parsed?.images;
    if (!images || typeof images !== "object" || Array.isArray(images)) {
      return null;
    }
    const pool: ImagePool = {};
    for (const [k, v] of Object.entries(images as Record<string, unknown>)) {
      // A non-string entry would poison a data URL later; drop it here instead.
      if (typeof v === "string" && v.length > 0) pool[k] = v;
    }
    return pool;
  } catch {
    return null;
  }
}

/** Writes the pool, reporting whether it stuck. False means the quota is full. */
export function writeVideoImages(
  images: ImagePool,
  storage: LikeStorage = window.localStorage,
): boolean {
  try {
    storage.setItem(VIDEO_IMAGES_KEY, JSON.stringify({ images }));
    return true;
  } catch {
    return false;
  }
}

export type LoadedVideoImages = {
  images: ImagePool;
  /**
   * Set only on the load that copied the manuscript pool over, and null on every
   * load after that.
   *
   * `persisted` is the half that matters to the user: a failed write is almost
   * always a full quota, and the images still work in this session but are gone
   * after a reload. The two facts are kept apart because "this pool was seeded"
   * is normal and silent, while "the seed did not stick" has to be reported.
   */
  migration: { seeded: boolean; persisted: boolean } | null;
};

/**
 * Loads the video pool, seeding it from the legacy shared key the first time.
 *
 * Seeding is a copy: the manuscript's own key is left exactly as it was, so the
 * two studios diverge from here on instead of continuing to mirror each other.
 */
export function loadVideoImages(
  storage: LikeStorage = window.localStorage,
): LoadedVideoImages {
  const own = readPool(storage, VIDEO_IMAGES_KEY);
  if (own !== null) return { images: own, migration: null };

  const legacy = readPool(storage, LEGACY_IMAGES_KEY);
  if (legacy === null) return { images: {}, migration: null };

  return {
    images: legacy,
    migration: { seeded: true, persisted: writeVideoImages(legacy, storage) },
  };
}
