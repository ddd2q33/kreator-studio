"use client";

import { useId, useState } from "react";
import { ChevronDown, Circle, Download, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "cn";

/**
 * One export picker, shared by the manuscript editor and the video studio.
 *
 * Both editors used to grow their own export control: a select plus a button in
 * the studio, a dropdown of six items in the manuscript editor. Two shapes for
 * one job means the availability rules, the busy state and the "why is this
 * greyed out" explanation all had to be written twice, and they drifted. This
 * component takes the list of things that *can* be exported and renders the
 * choice, the explanation and the action, so each editor only has to describe
 * its own targets.
 */
export type ExportTarget = {
  /** Stable id, also the default selection key. */
  id: string;
  /** Short name shown in the list, e.g. "Word document". */
  label: string;
  /** File extension without the dot, shown on the action button. */
  extension: string;
  /** One line on what lands in the file. */
  hint: string;
  /** Video renders a file, a project archive ships many; picks the icon. */
  isVideo?: boolean;
  /**
   * Does the work. May be async; the hub shows the busy state for as long as
   * the returned promise is pending, so a target does not need its own flag.
   */
  run: () => void | Promise<void>;
  /** False when the target cannot run right now, e.g. no browser support. */
  available?: boolean;
  /** Why it is unavailable, shown instead of running. */
  reason?: string | null;
};

export function ExportHub({
  targets,
  className,
  /** Which target to start on; falls back to the first available one. */
  defaultId,
  emptyLabel = "There is nothing to export yet.",
}: {
  targets: readonly ExportTarget[];
  className?: string;
  defaultId?: string;
  emptyLabel?: string;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [chosenId, setChosenId] = useState<string | null>(defaultId ?? null);
  const labelId = useId();

  if (targets.length === 0) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>{emptyLabel}</p>
    );
  }

  // An explicit default wins, then whatever the author last picked, then the
  // first target that can actually run - so the button is never dead on open
  // because the list happens to start with an unsupported format.
  const chosen =
    targets.find((t) => t.id === chosenId) ??
    targets.find((t) => t.id === defaultId) ??
    targets.find((t) => t.available !== false) ??
    targets[0]!;

  const busy = busyId !== null;
  const available = chosen.available !== false;
  const disabled = busy || !available;

  const run = async () => {
    if (disabled) return;
    setBusyId(chosen.id);
    try {
      await chosen.run();
    } finally {
      // Cleared in a finally: a target that throws must not leave the whole
      // hub stuck on its spinner with every other format unclickable.
      setBusyId(null);
    }
  };

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="max-w-[15rem] justify-between gap-1"
            aria-labelledby={labelId}
            title={chosen.hint}
          >
            <span id={labelId} className="truncate">
              {chosen.label}
            </span>
            <ChevronDown className="size-3.5 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          {targets.map((target) => {
            const targetAvailable = target.available !== false;
            return (
              <DropdownMenuItem
                key={target.id}
                onSelect={() => setChosenId(target.id)}
                disabled={!targetAvailable}
                className="flex-col items-start gap-0.5"
              >
                <span className="flex w-full items-center gap-2">
                  {target.isVideo ? (
                    <Download className="size-3.5" />
                  ) : (
                    <Package className="size-3.5" />
                  )}
                  <span className="font-medium">{target.label}</span>
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                    .{target.extension}
                  </span>
                </span>
                <span className="pl-5.5 text-[11px] text-muted-foreground">
                  {targetAvailable
                    ? target.hint
                    : (target.reason ?? "Not available in this browser.")}
                </span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        onClick={() => void run()}
        disabled={disabled}
        variant={busy ? "secondary" : "default"}
        size="sm"
        className={cn(busy && "text-amber-600")}
        title={available ? chosen.hint : (chosen.reason ?? "Not available in this browser.")}
      >
        {busy ? (
          <>
            <Circle className="size-3 fill-amber-500 text-amber-500" />
            Exporting…
          </>
        ) : (
          <>
            {chosen.isVideo ? (
              <Download className="size-3.5" />
            ) : (
              <Package className="size-3.5" />
            )}
            Download .{chosen.extension}
          </>
        )}
      </Button>
    </div>
  );
}
