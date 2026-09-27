"use client";

/**
 * The asset library panel: one place to upload, sort, tag and reuse images,
 * illustrations, logos, icons, audio and video across both studios.
 *
 * The bytes live in IndexedDB and only the metadata in `localStorage` (see
 * `asset-library`), so the grid can hold far more pictures than a scene pool
 * ever could. Nothing in here is referenced by a scene, which is what makes it
 * safe to delete from without orphaning a project.
 *
 * The panel is deliberately dumb about what "Use" means: it hands back a `File`
 * and lets the caller decide, because the video studio wants to split a video
 * into scenes while the manuscript wants to embed a picture.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Image as ImageIcon,
  Loader2,
  Music,
  Pencil,
  Search,
  Trash2,
  Upload,
  Video,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ASSET_KIND_LABELS,
  ASSET_KINDS,
  addAsset,
  allTags,
  createAssetBlobs,
  isImageAssetKind,
  isSupportedAsset,
  loadAssets,
  loadAssetFile,
  memoryStorage,
  pruneAssetBlobs,
  removeAsset,
  searchAssets,
  totalBytes,
  updateAsset,
  type Asset,
  type AssetFacts,
  type AssetKind,
} from "@/lib/asset-library";
import type { BlobStore } from "@/lib/blob-store";
import { cn } from "cn";

/** Just the Storage surface the panel needs, so a test can pass a plain object. */
type LikeStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

const KIND_ICONS: Record<AssetKind, typeof ImageIcon> = {
  image: ImageIcon,
  illustration: ImageIcon,
  logo: ImageIcon,
  icon: ImageIcon,
  audio: Music,
  video: Video,
};

const KIND_ACCENTS: Record<AssetKind, string> = {
  image: "text-sky-300",
  illustration: "text-violet-300",
  logo: "text-amber-300",
  icon: "text-emerald-300",
  audio: "text-rose-300",
  video: "text-cyan-300",
};

/** The one text field shape this panel needs, matched to the dark chrome. */
function TextInput({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "h-9 w-full rounded-md border border-white/15 bg-slate-900 px-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none",
        className,
      )}
    />
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exp = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / 1024 ** exp;
  return `${value >= 10 || exp === 0 ? Math.round(value) : value.toFixed(1)} ${units[exp]}`;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const mins = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return mins > 0 ? `${mins}:${String(rest).padStart(2, "0")}` : `${rest}s`;
}

/**
 * Asks the browser what a file measures, for the numbers the catalog cannot know
 * on its own.
 *
 * Every branch is allowed to come back empty. A picture with no readable
 * dimensions is still worth keeping, and a probe that throws must never stop the
 * upload, so the caller treats this as a bonus rather than a gate.
 */
async function probeFacts(file: File, kind: AssetKind): Promise<AssetFacts> {
  const url = URL.createObjectURL(file);
  const done = () => URL.revokeObjectURL(url);
  try {
    if (kind === "image") {
      const dims = await new Promise<{ width: number; height: number } | null>(
        (resolve) => {
          const img = new Image();
          img.onload = () =>
            resolve({ width: img.naturalWidth, height: img.naturalHeight });
          img.onerror = () => resolve(null);
          img.src = url;
        },
      );
      return dims ?? {};
    }
    if (kind === "audio" || kind === "video") {
      const el = document.createElement(kind);
      el.preload = "metadata";
      el.muted = true;
      const meta = await new Promise<{ duration: number; dims: { width: number; height: number } | null } | null>(
        (resolve) => {
          el.onloadedmetadata = () =>
            resolve({
              duration: el.duration,
              dims:
                kind === "video"
                  ? { width: (el as HTMLVideoElement).videoWidth, height: (el as HTMLVideoElement).videoHeight }
                  : null,
            });
          el.onerror = () => resolve(null);
          el.src = url;
        },
      );
      if (!meta || !Number.isFinite(meta.duration)) return {};
      return {
        duration: meta.duration,
        ...(meta.dims?.width ? { width: meta.dims.width } : {}),
        ...(meta.dims?.height ? { height: meta.dims.height } : {}),
      };
    }
    return {};
  } catch {
    return {};
  } finally {
    done();
  }
}

/**
 * A card thumbnail that reads its own blob.
 *
 * Each card owns its object URL and revokes it on unmount. A shared cache keyed
 * by asset would be faster while scrolling but would hold every picture in the
 * library in memory at once, and would need its own eviction; per-card is the
 * trade that cannot leak.
 */
