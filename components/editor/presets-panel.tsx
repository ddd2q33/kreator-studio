"use client";

import { Library, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BOOK_PRESETS } from "./book-presets";

export function PresetsPanel({
  currentTemplateId,
  onApply,
  onClose,
}: {
  currentTemplateId: string;
  onApply: (presetId: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Library className="size-3.5" />
          Book presets
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={onClose}
          aria-label="Close presets"
        >
          <X className="size-3.5" />
          Close
        </Button>
      </div>
      <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
        {BOOK_PRESETS.map((preset) => {
          const Icon = preset.icon;
          const active = preset.templateId === currentTemplateId;
          return (
            <li key={preset.id}>
              <button
                type="button"
                onClick={() => onApply(preset.id)}
                className="flex w-full items-center gap-2 rounded border bg-background px-2 py-2 text-left transition-colors hover:border-ring"
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium">
                    {preset.label}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {preset.description}
                  </span>
                </span>
                {active && (
                  <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                    Active
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}