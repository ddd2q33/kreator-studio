"use client";

import { useMemo, useState } from "react";
import {
  History,
  Plus,
  RotateCcw,
  X,
  ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import type { ProjectRevision } from "@/lib/projects";
import { diffLines, diffStats, type DiffLine } from "@/lib/diff";

export function RevisionLabel({
  revision,
}: {
  revision: ProjectRevision;
}): string {
  const d = new Date(revision.createdAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${revision.label || "Version"} — ${pad(d.getDate())}/${pad(
    d.getMonth() + 1,
  )}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function RevisionsPanel({
  revisions,
  currentDoc,
  onSaveRevision,
  onRestore,
  onClose,
}: {
  revisions: ProjectRevision[];
  currentDoc: string;
  onSaveRevision: (label: string) => void;
  onRestore: (revision: ProjectRevision) => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected =
    revisions.find((r) => r.id === selectedId) ?? revisions[0] ?? null;
  const diff = useMemo<DiffLine[]>(() => {
    if (!selected) return [];
    return diffLines(selected.doc.markdown, currentDoc);
  }, [selected, currentDoc]);
  const stats = useMemo(() => diffStats(diff), [diff]);

  const save = () => {
    onSaveRevision(label.trim());
    setLabel("");
  };

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <History className="size-3.5" />
          Revisions
        </span>
        <div className="flex items-center gap-1">
          {selectedId && (
            <button
              type="button"
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              onClick={() => setSelectedId(null)}
              title="Back to list"
            >
              <ArrowLeft className="size-3.5" />
            </button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={onClose}
            aria-label="Close revisions"
          >
            <X className="size-3.5" />
            Close
          </Button>
        </div>
      </div>

      {selected && selectedId ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-xs font-medium">
              {RevisionLabel({ revision: selected })}
            </span>
            <Button
              size="sm"
              className="h-6 gap-1 px-2 text-xs"
              onClick={() => onRestore(selected)}
            >
              <RotateCcw />
              Restore
            </Button>
          </div>
          <div className="flex gap-3 border-b px-3 py-1.5 text-xs text-muted-foreground">
            <span>
              <span className="font-medium text-emerald-600 dark:text-emerald-400">
                +{stats.added}
              </span>{" "}
              added
            </span>
            <span>
              <span className="font-medium text-red-600 dark:text-red-400">
                −{stats.removed}
              </span>{" "}
              removed
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2 font-mono text-[11px] leading-4">
            {diff.length === 0 && (
              <p className="text-muted-foreground">No differences.</p>
            )}
            {diff.map((line, i) => (
              <div
                key={i}
                className={cn(
                  "whitespace-pre-wrap rounded px-1",
                  line.type === "add" &&
                    "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100",
                  line.type === "del" &&
                    "bg-red-100 text-red-800 line-through dark:bg-red-900/30 dark:text-red-200",
                )}
              >
                {line.type === "add"
                  ? "+ "
                  : line.type === "del"
                    ? "- "
                    : "  "}
                {line.text || " "}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
              }}
              placeholder="Version label (optional)"
              className="h-7 w-full rounded border bg-background px-2 text-xs outline-none focus:border-ring"
            />
            <Button
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={save}
              title="Save a snapshot of the current document"
            >
              <Plus />
              Save
            </Button>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {revisions.length === 0 && (
              <li className="px-2 py-3 text-xs text-muted-foreground">
                No revisions saved yet. Snapshots let you diff against older
                versions and restore them.
              </li>
            )}
            {revisions.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="w-full rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted"
                  onClick={() => setSelectedId(r.id)}
                >
                  <span className="font-medium">{r.label || "Version"}</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {RevisionLabel({ revision: r })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}