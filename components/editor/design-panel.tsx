"use client";

/**
 * The controls for the picture: which frame it is, which face it is set in, how
 * it is laid out, and how dark the veil is.
 *
 * Grouped as a small form rather than a row of segmented controls because the
 * counts do not fit a row — eight faces and four layouts is a lot to put next to
 * a canvas, and a select keeps the panel narrow enough to leave the preview
 * somewhere to live.
 */

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import {
  CANVASES,
  FONTS,
  LAYOUTS,
  STYLES,
  canvasById,
  fontById,
  layoutById,
  styleLook,
  type PostArt,
} from "@/lib/social-art";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
      {hint && <p className="text-[10px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * A collapsible group of controls.
 *
 * The Design panel holds six groups now, and all of them open is a wall of
 * controls the author has to scroll past every time. A disclosure keeps the
 * panel a menu instead of a form: the section they are working in is open, the
 * rest are one click away, and the state is theirs to choose — nothing here
 * decides for them what matters.
 */
function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="space-y-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronDown
          aria-hidden
          className={cn(
            "size-3 shrink-0 text-muted-foreground transition-transform",
            !open && "-rotate-90",
          )}
        />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
      </button>
      {open && (
        <>
          {children}
          {hint && <p className="text-[10px] leading-snug text-muted-foreground">{hint}</p>}
        </>
      )}
    </div>
  );
}

const FONT_GROUPS = ["Serif", "Sans", "Humanist", "Display"] as const;

