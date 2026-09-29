"use client";

/**
 * A drag handle that resizes the panel beside it.
 *
 * The parent owns the width and the clamping; this component only reports
 * deltas, which keeps it honest about one thing: it never knows what it is
 * resizing. Pointer capture means a drag that leaves the handle keeps coming
 * here, so the handle cannot "drop" the panel mid-drag when the cursor outruns
 * it — the classic bug that makes resizers feel broken.
 *
 * It is also a real separator, not a decorated div: arrow keys move the edge a
 * step, Shift doubles the step, Home and End jump to the limits, and the value
 * is exposed to assistive tech. A pointer-only resize would lock out exactly
 * the people who need the bigger panels the most.
 */

import { useRef } from "react";
import { cn } from "cn";

export function Resizer({
  value,
  min,
  max,
  onDelta,
  onReset,
  ariaLabel,
  className,
}: {
  /** Current width of the panel this handle resizes, for the ARIA value. */
  value: number;
  min: number;
  max: number;
  /** Pixels the panel should grow by. The parent clamps. */
  onDelta: (delta: number) => void;
  /** Double-click returns the panel to its default width. */
  onReset?: () => void;
  ariaLabel: string;
  className?: string;
}) {
  const dragging = useRef(false);
  const last = useRef(0);

  const down = (event: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    last.current = event.clientX;
    event.currentTarget.setPointerCapture(event.pointerId);
    // The page must not select text while the edge is dragged; the cursor is
    // set on the body because the pointer will leave the handle immediately.
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const delta = event.clientX - last.current;
    last.current = event.clientX;
    if (delta !== 0) onDelta(delta);
  };

  const up = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  const key = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 48 : 16;
    if (event.key === "ArrowLeft") {
      onDelta(-step);
      event.preventDefault();
    } else if (event.key === "ArrowRight") {
      onDelta(step);
      event.preventDefault();
    } else if (event.key === "Home") {
      onDelta(min - value);
      event.preventDefault();
    } else if (event.key === "End") {
      onDelta(max - value);
      event.preventDefault();
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
      onDoubleClick={onReset}
      className={cn(
        "group relative z-10 flex w-1.5 shrink-0 cursor-col-resize touch-none items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {/* The visible grip is a short line that only appears on hover or focus,
          so the seams stay invisible until they are wanted. */}
      <span
        aria-hidden
        className="h-10 w-0.5 rounded-full bg-transparent transition-colors group-hover:bg-border group-focus-visible:bg-ring"
      />
    </div>
  );
}
