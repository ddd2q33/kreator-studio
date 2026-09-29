import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SOCIAL_DRAFTS_KEY,
  draftHashtagsString,
  emptySocialStore,
  loadSocialDrafts,
  removeDraft,
  upsertDraft,
  writeSocialDrafts,
} from "../lib/social-store.ts";
import { emptyDraft, type SocialDraft } from "../lib/social-draft.ts";

/** A Storage stand-in, so this runs without a DOM. */
function memory(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    get size() {
      return map.size;
    },
    raw: map,
  };
}

/** A Storage that refuses every write, which is what a full quota looks like. */
const full = {
  getItem: () => null,
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

const sample = (id: string, over: Partial<SocialDraft> = {}): SocialDraft => ({
  ...emptyDraft(),
  id,
  name: `Post ${id}`,
  hook: "A hook",
  ...over,
});

describe("the draft store", () => {
  it("round-trips a store", () => {
    const storage = memory();
    const store = { activeId: "a", drafts: [sample("a"), sample("b")] };
    assert.equal(writeSocialDrafts(store, storage), true);
    assert.deepEqual(loadSocialDrafts(storage), store);
  });

  it("uses its own key, so it cannot collide with the book projects", () => {
    // The two studios used to share one store and each one's idea of "the
    // current document" clobbered the other's.
    assert.equal(SOCIAL_DRAFTS_KEY, "book-studio-social-drafts");
  });

  it("returns an empty store for a key that was never written", () => {
    assert.deepEqual(loadSocialDrafts(memory()), emptySocialStore());
  });

  it("returns an empty store for corrupt JSON rather than throwing", () => {
    const storage = memory({ [SOCIAL_DRAFTS_KEY]: "{ not json" });
    assert.deepEqual(loadSocialDrafts(storage), emptySocialStore());
  });

  it("returns an empty store when drafts is not an array", () => {
    const storage = memory({ [SOCIAL_DRAFTS_KEY]: '{"drafts": "nope"}' });
    assert.deepEqual(loadSocialDrafts(storage), emptySocialStore());
  });

  it("normalises the drafts it loads, so a bad field cannot reach the UI", () => {
    const storage = memory({
      [SOCIAL_DRAFTS_KEY]: JSON.stringify({
        activeId: "a",
        drafts: [{ id: "a", hook: 42, name: "Kept", hashtags: ["#one", 7] }],
      }),
    });
    const loaded = loadSocialDrafts(storage);
    assert.equal(loaded.drafts.length, 1);
    assert.equal(loaded.drafts[0].hook, "");
    assert.equal(loaded.drafts[0].name, "Kept");
    assert.deepEqual(loaded.drafts[0].hashtags, ["one"]);
  });

  it("keeps a draft written by a newer version, minus the fields it cannot read", () => {
    const storage = memory({
      [SOCIAL_DRAFTS_KEY]: JSON.stringify({
        activeId: "a",
        drafts: [{ id: "a", hook: "H", someFutureField: { big: true } }],
      }),
    });
    const loaded = loadSocialDrafts(storage);
    assert.equal(loaded.drafts[0].hook, "H");
    assert.equal((loaded.drafts[0] as unknown as Record<string, unknown>).someFutureField, undefined);
  });

  it("points activeId at the first draft when the stored one is gone", () => {
    const storage = memory({
      [SOCIAL_DRAFTS_KEY]: JSON.stringify({ activeId: "deleted", drafts: [sample("a")] }),
    });
    assert.equal(loadSocialDrafts(storage).activeId, "a");
  });

  it("reports a failed write, which is almost always a full quota", () => {
    // The posts still work in this session and are gone after a reload, which is
    // the one failure mode a local-first tool has to be honest about.
    assert.equal(writeSocialDrafts(emptySocialStore(), full), false);
  });
});

describe("upsertDraft", () => {
  it("adds a new draft at the front, so it is the one being worked on", () => {
    const store = upsertDraft({ activeId: "a", drafts: [sample("a")] }, sample("b"));
    assert.deepEqual(store.drafts.map((d) => d.id), ["b", "a"]);
    assert.equal(store.activeId, "b");
  });

  it("replaces an existing draft in place, keeping its position", () => {
    let store = upsertDraft(emptySocialStore(), sample("a"));
    store = upsertDraft(store, sample("b"));
    store = upsertDraft(store, sample("a", { hook: "Changed" }));
    // "b" was the most recent addition, so it is at the front; updating "a"
    // must not move it.
    assert.deepEqual(store.drafts.map((d) => d.id), ["b", "a"]);
    assert.equal(store.drafts[1].hook, "Changed");
  });

  it("does not mutate the store it was given", () => {
    const original = { activeId: "a", drafts: [sample("a")] };
    upsertDraft(original, sample("b"));
    assert.equal(original.drafts.length, 1);
  });
});

describe("removeDraft", () => {
  it("moves the selection on when the active draft is removed", () => {
    let store = upsertDraft(emptySocialStore(), sample("a"));
    store = upsertDraft(store, sample("b"));
    store = { ...store, activeId: "b" };
    assert.equal(removeDraft(store, "b").activeId, "a");
  });

  it("leaves the selection alone when a different draft is removed", () => {
    let store = upsertDraft(emptySocialStore(), sample("a"));
    store = upsertDraft(store, sample("b"));
    assert.equal(removeDraft(store, "a").activeId, "b");
  });

  it("clears the selection when the last draft goes", () => {
    const store = { activeId: "a", drafts: [sample("a")] };
    assert.deepEqual(removeDraft(store, "a"), emptySocialStore());
  });
});

describe("draftHashtagsString", () => {
  it("adds the hashes a caption needs", () => {
    assert.equal(draftHashtagsString(sample("a", { hashtags: ["trauma", "#healing"] })), "#trauma #healing");
  });

  it("is empty for a post with no tags", () => {
    assert.equal(draftHashtagsString(sample("a", { hashtags: [] })), "");
  });
});
