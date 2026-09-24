"use client";

import { useState } from "react";
import { Check, MessageSquarePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import type { ProjectComment } from "@/lib/projects";

export function CommentsPanel({
  comments,
  chapterTitle,
  onAdd,
  onToggleResolved,
  onDelete,
  onClose,
}: {
  comments: ProjectComment[];
  chapterTitle: string;
  onAdd: (body: string) => void;
  onToggleResolved: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [body, setBody] = useState("");

  const submit = () => {
    const text = body.trim();
    if (!text) return;
    onAdd(text);
    setBody("");
  };

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <MessageSquarePlus className="size-3.5" />
          Notes
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={onClose}
          aria-label="Close notes"
        >
          <X className="size-3.5" />
          Close
        </Button>
      </div>

      <div className="border-b px-3 py-1.5">
        <p className="text-[11px] text-muted-foreground">
          Notes on{" "}
          <span className="font-medium text-foreground">{chapterTitle}</span>
        </p>
      </div>

      <div className="flex items-start gap-2 border-b px-3 py-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Add a note or comment…"
          className="min-h-16 flex-1 resize-y rounded border bg-background px-2 py-1.5 text-xs outline-none focus:border-ring"
          aria-label="New note"
        />
        <Button
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={submit}
          disabled={!body.trim()}
        >
          Add
        </Button>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {comments.length === 0 && (
          <li className="px-2 py-3 text-xs text-muted-foreground">
            No notes yet. Keep editorial comments close to the chapter they
            belong to.
          </li>
        )}
        {comments.map((c) => (
          <li
            key={c.id}
            className={cn(
              "group mb-1 rounded border bg-background px-2 py-1.5 text-xs",
              c.resolved && "opacity-60",
            )}
          >
            <p
              className={cn(
                "whitespace-pre-wrap",
                c.resolved && "line-through",
              )}
            >
              {c.body}
            </p>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">
                {new Date(c.createdAt).toLocaleString()}
              </span>
              <span className="flex gap-1">
                <button
                  type="button"
                  className={cn(
                    "rounded p-0.5 transition-colors",
                    c.resolved
                      ? "text-emerald-600"
                      : "text-muted-foreground hover:text-emerald-600",
                  )}
                  onClick={() => onToggleResolved(c.id)}
                  title={c.resolved ? "Mark unresolved" : "Mark resolved"}
                >
                  <Check className="size-3.5" />
                </button>
                <button
                  type="button"
                  className="rounded p-0.5 text-muted-foreground transition-colors hover:text-red-600"
                  onClick={() => onDelete(c.id)}
                  title="Delete note"
                >
                  <X className="size-3.5" />
                </button>
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}