function AssetThumb({
  asset,
  blobs,
}: {
  asset: Asset;
  blobs: BlobStore;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isImageAssetKind(asset.kind)) return;
    let live = true;
    let objectUrl: string | null = null;
    void blobs.get(asset.blobKey).then((blob) => {
      if (!live) return;
      if (!blob) {
        setFailed(true);
        return;
      }
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [asset.blobKey, asset.kind, blobs]);

  const Icon = KIND_ICONS[asset.kind];
  if (!isImageAssetKind(asset.kind) || failed || !url) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Icon className={cn("h-6 w-6", KIND_ACCENTS[asset.kind])} aria-hidden />
      </div>
    );
  }
  return (
    // The bytes come from the author's own library, not a remote host, and may
    // legitimately be an svg that next/image cannot optimize.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      className="h-full w-full object-cover"
    />
  );
}

/** Why an add failed, phrased for the person who pressed the button. */
const ADD_FAILURES: Record<string, string> = {
  "blob-failed": "the browser refused to store it",
  "catalog-failed": "browser storage is full",
};

type EditState = {
  id: string;
  name: string;
  kind: AssetKind;
  tags: string;
};

export type AssetLibraryProps = {
  onClose: () => void;
  /**
   * Offers the "Use" action. Omit it for a browse-only library.
   *
   * The panel has no `open` flag on purpose: mounting it is what opens it. The
   * catalog then loads in the state initializer instead of an effect, so the
   * grid is never blank for a frame and no cascading render is needed.
   */
  onUse?: (file: File, asset: Asset) => void;
  storage?: LikeStorage;
  blobs?: BlobStore;
  /** Hides categories that make no sense for the caller. */
  kinds?: readonly AssetKind[];
};

