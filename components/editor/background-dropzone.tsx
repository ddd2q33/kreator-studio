"use client";

/**
 * The background photo: drop it, or click to choose it.
 *
 * The whole zone is a <button> rather than a div with a handler, so it is
 * reachable by keyboard and announced as a control without a single ARIA
 * attribute — a div with onClick is invisible to a screen reader and to Tab.
 */

import { useCallback, useId, useRef, useState } from "react";
import { ImageIcon, LoaderCircle, Trash2, Upload } from "lucide-react";
import { cn } from "cn";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { formatBytes, prepareBackground } from "@/lib/image-prepare";

export function BackgroundDropzone({
  background,
  disabled,
  onPick,
  onClear,
}: {
  /** The current data URL, or undefined when there is no photo. */
  background?: string;
  /** True for the solid and gradient layouts, which ignore a photo entirely. */
  disabled?: boolean;
  onPick: (dataUrl: string) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const describedBy = useId();

  const take = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setBusy(true);
      try {
        const result = await prepareBackground(file);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        onPick(result.dataUrl);
        toast.success(
          `Background set — ${result.width}×${result.height}, ${formatBytes(
            result.bytes,
          )}.`,
        );
      } finally {
        setBusy(false);
      }
    },
    [onPick],
  );

  if (disabled) {
    return (
      <p className="rounded-lg border border-dashed px-3 py-4 text-[11px] leading-snug text-muted-foreground">
        This layout uses a flat colour, so there is no photo to drop. Pick
        <span className="font-medium"> Photo + veil </span>
        or<span className="font-medium"> Photo + panel </span>
        to use one.
      </p>
    );
  }

  if (background) {
    return (
      <div className="space-y-2">
        {/* The thumbnail is the raw data URL, which is also what the renderer
            will use, so what is shown here is exactly what gets exported. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- a local data URL; the image optimiser only handles remote sources and would add a round trip for nothing */}
        <img
          src={background}
          alt="The background chosen for this post"
          className="h-28 w-full rounded-lg border object-cover"
        />
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 flex-1 gap-1 px-2 text-xs"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? (
              <LoaderCircle className="size-3 animate-spin" />
            ) : (
              <Upload className="size-3" />
            )}
            Replace
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs text-muted-foreground"
            onClick={onClear}
          >
            <Trash2 className="size-3" />
            Remove
          </Button>
        </div>
        <BackgroundInput ref={inputRef} onTake={take} />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={busy}
        aria-describedby={describedBy}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          // preventDefault on dragover is what marks a target as a drop zone.
          // Without it the browser navigates to the dropped file and the post
          // is lost along with the tab.
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void take(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 py-6 text-center transition-colors",
          "hover:border-ring hover:bg-muted/40 disabled:opacity-60",
          dragging && "border-ring bg-muted/60",
        )}
      >
        {busy ? (
          <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
        ) : (
          <ImageIcon className="size-5 text-muted-foreground" />
        )}
        <span className="text-xs font-medium">
          {busy ? "Preparing the image…" : "Drop a photo, or click to choose"}
        </span>
      </button>
      <p id={describedBy} className="text-[10px] leading-snug text-muted-foreground">
        Resized to 1600px on the long edge and kept in this browser, so the post
        still works with no connection.
      </p>
      <BackgroundInput ref={inputRef} onTake={take} />
    </div>
  );
}

/**
 * The file input is always mounted, even when it is not the visible control.
 *
 * An input created on click and discarded afterwards loses the author's chosen
 * file every time the panel re-renders, and on some platforms a fresh picker
 * opens with the previous location still forgotten.
 */
function BackgroundInput({
  ref,
  onTake,
}: {
  ref: React.RefObject<HTMLInputElement | null>;
  onTake: (file: File | undefined) => void;
}) {
  return (
    <input
      ref={ref}
      type="file"
      accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
      className="sr-only"
      onChange={(e) => {
        void onTake(e.target.files?.[0]);
        // Cleared so choosing the same file twice in a row still fires onChange.
        e.target.value = "";
      }}
    />
  );
}
