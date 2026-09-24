"use client";

import { useState } from "react";
import { Copy, FolderOpen, Plus, Trash2, Pencil, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import type { Project } from "@/lib/projects";

export function ProjectManager({
  projects,
  activeId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onDuplicate,
}: {
  projects: Project[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
}) {
  const [newName, setNewName] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  const submitNew = () => {
    const name = newName.trim();
    if (!name) return;
    onCreate(name);
    setNewName("");
    setShowNew(false);
  };

  const startRename = (p: Project) => {
    setEditingId(p.id);
    setDraftName(p.name);
  };

  const submitRename = (id: string) => {
    onRename(id, draftName);
    setEditingId(null);
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <FolderOpen className="size-3.5" />
          Projects
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2 text-xs"
          onClick={() => setShowNew((s) => !s)}
        >
          <Plus />
          New
        </Button>
      </div>

      {showNew && (
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitNew();
              if (e.key === "Escape") setShowNew(false);
            }}
            placeholder="Project name"
            className="h-7 w-full rounded border bg-background px-2 text-xs outline-none focus:border-ring"
            aria-label="New project name"
          />
          <Button
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={submitNew}
            disabled={!newName.trim()}
          >
            Create
          </Button>
        </div>
      )}

      <ul className="max-h-72 overflow-y-auto p-1.5">
        {projects.length === 0 && (
          <li className="px-2 py-3 text-xs text-muted-foreground">
            No projects yet — create one or load a preset.
          </li>
        )}
        {projects.map((p) => (
          <li
            key={p.id}
            className={cn(
              "group flex items-center gap-1 rounded px-1.5 py-1 text-xs",
              p.id === activeId ? "bg-background shadow-sm" : "",
            )}
          >
            {editingId === p.id ? (
              <>
                <input
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitRename(p.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="h-6 w-full rounded border bg-background px-1.5 text-xs outline-none focus:border-ring"
                  aria-label={`Rename ${p.name}`}
                />
                <button
                  type="button"
                  className="rounded p-0.5 text-muted-foreground hover:text-emerald-600"
                  onClick={() => submitRename(p.id)}
                  aria-label="Save name"
                >
                  <Check className="size-3.5" />
                </button>
                <button
                  type="button"
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                  onClick={() => setEditingId(null)}
                  aria-label="Cancel rename"
                >
                  <X className="size-3.5" />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left font-medium"
                  onClick={() => onSelect(p.id)}
                  title={p.name}
                >
                  {p.name}
                </button>
                <span className="flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <button
                    type="button"
                    className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                    onClick={() => startRename(p)}
                    aria-label={`Rename ${p.name}`}
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                    onClick={() => onDuplicate(p.id)}
                    aria-label={`Duplicate ${p.name}`}
                  >
                    <Copy className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="rounded p-0.5 text-muted-foreground hover:text-red-600"
                    onClick={() => onDelete(p.id)}
                    aria-label={`Delete ${p.name}`}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}