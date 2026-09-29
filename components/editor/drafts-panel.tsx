"use client";

/**
 * The drafts list.
 *
 * Same role as the manuscript editor's projects panel, and deliberately not more
 * than that: a post is one screen of writing, so the list needs to be a way to
 * get back to something, not a project browser. There is no rename-in-place
 * because the title has an honest fallback — the first line of the hook — and an
 * author with four posts does not need a naming ceremony to find the right one.
 */

import { Copy, Files, Plus, Trash2 } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { draftTitle, type SocialDraft } from "@/lib/social-draft";
import { composePost, networkById } from "@/lib/social-networks";

export function DraftsPanel({
  drafts,
  activeId,
  onSelect,
  onNew,
  onDuplicate,
  onRemove,
  onClose,
}: {
  drafts: SocialDraft[];
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Files className="size-3.5" />
          Posts
        </span>
        <span className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-2 text-xs"
            onClick={onNew}
            title="Start a post from a template"
          >
            <Plus className="size-3.5" />
            New
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={onClose}
          >
            Close
          </Button>
        </span>
      </div>
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {drafts.map((draft) => {
          const active = draft.id === activeId;
          // The count is the widest network's view of the post, not the
          // narrowest: a number that says "fits" when TikTok will cut it in half
          // is worse than no number at all.
          const tightest = composePost(draft, networkById("x"));
          return (
            <li key={draft.id}>
              <div
                className={cn(
                  "group flex items-center gap-1 rounded border px-2 py-1.5 transition-colors",
                  active ? "border-ring bg-muted/50" : "hover:border-ring",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(draft.id)}
                  aria-pressed={active}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-xs font-medium">
                    {draftTitle(draft)}
                  </span>
                  <span
                    className={cn(
                      "mt-0.5 block font-mono text-[10px] tabular-nums",
                      tightest.overHard
                        ? "text-red-600 dark:text-red-400"
                        : "text-muted-foreground/70",
                    )}
                  >
                    {tightest.remaining} left on X
                  </span>
                </button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={() => onDuplicate(draft.id)}
                  title="Duplicate this post"
                >
                  <Copy className="size-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="shrink-0 text-muted-foreground hover:text-destructive focus-visible:text-destructive opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={() => onRemove(draft.id)}
                  title="Delete this post"
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
