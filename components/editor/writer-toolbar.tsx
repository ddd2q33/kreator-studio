"use client";

import { useCallback, useState } from "react";
import {
  Bold,
  Code,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Table,
  Eraser,
  Strikethrough,
  ChevronDown,
} from "lucide-react";
import { cn } from "cn";

/** Injects markdown into a textarea around the current selection. */
export function applyMarkdown(
  ref: React.RefObject<HTMLTextAreaElement | null>,
  value: string,
  transform: (selected: string, start: number) => string,
  onChange: (next: string) => void,
  focusAfter = true,
): void {
  const el = ref.current;
  const start = el?.selectionStart ?? value.length;
  const end = el?.selectionEnd ?? start;
  const selected = value.slice(start, end);
  const replaced = transform(selected, start);
  const next = value.slice(0, start) + replaced + value.slice(end);
  onChange(next);
  if (!focusAfter || !el) return;
  requestAnimationFrame(() => {
    el.focus();
    // Placing the cursor smartly is hard in generic cases; keep the cursor at
    // the end of the injected block by default.
    const pos = start + replaced.length;
    el.setSelectionRange(pos, pos);
  });
}

export type ToolbarAction =
  | { kind: "wrap"; icon: LayoutIcon; label: string; title: string; before: string; after: string; placeholder?: string }
  | { kind: "block"; icon: LayoutIcon; label: string; title: string; block: string };

export type LayoutIcon =
  | typeof Bold
  | typeof Italic
  | typeof Code
  | typeof Strikethrough
  | typeof Link2
  | typeof List
  | typeof ListOrdered
  | typeof Quote
  | typeof Heading2
  | typeof Heading3
  | typeof Table
  | typeof Eraser;

const WRAP_ACTIONS: ToolbarAction[] = [
  {
    kind: "wrap",
    icon: Bold,
    label: "B",
    title: "Bold",
    before: "**",
    after: "**",
    placeholder: "bold text",
  },
  {
    kind: "wrap",
    icon: Italic,
    label: "I",
    title: "Italic",
    before: "*",
    after: "*",
    placeholder: "italic text",
  },
  {
    kind: "wrap",
    icon: Strikethrough,
    label: "S",
    title: "Strikethrough",
    before: "~~",
    after: "~~",
    placeholder: "struck text",
  },
  {
    kind: "wrap",
    icon: Code,
    label: "</>",
    title: "Inline code",
    before: "`",
    after: "`",
    placeholder: "code",
  },
  {
    kind: "wrap",
    icon: Link2,
    label: "Link",
    title: "Link",
    before: "[",
    after: "](https://)",
    placeholder: "link text",
  },
];

const BLOCK_ACTIONS: ToolbarAction[] = [
  {
    kind: "block",
    icon: Heading2,
    label: "H2",
    title: "Heading 2",
    block: "## Heading",
  },
  {
    kind: "block",
    icon: Heading3,
    label: "H3",
    title: "Heading 3",
    block: "### Heading",
  },
  {
    kind: "block",
    icon: List,
    label: "•",
    title: "Bullet list",
    block: "- Item one\n- Item two\n- Item three",
  },
  {
    kind: "block",
    icon: ListOrdered,
    label: "1.",
    title: "Numbered list",
    block: "1. First\n2. Second\n3. Third",
  },
  {
    kind: "block",
    icon: Quote,
    label: "❝",
    title: "Blockquote",
    block: "> Quoted text",
  },
  {
    kind: "block",
    icon: Table,
    label: "Table",
    title: "Table",
    block:
      "| Column A | Column B |\n| -------- | -------- |\n| Cell 1    | Cell 2    |\n| Cell 3    | Cell 4    |",
  },
];

export function MarkdownToolbar({
  textareaRef,
  value,
  onChange,
  disabled,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const [moreOpen, setMoreOpen] = useState(false);

  const inject = useCallback(
    (action: ToolbarAction) => {
      const prefix = action.kind === "wrap" ? action.before : action.block;
      const placeholder =
        action.kind === "wrap"
          ? action.placeholder ?? prefix
          : action.block;
      applyMarkdown(textareaRef, value, (selected) => {
        if (action.kind === "wrap") {
          return selected.length > 0
            ? `${action.before}${selected}${action.after}`
            : `${action.before}${placeholder}${action.after}`;
        }
        return `${action.block}\n\n`;
      }, onChange);
      setMoreOpen(false);
    },
    [textareaRef, value, onChange],
  );

  const clearFormatting = useCallback(() => {
    applyMarkdown(
      textareaRef,
      value,
      (selected) => selected.replace(/\*\*|__|\*|`|~~/g, ""),
      onChange,
    );
  }, [textareaRef, value, onChange]);

  const allActions = [...WRAP_ACTIONS, ...BLOCK_ACTIONS];

  if (disabled) return null;

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/40 px-2 py-1">
      {WRAP_ACTIONS.slice(0, 4).map((a) => (
        <ToolIcon key={a.title} action={a} onClick={() => inject(a)} />
      ))}
      <ToolIcon
        action={WRAP_ACTIONS[4]}
        onClick={() => inject(WRAP_ACTIONS[4])}
      />
      <span className="mx-1 h-4 w-px bg-border" />
      {BLOCK_ACTIONS.slice(0, 3).map((a) => (
        <ToolIcon key={a.title} action={a} onClick={() => inject(a)} />
      ))}
      <div className="relative">
        <button
          type="button"
          onClick={() => setMoreOpen((o) => !o)}
          aria-expanded={moreOpen}
          className={cn(
            "flex h-7 items-center gap-0.5 rounded px-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            moreOpen && "bg-muted text-foreground",
          )}
          title="More blocks"
        >
          More
          <ChevronDown className="size-3" />
        </button>
        {moreOpen && (
          <div className="absolute left-0 z-30 mt-1 flex w-56 flex-col gap-0.5 rounded-md border bg-background p-1 shadow-lg">
            {allActions.map((a) => (
              <button
                key={a.title}
                type="button"
                className="flex items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors hover:bg-muted"
                onClick={() => inject(a)}
              >
                <a.icon className="size-3.5 shrink-0 text-muted-foreground" />
                {a.label}
              </button>
            ))}
            <button
              type="button"
              className="flex items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors hover:bg-muted"
              onClick={clearFormatting}
            >
              <Eraser className="size-3.5 shrink-0 text-muted-foreground" />
              Clear inline marks
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ToolIcon({
  action,
  onClick,
}: {
  action: ToolbarAction;
  onClick: () => void;
}) {
  const Icon = action.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      title={action.title}
      className="flex h-7 items-center gap-1 rounded px-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Icon className="size-3.5" />
    </button>
  );
}