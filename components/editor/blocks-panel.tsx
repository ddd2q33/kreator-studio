"use client";

import { useRef } from "react";
import { Blocks, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BLOCK_LIBRARY, insertBlockAt, type BlockSnippet } from "./block-library";
import { applyMarkdown } from "./writer-toolbar";

export function BlocksPanel({
  textareaRef,
  value,
  onChange,
  onClose,
  disabled,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (next: string) => void;
  onClose: () => void;
  disabled?: boolean;
}) {
  const lastOffsetRef = useRef<number | null>(null);

  const apply = (block: BlockSnippet) => {
    applyMarkdown(textareaRef, value, (_selected, start) => {
      const offset =
        lastOffsetRef.current !== null
          ? lastOffsetRef.current
          : start;
      const { next, caret } = insertBlockAt(value, block.snippet, offset);
      lastOffsetRef.current = caret;
      return next;
    }, onChange);
  };

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Blocks className="size-3.5" />
          Blocks
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={onClose}
          aria-label="Close blocks"
        >
          <X className="size-3.5" />
          Close
        </Button>
      </div>
      <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
        {BLOCK_LIBRARY.map((block) => {
          const Icon = block.icon;
          return (
            <li key={block.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => apply(block)}
                className="flex w-full items-center gap-2 rounded border bg-background px-2 py-2 text-left transition-colors hover:border-ring disabled:opacity-50"
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium">
                    {block.title}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {block.description}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}