"use client";

/**
 * The post templates picker.
 *
 * Rendered in the left rail, in the same slot the manuscript editor gives its
 * presets panel. Each entry shows the shape's *rationale* as well as its
 * description, which is the half that earns a template its place: a description
 * says what the post is, the rationale says why that shape holds up on a feed
 * and when the author should reach for something else instead.
 *
 * The book template each post is a satellite of is shown as a badge, because
 * "trauma", "psychology" and "medical" are the books this studio makes, and a
 * post about dissociation that ends up filed under the medical guide is a
 * mistake worth catching before it is published.
 */

import { BookHeart, Library, X } from "lucide-react";
import { cn } from "cn";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  SOCIAL_TEMPLATE_GROUPS,
  socialTemplateById,
} from "@/lib/social-templates";
import { NETWORKS } from "@/lib/social-networks";

/** The book templates a post template can be a satellite of. */
const BOOK_LABELS: Record<string, string> = {
  trauma: "Trauma Book",
  psychology: "Psychology Book",
  medical: "Medical Guide",
  technical: "Programming Book",
  slate: "Programming Book",
  cybersec: "Cybersecurity Book",
};

export function TemplatesPanel({
  currentTemplateId,
  onApply,
  onClose,
}: {
  currentTemplateId: string;
  onApply: (templateId: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Library className="size-3.5" />
          Post templates
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2 text-xs"
          onClick={onClose}
        >
          <X className="size-3.5" />
          Close
        </Button>
      </div>
      <ul className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2">
        {SOCIAL_TEMPLATE_GROUPS.map((group) => (
          <li key={group.label}>
            <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {group.label}
            </p>
            <ul className="space-y-1.5">
              {group.ids.map((id) => {
                const template = socialTemplateById(id);
                const active = template.id === currentTemplateId;
                return (
                  <li key={template.id}>
                    <button
                      type="button"
                      onClick={() => onApply(template.id)}
                      aria-pressed={active}
                      className={cn(
                        "flex w-full flex-col items-start gap-1 rounded border px-2 py-2 text-left transition-colors hover:border-ring",
                        active && "border-ring bg-muted/50",
                      )}
                    >
                      <span className="flex w-full items-center gap-1.5">
                        <span className="min-w-0 flex-1 truncate text-xs font-medium">
                          {template.label}
                        </span>
                        {active && (
                          <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                            Active
                          </Badge>
                        )}
                      </span>
                      <span className="text-[11px] leading-snug text-muted-foreground">
                        {template.description}
                      </span>
                      <span className="text-[11px] leading-snug text-muted-foreground/70">
                        {template.rationale}
                      </span>
                      <span className="flex flex-wrap items-center gap-1 pt-0.5">
                        {template.bookTemplateId && (
                          <Badge
                            variant="outline"
                            className="h-4 gap-1 px-1.5 text-[10px] font-normal"
                          >
                            <BookHeart className="size-2.5" />
                            {BOOK_LABELS[template.bookTemplateId] ??
                              template.bookTemplateId}
                          </Badge>
                        )}
                        <Badge
                          variant="ghost"
                          className="h-4 px-1.5 text-[10px] font-normal text-muted-foreground"
                        >
                          {template.networks
                            .map((n) => NETWORKS.find((w) => w.id === n)?.label ?? n)
                            .join(" · ")}
                        </Badge>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
      <p className="border-t px-3 py-2 text-[11px] leading-snug text-muted-foreground">
        Applying a template starts a <span className="font-medium">new</span> post.
        The one open now stays in the list, untouched — a template is never one
        click from eating a paragraph.
      </p>
    </div>
  );
}
