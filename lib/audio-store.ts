/**
 * Blob storage for the audio files dropped onto a scene.
 *
 * Audio cannot live in `localStorage` the way scene images do: a one minute MP3
 * is around 1 MB, and base64 inflates it by a third, so the ~5 MB origin quota
 * would be gone after three or four files. IndexedDB stores the Blob itself
 * with no practical size limit, so scenes only keep the key plus the metadata
 * the editor needs to show before the blob is read back.
 *
 * The IndexedDB handling itself lives in `blob-store`, shared with the asset
 * library. This file is the scene-clip specific half: which database, and the
 * prune that keeps orphaned clips from piling up.
 *
 * Everything is best-effort: a browser in private mode, or one with storage
 * disabled, can refuse to open the database. Callers get `null`/throw and
 * decide how loud to be about it rather than crashing the editor.
 */

import { createBlobStore } from "./blob-store.ts";

const store = createBlobStore("book-studio-audio", "clips");

/** True when this browser can store blobs at all. */
export function isAudioStoreAvailable(): boolean {
  return store.isAvailable();
}

/** Stores a clip under `key`, replacing any previous blob. */
export function putAudioClip(key: string, blob: Blob): Promise<boolean> {
  return store.put(key, blob);
}

/** Reads a clip back, or `null` when it is missing or storage failed. */
export function getAudioClip(key: string): Promise<Blob | null> {
  return store.get(key);
}

/** Removes a clip. Safe to call for a key that was never stored. */
export function deleteAudioClip(key: string): Promise<void> {
  return store.remove(key);
}

/** Every key currently held, so orphans can be pruned. */
export function listAudioClipKeys(): Promise<string[]> {
  return store.keys();
}

/**
 * Drops clips no scene points at any more.
 *
 * Replacing a scene's audio leaves the previous blob behind, and dropping a
 * whole video in creates a burst of new scenes, so this runs on an idle
 * callback after those edits settle instead of on every keystroke.
 */
export function pruneAudioClips(liveKeys: Iterable<string>): void {
  const keep = new Set(liveKeys);
  const run_ = () => {
    void listAudioClipKeys().then(async (keys) => {
      for (const key of keys) {
        if (!keep.has(key)) await deleteAudioClip(key);
      }
    });
  };
  if (typeof requestIdleCallback === "function") requestIdleCallback(run_);
  else setTimeout(run_, 1000);
}