export function AssetLibrary({
  onClose,
  onUse,
  storage,
  blobs: injectedBlobs,
  kinds,
}: AssetLibraryProps) {
  // Both stores are fixed for the panel's lifetime, so they go in lazy state
  // rather than refs: a ref read during render is a compiler error, and state
  // reads are not. The server branch keeps the first render from touching
  // `window`, which the browser's own storage takes over from.
  const [blobs] = useState<BlobStore>(() => injectedBlobs ?? createAssetBlobs());
  const [meta] = useState<LikeStorage>(
    () =>
      storage ??
      (typeof window === "undefined" ? memoryStorage() : window.localStorage),
  );

  const [assets, setAssets] = useState<Asset[]>(() => loadAssets(meta));
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<AssetKind | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const available = blobs.isAvailable();
  const shownKinds = kinds ? ASSET_KINDS.filter((k) => kinds.includes(k)) : ASSET_KINDS;

  const refresh = useCallback(() => {
    setAssets(loadAssets(meta));
  }, [meta]);

  useEffect(() => {
    // Sweep blobs whose catalog entry is gone, once per opening. A failed
    // catalog write or an interrupted delete leaves them behind, and over time
    // that is real disk the author cannot see.
    const idle =
      typeof requestIdleCallback === "function"
        ? requestIdleCallback
        : (fn: () => void) => setTimeout(fn, 800);
    const handle = idle(() => {
      void pruneAssetBlobs(loadAssets(meta), blobs).then((removed) => {
        if (removed > 0) {
          toast.info(
            `Cleaned up ${removed} unused file${removed === 1 ? "" : "s"}.`,
          );
        }
      });
    });
    return () => {
      if (
        typeof cancelIdleCallback === "function" &&
        typeof handle === "number"
      ) {
        cancelIdleCallback(handle);
      }
    };
  }, [meta, blobs]);

  const ingest = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setBusy(true);
      let added = 0;
      const failures: string[] = [];
      for (const file of files) {
        if (!isSupportedAsset(file.type)) {
          failures.push(file.name);
          continue;
        }
        // The category has to be settled before probing, since how a file is
        // measured depends on it.
        const kind: AssetKind = file.type.startsWith("audio/")
          ? "audio"
          : file.type.startsWith("video/")
            ? "video"
            : "image";
        const facts = await probeFacts(file, kind);
        const result = await addAsset(file, blobs, meta, { kind, facts });
        if (result.ok) added += 1;
        else if (result.reason === "unsupported") failures.push(file.name);
        else failures.push(`${file.name} (${ADD_FAILURES[result.reason]})`);
      }
      refresh();
      setBusy(false);
      if (added > 0) {
        toast.success(`Added ${added} asset${added === 1 ? "" : "s"} to the library.`);
      }
      if (failures.length > 0) {
        toast.error(`Could not add ${failures.length}: ${failures.slice(0, 3).join(", ")}`);
      }
    },
    [blobs, meta, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      const next = removeAsset(loadAssets(meta), id, meta);
      setAssets([...next].sort((a, b) => b.addedAt - a.addedAt));
      setConfirmId(null);
      setEditing((cur) => (cur?.id === id ? null : cur));
      await pruneAssetBlobs(next, blobs);
      toast.success("Asset deleted.");
    },
    [blobs, meta],
  );

  const saveEdit = useCallback(
    (state: EditState) => {
      const ok = updateAsset(
        loadAssets(meta),
        state.id,
        {
          name: state.name,
          kind: state.kind,
          tags: state.tags.split(","),
        },
        meta,
      );
      if (!ok) {
        toast.error("Could not save; the browser storage is full.");
        return;
      }
      refresh();
      setEditing(null);
    },
    [meta, refresh],
  );

  const use = useCallback(
    async (asset: Asset) => {
      if (!onUse) return;
      const file = await loadAssetFile(asset, blobs);
      if (!file) {
        toast.error("That file's data is missing from the browser storage.");
        return;
      }
      onUse(file, asset);
      onClose();
    },
    [blobs, onClose, onUse],
  );

  const tags = useMemo(() => allTags(assets), [assets]);
  const visible = useMemo(
    () => searchAssets(assets, { query, kind, tag }),
    [assets, query, kind, tag],
  );
  const counts = useMemo(() => {
    const map = new Map<AssetKind, number>();
    for (const asset of assets) map.set(asset.kind, (map.get(asset.kind) ?? 0) + 1);
    return map;
  }, [assets]);

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end">
      <button
        type="button"
        aria-label="Close the library"
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Asset library"
        className="relative flex h-full w-full max-w-2xl flex-col border-l border-white/10 bg-slate-950 text-slate-100 shadow-2xl"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void ingest(Array.from(e.dataTransfer.files));
        }}
      >
        <header className="flex items-start gap-3 border-b border-white/10 p-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">Asset library</h2>
            <p className="text-xs text-slate-400">
              {assets.length === 0
                ? "Images, illustrations, logos, icons, audio and video"
                : `${assets.length} asset${assets.length === 1 ? "" : "s"} · ${formatBytes(totalBytes(assets))}`}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>

        {!available ? (
          <p className="m-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
            This browser is blocking IndexedDB, so library files cannot be saved.
            Private windows often do this.
          </p>
        ) : null}

        <div className="space-y-3 border-b border-white/10 p-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <TextInput
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name, tag or category"
                className="pl-8"
                aria-label="Search the library"
              />
            </div>
            <Button
              onClick={() => fileInput.current?.click()}
              disabled={busy || !available}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Add
            </Button>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept="image/*,audio/*,video/*"
              className="hidden"
              onChange={(e) => {
                void ingest(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            <FilterChip active={kind === null && tag === null} onClick={() => { setKind(null); setTag(null); }}>
              All {assets.length > 0 && `(${assets.length})`}
            </FilterChip>
            {shownKinds.map((k) => {
              const n = counts.get(k) ?? 0;
              return (
                <FilterChip key={k} active={kind === k} onClick={() => { setKind(k); setTag(null); }}>
                  {ASSET_KIND_LABELS[k]} {n > 0 && `(${n})`}
                </FilterChip>
              );
            })}
          </div>

          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <FilterChip key={t} active={tag === t} onClick={() => { setTag(tag === t ? null : t); setKind(null); }}>
                  #{t}
                </FilterChip>
              ))}
            </div>
          )}
        </div>

        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto p-4",
            dragging && "bg-sky-500/10 outline-2 outline-dashed outline-sky-400",
          )}
        >
          {dragging && (
            <p className="mb-3 text-center text-xs text-sky-200">
              Drop to add these files to the library.
            </p>
          )}

          {visible.length === 0 ? (
            <p className="py-12 text-center text-sm text-slate-400">
              {assets.length === 0
                ? "Nothing here yet. Drop images, audio or video anywhere in this panel."
                : `No asset matches${query ? ` "${query}"` : ""}${kind ? ` in ${ASSET_KIND_LABELS[kind]}` : ""}${tag ? ` tagged #${tag}` : ""}.`}
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {visible.map((asset) => (
                <li
                  key={asset.id}
                  className="flex flex-col gap-2 rounded-lg border border-white/10 bg-slate-900/60 p-2"
                >
                  {editing?.id === asset.id ? (
                    <EditCard
                      state={editing}
                      onChange={setEditing}
                      onSave={() => saveEdit(editing)}
                      onCancel={() => setEditing(null)}
                    />
                  ) : (
                    <>
                      <div className="relative aspect-4/3 overflow-hidden rounded bg-slate-950">
                        <AssetThumb asset={asset} blobs={blobs} />
                        {asset.duration ? (
                          <Badge
                            variant="secondary"
                            className="absolute bottom-1 right-1 text-[10px]"
                          >
                            {formatDuration(asset.duration)}
                          </Badge>
                        ) : null}
                      </div>

                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium" title={asset.name}>
                          {asset.name}
                        </p>
                        <p className="text-[10px] text-slate-500">
                          {ASSET_KIND_LABELS[asset.kind]}
                          {asset.width ? ` · ${asset.width}×${asset.height}` : ""} ·{" "}
                          {formatBytes(asset.bytes)}
                        </p>
                        {asset.tags.length > 0 && (
                          <p className="mt-0.5 truncate text-[10px] text-sky-300/80">
                            {asset.tags.map((t) => `#${t}`).join(" ")}
                          </p>
                        )}
                      </div>

                      <div className="mt-auto flex items-center gap-1">
                        {onUse && (
                          <Button
                            size="sm"
                            className="h-7 flex-1 text-xs"
                            onClick={() => void use(asset)}
                          >
                            Use
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          aria-label={`Edit ${asset.name}`}
                          onClick={() =>
                            setEditing({
                              id: asset.id,
                              name: asset.name,
                              kind: asset.kind,
                              tags: asset.tags.join(", "),
                            })
                          }
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-rose-300"
                          aria-label={`Delete ${asset.name}`}
                          onClick={() => setConfirmId(asset.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>

                      {confirmId === asset.id && (
                        <div className="rounded border border-rose-500/40 bg-rose-500/10 p-2">
                          <p className="text-[11px] text-rose-100">
                            Delete “{asset.name}”? This cannot be undone.
                          </p>
                          <div className="mt-1.5 flex gap-1">
                            <Button
                              size="sm"
                              variant="destructive"
                              className="h-6 text-[11px]"
                              onClick={() => void remove(asset.id)}
                            >
                              Delete
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 text-[11px]"
                              onClick={() => setConfirmId(null)}
                            >
                              Keep
                            </Button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

/**
 * A filter pill. `aria-pressed` rather than a colour change alone, so the
 * selected category is announced as well as shown.
 */
function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-[11px] transition",
        active
          ? "border-sky-400 bg-sky-500/20 text-sky-100"
          : "border-white/15 text-slate-300 hover:border-white/30",
      )}
    >
      {children}
    </button>
  );
}

function EditCard({
  state,
  onChange,
  onSave,
  onCancel,
}: {
  state: EditState;
  onChange: (next: EditState) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-2">
      <TextInput
        value={state.name}
        onChange={(e) => onChange({ ...state, name: e.target.value })}
        className="h-8 text-xs"
        aria-label="Asset name"
        autoFocus
      />
      <select
        value={state.kind}
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
          onChange({ ...state, kind: e.target.value as AssetKind })
        }
        aria-label="Asset category"
        className="h-8 w-full rounded-md border border-white/15 bg-slate-900 px-2 text-xs"
      >
        {ASSET_KINDS.map((k) => (
          <option key={k} value={k}>
            {ASSET_KIND_LABELS[k]}
          </option>
        ))}
      </select>
      <TextInput
        value={state.tags}
        onChange={(e) => onChange({ ...state, tags: e.target.value })}
        placeholder="tags, comma, separated"
        className="h-8 text-xs"
        aria-label="Tags"
      />
      <div className="flex gap-1">
        <Button size="sm" className="h-6 text-[11px]" onClick={onSave}>
          <Check className="h-3 w-3" />
          Save
        </Button>
        <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={onCancel}>
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
