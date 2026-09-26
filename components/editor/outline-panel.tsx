"use client";

import { useMemo, useState } from "react";
import { ListTree, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

type OutlineHeading = {
  level: number;
  text: string;
  offset: number;
};

function extractHeadings(markdown: string): OutlineHeading[] {
  const headings: OutlineHeading[] = [];
  let offset = 0;
  for (const line of markdown.split("\n")) {
    const match = /^(#{1,6})\s+(.+)$/.exec(line);
    if (match) {
      const level = match[1].length;
      headings.push({ level, text: match[2].trim(), offset });
    }
    offset += line.length + 1;
  }
  return headings;
}

export function OutlinePanel({
  text,
  onNavigate,
  onClose,
}: {
  text: string;
  onNavigate: (offset: number) => void;
  onClose: () => void;
}) {
  const headings = useMemo(() => extractHeadings(text), [text]);
  const [active, setActive] = useState<number | null>(null);

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <ListTree className="size-3.5" />
          Outline
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={onClose}
          aria-label="Close outline"
        >
          <X className="size-3.5" />
          Close
        </Button>
      </div>

      <div
        className="min-h-0 flex-1 space-y-px overflow-y-auto p-2"
        aria-label="Document headings"
      >
        {headings.length === 0 && (
          <p className="px-1 py-2 text-xs text-muted-foreground">
            No headings yet — start a line with <code>#</code>–<code>######</code>.
          </p>
        )}
        {headings.map((h, index) => (
          <button
            key={`${h.offset}-${h.text}`}
            type="button"
            onClick={() => {
              setActive(index);
              onNavigate(h.offset);
            }}
            className={cn(
              "block w-full rounded px-2 py-1 text-left text-xs transition-colors",
              index === active
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            style={{ paddingLeft: `${8 + (h.level - 1) * 12}px` }}
          >
            <span className="mr-1 text-[10px] font-semibold text-muted-foreground/60">
              {"#".repeat(h.level)}
            </span>
            {h.text}
          </button>
        ))}
      </div>
    </div>
  );
}