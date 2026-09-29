"use client";

/**
 * One network's view of the post: what it will look like, whether it fits, and
 * the button that puts it on the clipboard.
 *
 * The counter is the reason this card exists rather than a textarea per network.
 * Three states are shown, and they are not the same severity:
 *
 *   - inside the soft target: fine, no colour, no noise.
 *   - past the soft target: amber. The post will publish and the platform will
 *     fold it behind a "see more". This is a judgement call, not a fault, and
 *     Facebook has 63,206 characters for exactly this.
 *   - past the hard cap: red. The platform truncates or refuses, and the author
 *     is about to paste something that will arrive incomplete.
 *
 * Every number is measured against the flattened text, so what is counted is
 * what is copied. See lib/social-networks.ts.
 */

import { useState } from "react";
import { Check, Copy, Pencil, TriangleAlert } from "lucide-react";
import { cn } from "cn";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  composePost,
  type PostMeasure,
  type SocialNetwork,
} from "@/lib/social-networks";
import type { SocialDraft, SocialOverride } from "@/lib/social-draft";

/** Severity, from the measure. Kept here so both the bar and the copy button read it. */
function severity(measure: PostMeasure): "ok" | "warn" | "over" {
  if (measure.overHard) return "over";
  if (measure.overSoft) return "warn";
  return "ok";
}

const BAR: Record<ReturnType<typeof severity>, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  over: "bg-red-500",
};

export function NetworkCard({
  draft,
  network,
  onChange,
}: {
  draft: SocialDraft;
  network: SocialNetwork;
  onChange: (patch: Partial<SocialDraft>) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);

  const measure = composePost(draft, network);
  const level = severity(measure);
  const override = draft.overrides?.[network.id];

  const copy = () => {
    // Refuse rather than copy a post the platform will cut. Pasting a
    // truncated post and discovering it after publishing is the failure this
    // whole card is built to prevent, so it is not worth the convenience.
    if (measure.overHard) {
      toast.error(
        `Too long for ${network.label} by ${-measure.remaining} characters. Shorten it first.`,
      );
      return;
    }
    void navigator.clipboard
      .writeText(measure.text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
        toast.success(
          measure.overSoft
            ? `Copied — ${measure.remaining} left, past the fold at ${network.preview}.`
            : `Copied for ${network.label}.`,
          measure.overSoft
            ? { description: "Readers will have to tap “see more” to finish it." }
            : undefined,
        );
      })
      .catch(() => toast.error("Could not copy to the clipboard."));
  };

  const setOverride = (patch: SocialOverride) => {
    const next: SocialOverride = { ...override, ...patch };
    onChange({ overrides: { ...draft.overrides, [network.id]: next } });
  };

  const clearOverride = () => {
    const overrides = { ...draft.overrides };
    delete overrides[network.id];
    onChange({ overrides: Object.keys(overrides).length > 0 ? overrides : undefined });
    setEditing(false);
  };

  return (
    <section className="flex flex-col rounded-lg border bg-background">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <h3 className="text-xs font-semibold">{network.label}</h3>
        {override && (
          <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
            Custom version
          </Badge>
        )}
        <span
          className={cn(
            "ml-auto font-mono text-[11px] tabular-nums",
            level === "over" && "font-semibold text-red-600 dark:text-red-400",
            level === "warn" && "text-amber-600 dark:text-amber-400",
            level === "ok" && "text-muted-foreground",
          )}
          title={`${measure.length} of ${network.hard}. The feed folds at ${network.preview}.`}
        >
          {measure.length.toLocaleString()} / {network.hard.toLocaleString()}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setEditing((v) => !v)}
          aria-expanded={editing}
          title={
            override
              ? "Edit this network's own version"
              : "Give this network its own version of the post"
          }
        >
          <Pencil className={cn("size-3", editing && "text-foreground")} />
          <span className="sr-only">
            {editing ? "Hide" : "Show"} the {network.label} override
          </span>
        </Button>
        <Button
          variant={level === "over" ? "destructive" : "outline"}
          size="sm"
          className="h-6 gap-1 px-2 text-xs"
          onClick={copy}
          disabled={measure.text.trim().length === 0}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </header>

      {/* The bar is on the soft target, not the hard cap. The hard cap is a
          cliff the post falls off, and a bar that fills over eight minutes of
          Facebook reading teaches nothing. */}
      <div
        className="h-1 w-full bg-muted"
        role="progressbar"
        aria-valuenow={Math.min(measure.length, network.soft)}
        aria-valuemin={0}
        aria-valuemax={network.soft}
        aria-label={`${network.label} length against its ${network.soft}-character target`}
      >
        <div
          className={cn("h-full transition-[width]", BAR[level])}
          style={{ width: `${Math.min(100, (measure.length / network.soft) * 100)}%` }}
        />
      </div>

      {level !== "ok" && (
        <p
          className={cn(
            "flex items-start gap-1.5 border-b px-3 py-1.5 text-[11px] leading-snug",
            level === "over"
              ? "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
              : "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200",
          )}
        >
          {level === "over" ? (
            <TriangleAlert className="mt-px size-3 shrink-0" />
          ) : (
            <TriangleAlert className="mt-px size-3 shrink-0 opacity-70" />
          )}
          <span>
            {level === "over" ? (
              <>
                {-measure.remaining} characters over the {network.label} limit. It
                will be cut when you paste it.
              </>
            ) : (
              <>
                Past the fold — the first {network.preview} characters are all
                most readers see, and this needs a {network.hard.toLocaleString()}-character
                post to finish.
              </>
            )}
          </span>
        </p>
      )}

      {measure.hashtagsDropped > 0 && (
        <p className="flex items-start gap-1.5 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] leading-snug text-amber-800 dark:text-amber-200">
          <TriangleAlert className="mt-px size-3 shrink-0" />
          <span>
            {measure.hashtagsDropped} more{" "}
            {measure.hashtagsDropped === 1 ? "hashtag was" : "hashtags were"} left
            out: {network.label} treats more than{" "}
            {network.hashtagCap} as spam.
          </span>
        </p>
      )}

      {editing && (
        <div className="space-y-2 border-b bg-muted/30 px-3 py-2">
          <p className="text-[11px] leading-snug text-muted-foreground">
            {network.label} only has {network.hard.toLocaleString()} characters.
            Give it its own hook and CTA; anything you leave blank falls back to
            the shared post.
          </p>
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Hook
            </span>
            <Textarea
              rows={2}
              value={override?.hook ?? ""}
              placeholder={draft.hook || "The opening line"}
              onChange={(e) => setOverride({ hook: e.target.value })}
              className="mt-0.5 font-mono text-xs"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              CTA
            </span>
            <Textarea
              rows={2}
              value={override?.cta ?? ""}
              placeholder={draft.cta || "No call to action"}
              onChange={(e) => setOverride({ cta: e.target.value })}
              className="mt-0.5 font-mono text-xs"
            />
          </label>
          {override && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-xs"
              onClick={clearOverride}
            >
              Use the shared post again
            </Button>
          )}
        </div>
      )}

      <pre className="max-h-72 min-h-16 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-sans text-xs leading-relaxed">
        {measure.text || (
          <span className="text-muted-foreground/60">
            Nothing to copy yet — write a hook on the left.
          </span>
        )}
      </pre>
    </section>
  );
}