export function DesignPanel({
  art,
  onChange,
}: {
  art: PostArt;
  onChange: (patch: Partial<PostArt>) => void;
}) {
  const canvas = canvasById(art.canvas);
  const font = fontById(art.font);
  const layout = layoutById(art.layout);

  return (
    <div className="space-y-3">
      {/* The look is the first move: composition, face and palette in one pick.
          It sits above Frame for the same reason. */}
      <Section
        title="Look"
        hint="The composed style. Colours and face stay editable below."
      >
        <div className="grid grid-cols-3 gap-1">
          {STYLES.map((option) => {
            const active = option.id === art.style;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={active}
                title={option.hint}
                onClick={() =>
                  // The whole look travels together — style, palette, face —
                  // so a pick never leaves a poster shape wearing clean's
                  // white. Everything remains editable afterwards.
                  onChange(styleLook(option.id))
                }
                className={cn(
                  "flex h-auto flex-col items-start gap-0.5 rounded-md border px-2 py-1.5 text-left transition-colors",
                  active ? "border-ring bg-secondary" : "hover:bg-muted/60",
                )}
              >
                <span className="flex w-full items-center justify-between gap-1">
                  <span className="text-[11px] font-medium leading-tight">
                    {option.label}
                  </span>
                  {/* Three swatches from the look's own palette, so the picker
                      previews the answer rather than describing it. */}
                  <span className="flex shrink-0 gap-0.5">
                    {[option.look.base, option.look.accent, option.look.ink].map(
                      (c) => (
                        <span
                          key={c}
                          aria-hidden
                          className="size-2 rounded-full ring-1 ring-black/10"
                          style={{ background: c }}
                        />
                      ),
                    )}
                  </span>
                </span>
                <span
                  className="w-full truncate text-left text-[9px] leading-tight text-muted-foreground"
                  style={{ fontFamily: fontById(option.look.font).stack }}
                >
                  {fontById(option.look.font).label}
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Kicker">
        <input
          value={art.kicker}
          onChange={(e) => onChange({ kicker: e.target.value })}
          placeholder="From the book"
          aria-label="Small label over the text, left empty to use the template's"
          className="h-7 w-full rounded-md border bg-transparent px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p className="text-[10px] leading-snug text-muted-foreground">
          Small label over the text. Empty uses the template&rsquo;s own.
        </p>
      </Section>

      <Section title="Frame" hint={canvas.note}>
        <div className="grid grid-cols-3 gap-1">
          {CANVASES.map((option) => (
            <Button
              key={option.id}
              type="button"
              variant={option.id === canvas.id ? "secondary" : "ghost"}
              className={cn(
                "h-auto flex-col items-start gap-0 px-2 py-1.5 text-left",
                option.id === canvas.id && "ring-1 ring-ring",
              )}
              aria-pressed={option.id === canvas.id}
              onClick={() => onChange({ canvas: option.id })}
            >
              <span className="text-[11px] font-medium leading-tight">
                {option.label}
              </span>
              <span className="font-mono text-[9px] text-muted-foreground">
                {option.width}×{option.height}
              </span>
            </Button>
          ))}
        </div>
      </Section>

      <Section title="Typeface">
        <div className="space-y-2">
          {FONT_GROUPS.map((group) => {
            const faces = FONTS.filter((f) => f.group === group);
            if (faces.length === 0) return null;
            return (
              <div key={group} className="space-y-1">
                <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  {group}
                </p>
                <div className="grid grid-cols-2 gap-1">
                  {faces.map((face) => (
                    <button
                      key={face.id}
                      type="button"
                      aria-pressed={face.id === font.id}
                      onClick={() => onChange({ font: face.id })}
                      className={cn(
                        "flex items-center justify-between rounded-md border px-2 py-1.5 text-left text-xs transition-colors",
                        face.id === font.id
                          ? "border-ring bg-secondary"
                          : "hover:bg-muted/60",
                      )}
                    >
                      <span
                        style={{ fontFamily: face.stack }}
                        className={cn(
                          "truncate",
                          face.id === "impact" && "uppercase",
                        )}
                      >
                        {face.label}
                      </span>
                      {face.id === font.id && <Check className="size-3 shrink-0" />}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Layout">
        <div className="space-y-1">
          {LAYOUTS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={option.id === layout.id}
              onClick={() => onChange({ layout: option.id })}
              className={cn(
                "flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left transition-colors",
                option.id === layout.id
                  ? "border-ring bg-secondary"
                  : "hover:bg-muted/60",
              )}
            >
              <span
                aria-hidden
                className="mt-0.5 flex size-7 shrink-0 flex-col overflow-hidden rounded border"
              >
                {option.id === "veil" || option.id === "panel" ? (
                  <>
                    <span className="block h-2.5 w-full bg-muted-foreground/40" />
                    <span
                      className={cn(
                        "block flex-1 w-full",
                        option.id === "panel" ? "bg-muted-foreground/70" : "bg-muted-foreground/25",
                      )}
                    />
                  </>
                ) : (
                  <span
                    className={cn(
                      "block size-full",
                      option.id === "solid"
                        ? "bg-muted-foreground/70"
                        : "bg-gradient-to-br from-muted-foreground/25 to-muted-foreground/70",
                    )}
                  />
                )}
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-medium leading-tight">
                  {option.label}
                </span>
                <span className="block text-[10px] leading-snug text-muted-foreground">
                  {option.hint}
                </span>
              </span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Handle">
        <input
          value={art.handle}
          onChange={(e) => onChange({ handle: e.target.value })}
          placeholder="@tryhardbooks"
          aria-label="The handle stamped at the bottom of the image"
          className="h-7 w-full rounded-md border bg-transparent px-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <input
          type="range"
          min={0.5}
          max={3}
          step={0.1}
          value={art.handleSize}
          onChange={(e) => onChange({ handleSize: Number(e.target.value) })}
          aria-label="Handle size"
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-foreground"
        />
        <div className="flex justify-between text-[9px] text-muted-foreground">
          <span>Small</span>
          <span className="tabular-nums">
            {Math.round(art.handleSize * 100)}%
          </span>
          <span>Large</span>
        </div>
        <p className="text-[10px] leading-snug text-muted-foreground">
          Stamped at the bottom centre of every image. It is editable — leave it
          blank for no signature.
        </p>
      </Section>
    </div>
  );
}

/** Colours and the veil slider, split out because DesignPanel is already tall. */
export function StylePanel({
  art,
  onChange,
}: {
  art: PostArt;
  onChange: (patch: Partial<PostArt>) => void;
}) {
  const usesPhoto = layoutById(art.layout).usesPhoto;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <ColorField
          label="Text"
          value={art.ink}
          onChange={(ink) => onChange({ ink })}
        />
        <ColorField
          label="Panel"
          value={art.accent}
          onChange={(accent) => onChange({ accent })}
        />
        <ColorField
          label="Backdrop"
          value={art.base}
          onChange={(base) => onChange({ base })}
        />
      </div>

      {usesPhoto && art.background && (
        <Field label="Veil" hint="How hard the photo is pressed down behind the words.">
          <input
            type="range"
            min={0}
            max={0.85}
            step={0.05}
            value={art.dim}
            onChange={(e) => onChange({ dim: Number(e.target.value) })}
            aria-label="Background dimming"
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-foreground"
          />
          <div className="flex justify-between text-[9px] text-muted-foreground">
            <span>None</span>
            <span>{Math.round(art.dim * 100)}%</span>
            <span>Heavy</span>
          </div>
        </Field>
      )}

      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={art.showHashtags}
          onChange={(e) => onChange({ showHashtags: e.target.checked })}
          className="size-3.5 accent-foreground"
        />
        Show the hashtags on the image
      </label>
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} colour`}
          className="size-7 shrink-0 cursor-pointer rounded border bg-transparent p-0.5"
        />
        <span className="truncate font-mono text-[10px] text-muted-foreground">
          {value}
        </span>
      </div>
    </div>
  );
}
