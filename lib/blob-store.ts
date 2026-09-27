/**
 * A named blob slot in IndexedDB, with none of the ceremony.
 *
 * Both the scene audio clips and the asset library need the same thing: put a
 * Blob under a string key, get it back later, list the keys, delete one. That is
 * enough of a surface to be worth writing once, because the fiddly part is not
 * the API, it is surviving a browser that refuses to cooperate.
 *
 * Every operation here is best-effort and never throws. Private mode, storage
 * disabled, a blocked upgrade from another tab, a corrupt database - all of them
 * resolve to `null`/`false` rather than rejecting, because an editor that cannot
 * save a file should still let the author type. Callers decide how loudly to
 * report it, which is the same contract `audio-store` had.
 */

/** The Blob operations a store exposes, so tests can pass a plain object. */
export type BlobStore = {
  /** True when this browser has IndexedDB at all. */
  isAvailable(): boolean;
  /** Stores a blob, replacing any previous one. False means it did not stick. */
  put(key: string, blob: Blob): Promise<boolean>;
  /** Reads a blob back, or `null` when it is missing or storage failed. */
  get(key: string): Promise<Blob | null>;
  /** Removes a blob. Safe to call for a key that was never stored. */
  remove(key: string): Promise<void>;
  /** Every key currently held, so orphans can be pruned. */
  keys(): Promise<string[]>;
  /** Empties the whole store. */
  clear(): Promise<void>;
};

export function createBlobStore(
  dbName: string,
  storeName: string,
): BlobStore {
  let dbPromise: Promise<IDBDatabase | null> | null = null;

  const isAvailable = () => typeof indexedDB !== "undefined";

  function openDb(): Promise<IDBDatabase | null> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise<IDBDatabase | null>((resolve) => {
      if (!isAvailable()) {
        resolve(null);
        return;
      }
      let request: IDBOpenDBRequest;
      try {
        request = indexedDB.open(dbName, 1);
      } catch {
        // Some privacy modes throw on open instead of failing the request.
        resolve(null);
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      // Without this a blocked upgrade (an older tab holding the database open)
      // leaves every later call pending forever.
      request.onblocked = () => resolve(null);
    }).then((db) => {
      if (!db) {
        // Let a later call retry instead of caching the failure forever.
        dbPromise = null;
      }
      return db;
    });
    return dbPromise;
  }

  function run<T>(
    mode: IDBTransactionMode,
    body: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T | null> {
    return openDb().then(
      (db) =>
        new Promise<T | null>((resolve) => {
          if (!db) {
            resolve(null);
            return;
          }
          let request: IDBRequest<T>;
          try {
            request = body(db.transaction(storeName, mode).objectStore(storeName));
          } catch {
            resolve(null);
            return;
          }
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(null);
        }),
    );
  }

  return {
    isAvailable,
    async put(key, blob) {
      const result = await run("readwrite", (store) => store.put(blob, key));
      // `put` resolves with the key, so a null here means the write failed.
      return result !== null;
    },
    get(key) {
      return run<Blob>("readonly", (store) => store.get(key));
    },
    async remove(key) {
      await run("readwrite", (store) => store.delete(key));
    },
    async keys() {
      const result = await run<IDBValidKey[]>("readonly", (store) =>
        store.getAllKeys(),
      );
      return result?.filter((k): k is string => typeof k === "string") ?? [];
    },
    async clear() {
      await run("readwrite", (store) => store.clear());
    },
  };
}
