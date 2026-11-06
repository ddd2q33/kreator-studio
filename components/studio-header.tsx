"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { LibraryBig, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { useLibraryOpen } from "@/components/editor/library-toggle";
import { APP_VERSION } from "@/lib/app-version";

/**
 * Shared top bar for the studio tools. Each tool lives on its own route
 * ( /manuscript-editor , /video-editor ) so the browser only loads the code for
 * the tool in use; the active tab is derived from the URL.
 *
 * The library trigger lives here because this is the only bar both routes have.
 * It is a global asset pool, so it should not look like it belongs to one of
 * the two tools.
 */
export function StudioHeader({ right }: { right?: React.ReactNode }) {
  const [libraryOpen, setLibraryOpen] = useLibraryOpen();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b bg-background px-4">
      <div className="flex min-w-0 items-center gap-2">
        <Image
          src="/logo.webp"
          alt=""
          width={28}
          height={28}
          priority
          unoptimized
          className="size-7 shrink-0 object-contain"
        />
        <h1 className="text-sm font-semibold tracking-tight">Kreator Studio</h1>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground/70">
          v{APP_VERSION}
        </span>
        <button
          type="button"
          onClick={() => setLibraryOpen(true)}
          aria-expanded={libraryOpen}
          title="Images, illustrations, logos, icons, audio and video you keep for both studios"
          className={`ml-1 flex size-7 shrink-0 items-center justify-center rounded-lg border transition-colors ${
            libraryOpen
              ? "border-ring bg-muted text-foreground"
              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          }`}
        >
          <LibraryBig className="size-4" />
          <span className="sr-only">Open asset library</span>
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          className="flex size-7 shrink-0 items-center justify-center rounded-lg border text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          title="Toggle light/dark mode"
          aria-label="Toggle light/dark mode"
        >
          {mounted && resolvedTheme === "dark" ? (
            <Sun className="size-4" />
          ) : (
            <Moon className="size-4" />
          )}
        </button>
        {right}
      </div>
    </header>
  );
}
