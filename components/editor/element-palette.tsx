"use client";

/**
 * Adding, selecting and removing the marks that sit over the picture.
 *
 * Every mark is a plain box with a position, a size and a colour, so this panel
 * never has to know what a mark looks like — that is `elementBox` and
 * `ELEMENT_KINDS` in the lib. The swatches here are the one place a mark is
 * drawn at all, and they are drawn small and approximate on purpose: the
 * preview beside this panel is the honest version.
 */

import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Plus, Trash2 } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import {
  ELEMENT_KINDS,
  ELEMENT_SCALE_MAX,
  ELEMENT_SCALE_MIN,
  elementKind,
  newElement,
  type ArtElement,
  type ElementId,
  type PostArt,
} from "@/lib/social-art";

/**
 * The four nudge buttons, in the order they read on screen: up, left, down,
 * right. A mark dropped by hand is almost never quite where it was meant to
 * go, and chasing the last few pixels by dragging is slower than tapping.
 */
const NUDGES = [
  { name: "up", dx: 0, dy: -1, icon: ArrowUp },
  { name: "left", dx: -1, dy: 0, icon: ArrowLeft },
  { name: "down", dx: 0, dy: 1, icon: ArrowDown },
  { name: "right", dx: 1, dy: 0, icon: ArrowRight },
] as const;

export function ElementPalette({
  art,
  selected,
  onSelect,
  onChange,
}: {
  art: PostArt;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onChange: (patch: Partial<PostArt>) => void;
}) {
  const add = (kind: ElementId) => {
    const element = newElement(kind, art.elements.length);
    onChange({ elements: [...art.elements, element] });
    onSelect(element.id);
  };

  const patch = (id: string, changes: Partial<ArtElement>) =>
    onChange({
      elements: art.elements.map((e) => (e.id === id ? { ...e, ...changes } : e)),
    });

  const remove = (id: string) => {
    onChange({ elements: art.elements.filter((e) => e.id !== id) });
    if (selected === id) onSelect(null);
  };

  const current = art.elements.find((e) => e.id === selected) ?? null;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Elements
        </span>
        <span className="text-[10px] text-muted-foreground">
          {art.elements.length
            ? `${art.elements.length} on the image`
            : "Drag them on the image"}
        </span>
      </div>

      <div className="grid grid-cols-8 gap-1">
        {ELEMENT_KINDS.map((kind) => (
          <button
            key={kind.id}
            type="button"
            onClick={() => add(kind.id)}
            title={`Add a ${kind.label.toLowerCase()}`}
            // No article: "Add asterisk" reads correctly for every entry, and
            // "Add a asterisk" is the sort of thing that makes a screen reader
            // stumble for no reason.
            aria-label={`Add ${kind.label.toLowerCase()}`}
            className="flex h-9 items-center justify-center rounded-md border bg-transparent text-base transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Swatch kind={kind.id} />
          </button>
        ))}
      </div>

      {art.elements.length > 0 && (
        <ul className="space-y-1">
          {art.elements.map((element, index) => {
            const kind = elementKind(element.kind);
            const isCurrent = element.id === selected;
            return (
              <li key={element.id}>
                <div
                  className={cn(
                    "flex items-center gap-1 rounded-md border px-1.5 py-1",
                    isCurrent ? "border-ring bg-secondary" : "border-transparent",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(isCurrent ? null : element.id)}
                    aria-pressed={isCurrent}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs focus-visible:outline-none"
                  >
                    <span className="text-sm leading-none" aria-hidden>
                      <Swatch kind={element.kind} />
                    </span>
                    <span className="truncate">{kind.label}</span>
                    <span className="shrink-0 font-mono text-[9px] text-muted-foreground">
                      {index + 1}
                    </span>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6 shrink-0"
                    onClick={() => remove(element.id)}
                    aria-label={`Remove the ${kind.label.toLowerCase()}`}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {current && (
        <div className="space-y-2 rounded-md border bg-muted/20 p-2">
          <div className="space-y-1">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Size
            </span>
            <input
              type="range"
              min={ELEMENT_SCALE_MIN}
              max={ELEMENT_SCALE_MAX}
              step={0.05}
              value={current.scale}
              onChange={(e) => patch(current.id, { scale: Number(e.target.value) })}
              aria-label="Element size"
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-foreground"
            />
            <div className="flex justify-between text-[9px] text-muted-foreground">
              <span>Small</span>
              <span className="tabular-nums">
                {Math.round(current.scale * 100)}%
              </span>
              <span>Large</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="color"
              value={current.color}
              onChange={(e) => patch(current.id, { color: e.target.value })}
              aria-label="Element colour"
              className="size-7 shrink-0 cursor-pointer rounded border bg-transparent p-0.5"
            />
            <span className="font-mono text-[10px] text-muted-foreground">
              {current.color}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto h-6 gap-1 px-1.5 text-[10px]"
              onClick={() => patch(current.id, { x: 0.5, y: 0.5 })}
            >
              <Plus className="size-3" />
              Centre
            </Button>
          </div>

          <div className="flex items-center gap-1">
            {NUDGES.map((n) => (
              <Button
                key={n.name}
                type="button"
                variant="outline"
                size="sm"
                aria-label={`Nudge the ${elementKind(current.kind).label.toLowerCase()} ${n.name}`}
                className="size-6 shrink-0 p-0"
                onClick={() => {
                  const step = 0.01;
                  patch(current.id, {
                    x: current.x + n.dx * step,
                    y: current.y + n.dy * step,
                  });
                }}
              >
                <n.icon className="size-3" />
              </Button>
            ))}
          </div>

          <p className="text-[10px] leading-snug text-muted-foreground">
            Drag it on the image to place it, or nudge it from here.
          </p>
        </div>
      )}
    </div>
  );
}
/**
 * A rough stand-in for the mark. Glyphs reuse the real character; the rest are
 * the same idea as `elementStyle`, reduced to a border or a block so the button
 * reads at 32 pixels.
 */
function Swatch({ kind }: { kind: ElementId }) {
  const info = elementKind(kind);
  if (info.shape === "glyph") {
    return <span aria-hidden>{info.glyph}</span>;
  }
  if (info.shape === "ring") {
    return (
      <span
        aria-hidden
        className="block size-4 rounded-full border-2 border-current"
      />
    );
  }
  if (info.shape === "line") {
    return <span aria-hidden className="block h-0.5 w-5 rounded-full bg-current" />;
  }
  if (info.shape === "bar") {
    return <span aria-hidden className="block h-2 w-5 rounded-sm bg-current" />;
  }
  if (info.shape === "bracket") {
    return (
      <span
        aria-hidden
        className="block size-4 border-l-2 border-b-2 border-current"
      />
    );
  }
  return (
    <span aria-hidden className="block size-4 rounded-sm border-2 border-current" />
  );
}
