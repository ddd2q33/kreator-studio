/**
 * The Post Editor's draft list.
 *
 * Local storage, like every other store in the studio, and for the same reason:
 * a post is a piece of writing, it is being written over days rather than
 * minutes, and there is no server here to keep it. The key is owned exclusively
 * by /social-editor for the same reason the video pool is — the two studios used
 * to share one store and each one's idea of "the current document" clobbered the
 * other's.
 *
 * Storage is injectable so this is testable without a DOM, following
 * lib/video-image-store.ts.
 *
 * Writes are debounced by the caller, not here. The debounce belongs next to the
 * keystroke that causes it: this module only has to be correct about what it
 * stores and honest about whether it stored it.
 */

import { normalizeDraft, type SocialDraft } from "./social-draft.ts";

/** Key owned exclusively by /social-editor. */
export const SOCIAL_DRAFTS_KEY = "book-studio-social-drafts";

export type SocialStore = {
  activeId: string;
  drafts: SocialDraft[];
};

/** Just the Storage surface used here, so tests can pass a plain object. */
type LikeStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export function emptySocialStore(): SocialStore {
  return { activeId: "", drafts: [] };
}

/**
 * Loads the store.
 *
 * A missing key and a corrupt one are the same answer here — an empty store —
 * because unlike the video image pool there is no migration to run and nothing
 * recoverable to protect. But a store that parsed and then lost every draft is
 * not the same as an empty one, so an entry that fails `normalizeDraft`'s id
 * check is kept rather than dropped: drafts written by a future version of the
 * app should survive a downgrade, just with their unknown fields removed.
 */
export function loadSocialDrafts(
  storage: LikeStorage = window.localStorage,
): SocialStore {
  try {
    const raw = storage.getItem(SOCIAL_DRAFTS_KEY);
    if (!raw) return emptySocialStore();
    const parsed = JSON.parse(raw) as { activeId?: unknown; drafts?: unknown };
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.drafts)) {
      return emptySocialStore();
    }
    const drafts = parsed.drafts
      .filter((d) => d && typeof d === "object")
      .map((d) => normalizeDraft(d));
    const activeId =
      typeof parsed.activeId === "string" &&
      drafts.some((d) => d.id === parsed.activeId)
        ? parsed.activeId
        : (drafts[0]?.id ?? "");
    return { activeId, drafts };
  } catch {
    return emptySocialStore();
  }
}

/**
 * Writes the store, reporting whether it stuck.
 *
 * False means the quota is full. The caller has to show that: the posts still
 * work in this session and are gone after a reload, which is the one failure
 * mode a local-first tool has to be honest about.
 */
export function writeSocialDrafts(
  store: SocialStore,
  storage: LikeStorage = window.localStorage,
): boolean {
  try {
    storage.setItem(SOCIAL_DRAFTS_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

/** Replaces one draft in the list, appending it when it is new. */
export function upsertDraft(store: SocialStore, draft: SocialDraft): SocialStore {
  const index = store.drafts.findIndex((d) => d.id === draft.id);
  const drafts = [...store.drafts];
  if (index === -1) drafts.unshift(draft);
  else drafts[index] = draft;
  return { activeId: draft.id, drafts };
}

export function removeDraft(store: SocialStore, id: string): SocialStore {
  const drafts = store.drafts.filter((d) => d.id !== id);
  return {
    activeId: store.activeId === id ? (drafts[0]?.id ?? "") : store.activeId,
    drafts,
  };
}

export function draftHashtagsString(draft: SocialDraft): string {
  return draft.hashtags
    .map((t) => (/^#/.test(t) ? t : `#${t}`))
    .join(" ");
}
