"use client";

/**
 * The drag surface over the preview.
 *
 * The marks are drawn by the iframe, not here. This layer is invisible and draws
 * nothing but a selection outline: it exists to answer two questions — which
 * mark is under the pointer, and where did it go when the pointer moved.
 *
 * Placing it that way is what keeps the guarantee from `image-canvas`. The iframe
 * still renders the single string that gets sent to the headless browser, and
 * the hit targets are positioned from the same `elementBox` the renderer used.
 * A React version that drew the marks itself would be a second implementation of
 * the layout, and the preview would stop being evidence of anything.
 *
 * The layer is built at canvas size and scaled with the same transform as the
 * iframe, so a position in canvas pixels is the same number in both places and
 * no conversion can drift between them.
 */

import { useRef } from "react";
import { cn } from "cn";

import { canvasById, elementKind, ELEMENT_LIMIT, type PostArt } from "@/lib/social-art";
import { elementBox } from "@/lib/social-image";

/** How far one arrow-key press moves a mark, as a fraction of the canvas. */
const NUDGE = 0.01;

export function ElementLayer({
  art,
  scale,
  selected,
  onSelect,
  onChange,
}: {
  art: PostArt;
  scale: number;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onChange: (patch: Partial<PostArt>) => void;
}) {
  const canvas = canvasById(art.canvas);
  const surface = useRef<HTMLDivElement>(null);

  /**
   * The gesture in progress, in canvas pixels. Held in a ref because a pointer
   * move must not re-render on its own: the position that matters is the last
   * committed one, and reading it from a ref is what makes a slow drag land
   * where the pointer actually is rather than where the last event put it.
   */
  const drag = useRef<{
    id: string;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const clamp = (value: number) =>
    Math.min(1 + ELEMENT_LIMIT, Math.max(-ELEMENT_LIMIT, value));

  const move = (id: string, x: number, y: number) =>
    onChange({
      elements: art.elements.map((e) =>
        e.id === id ? { ...e, x: clamp(x), y: clamp(y) } : e,
      ),
    });

  if (art.elements.length === 0) return null;

  return (
    <div className="absolute inset-0 z-10" aria-hidden>
      <div
        ref={surface}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: canvas.width,
          height: canvas.height,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          pointerEvents: "none",
        }}
      >
        {art.elements.map((element) => {
          const kind = elementKind(element.kind);
          const box = elementBox(canvas, element);
          const isCurrent = element.id === selected;

          return (
            <div
              key={element.id}
              role="button"
              tabIndex={isCurrent ? 0 : -1}
              aria-label={`${kind.label}. Arrow keys to move, delete to remove.`}
              onPointerDown={(event) => {
                // Only the primary button starts a drag; a right-click should
                // still reach the browser so a context menu is possible.
                if (event.button !== 0) return;
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                // `preventDefault` above is what stops the browser from starting a
                // text selection mid-drag, but it also stops the click from
                // focusing this element. Without the explicit focus the arrow
                // keys below would only work after the author found the mark
                // with the tab key, which is a strange way to have to place it.
                event.currentTarget.focus();
                drag.current = {
                  id: element.id,
                  startX: event.clientX,
                  startY: event.clientY,
                  originX: element.x,
                  originY: element.y,
                };
                onSelect(element.id);
              }}
              onPointerMove={(event) => {
                const active = drag.current;
                if (!active || active.id !== element.id) return;
                // Divide by the scale to recover canvas pixels, then by the
                // canvas size to get the fraction the model stores.
                const dx =
                  (event.clientX - active.startX) / scale / canvas.width;
                const dy =
                  (event.clientY - active.startY) / scale / canvas.height;
                move(element.id, active.originX + dx, active.originY + dy);
              }}
              onPointerUp={(event) => {
                event.currentTarget.releasePointerCapture(event.pointerId);
                drag.current = null;
              }}
              onPointerCancel={() => {
                drag.current = null;
              }}
              onKeyDown={(event) => {
                const step: Record<string, [number, number]> = {
                  ArrowLeft: [-NUDGE, 0],
                  ArrowRight: [NUDGE, 0],
                  ArrowUp: [0, -NUDGE],
                  ArrowDown: [0, NUDGE],
                };
                const delta = step[event.key];
                if (!delta) {
                  if (event.key === "Escape") onSelect(null);
                  // The delete keys, because the mark is under the pointer and
                  // the author has already reached for the keyboard to place it.
                  // Shift is left out on purpose: a bare backspace is a decision,
                  // a held one is a slip.
                  if (event.key === "Delete" || event.key === "Backspace") {
                    event.preventDefault();
                    onChange({
                      elements: art.elements.filter((e) => e.id !== element.id),
                    });
                    onSelect(null);
                  }
                  return;
                }
                event.preventDefault();
                move(element.id, element.x + delta[0], element.y + delta[1]);
              }}
              className={cn(
                "absolute cursor-grab touch-none outline-none active:cursor-grabbing",
                isCurrent && "ring-2 ring-offset-1 ring-sky-400",
              )}
              style={{
                left: box.left,
                top: box.top,
                width: box.width,
                height: box.height,
                pointerEvents: "auto",
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
