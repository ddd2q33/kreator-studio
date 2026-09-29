"use client";

/**
 * The Post Editor's draft state, over local storage.
 *
 * This is the whole reason the store lives in lib/social-store.ts rather than
 * inline in the component: the interesting parts — what happens on a quota
 * failure, what happens to an open textarea when a save is rejected — are exactly
 * the parts worth testing, and they are impossible to reach from inside a
 * component.
 *
 * Persistence is debounced here rather than in the store, because the debounce
 * belongs next to the keystroke that causes it. 600ms is long enough that a
 * sentence is one write, and short enough that closing the tab after a pause
 * loses nothing an author would notice.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  cloneDraft,
  emptyDraft,
  type SocialDraft,
} from "@/lib/social-draft";
import { draftFromTemplate } from "@/lib/social-templates";
import {
  emptySocialStore,
  loadSocialDrafts,
  removeDraft as removeFromStore,
  upsertDraft,
  writeSocialDrafts,
  type SocialStore,
} from "@/lib/social-store";

const SAVE_DEBOUNCE_MS = 600;

export type SocialStudioState = {
  /** False until the store has been read, so the first paint is never a guess. */
  hydrated: boolean;
  drafts: SocialDraft[];
  draft: SocialDraft | null;
  update: (patch: Partial<SocialDraft>) => void;
  select: (id: string) => void;
  newDraft: (templateId: string) => void;
  duplicate: (id: string) => void;
  remove: (id: string) => void;
  /** True while a debounced save is still pending. */
  saving: boolean;
};

export function useSocialStudio(): SocialStudioState {
  const [store, setStore] = useState<SocialStore>(emptySocialStore);
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);

  // Read once, after mount. Reading during render would produce markup that
  // disagrees with the server's on the first pass, and the studio's draft list
  // is exactly the kind of content React will complain about. The setState is
  // deferred a tick for the reason app/video-editor gives for the same read.
  useEffect(() => {
    const t = window.setTimeout(() => {
      const loaded = loadSocialDrafts();
      // An empty store on a first visit would leave the editor with nothing to
      // show, and an empty editor is the least inviting thing in the app. The
      // first post is the default template, not a blank page.
      const withSeed =
        loaded.drafts.length > 0
          ? loaded
          : upsertDraft(loaded, draftFromTemplate("chapter-quote"));
      setStore(withSeed);
      setHydrated(true);
      if (loaded.drafts.length === 0) writeSocialDrafts(withSeed);
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  // Debounced write. The ref holds the latest store so the timer never closes
  // over a stale one, which is the bug that makes a debounced autosave lose the
  // last few keystrokes.
  const pending = useRef<SocialStore | null>(null);
  const timer = useRef<number | null>(null);

  /**
   * Queues a store to be written, and returns it.
   *
   * Returning the store is what lets the `setStore` callbacks below stay
   * updater-shaped — a `setState` that returned void would make the whole write
   * path un-typeable rather than merely awkward.
   */
  const persist = useCallback((next: SocialStore): SocialStore => {
    pending.current = next;
    setSaving(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      const target = pending.current;
      pending.current = null;
      if (!target) {
        setSaving(false);
        return;
      }
      if (!writeSocialDrafts(target)) {
        // The one failure a local-first tool has to be honest about: the posts
        // work in this session and are gone after a reload.
        toast.error(
          "Your posts could not be saved — browser storage is full. Copy anything you cannot lose.",
        );
      }
      setSaving(false);
    }, SAVE_DEBOUNCE_MS);
    return next;
  }, []);

  // A pending save is flushed on unmount. Without this, closing the tab inside
  // the debounce window loses the last sentence, which is the exact moment an
  // author is most likely to close.
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      if (pending.current) writeSocialDrafts(pending.current);
    },
    [],
  );

  const update = useCallback(
    (patch: Partial<SocialDraft>) => {
      setStore((prev) => {
        const current = prev.drafts.find((d) => d.id === prev.activeId);
        if (!current) return prev;
        return persist(upsertDraft(prev, { ...current, ...patch }));
      });
    },
    [persist],
  );

  /**
   * Opens another post without rewriting it.
   *
   * Kept apart from `update` on purpose: `update` patches whichever post is
   * open, so passing an `id` through it would rename the open post rather than
   * switch to the one asked for.
   */
  const select = useCallback(
    (id: string) => {
      setStore((prev) =>
        prev.drafts.some((d) => d.id === id) ? { ...prev, activeId: id } : prev,
      );
    },
    [],
  );

  const newDraft = useCallback(
    (templateId: string) => {
      const created = draftFromTemplate(templateId);
      if (!created.name && created.hook) {
        // A starter with no name of its own borrows the hook, so the drafts
        // list is scannable without the author having to name everything.
        created.name = created.hook.split("\n")[0].slice(0, 60);
      }
      setStore((prev) => persist(upsertDraft(prev, created)));
    },
    [persist],
  );

  const duplicate = useCallback(
    (id: string) => {
      setStore((prev) => {
        const source = prev.drafts.find((d) => d.id === id);
        if (!source) return prev;
        return persist(upsertDraft(prev, cloneDraft(source)));
      });
    },
    [persist],
  );

  const remove = useCallback(
    (id: string) => {
      setStore((prev) => {
        // A store that is about to become empty gets a blank draft back, so the
        // editor is never a dead end with nothing to type into.
        const next = removeFromStore(prev, id);
        return persist(
          next.drafts.length > 0 ? next : upsertDraft(next, emptyDraft()),
        );
      });
    },
    [persist],
  );

  return {
    hydrated,
    drafts: store.drafts,
    draft: store.drafts.find((d) => d.id === store.activeId) ?? null,
    update,
    select,
    newDraft,
    duplicate,
    remove,
    saving,
  };
}
