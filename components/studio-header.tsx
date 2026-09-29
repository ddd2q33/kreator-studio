"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clapperboard, FileText, LibraryBig } from "lucide-react";

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
  const pathname = usePathname();
  const [libraryOpen, setLibraryOpen] = useLibraryOpen();

  // One array rather than two hand-copied Link blocks: the last of the two was
  // the first to drift out of sync with the other, and an active tab that
  // highlights the wrong tool is worse than no active state at all.
  const tools = [
    { href: "/manuscript-editor", label: "Manuscript Editor", icon: FileText },
    { href: "/video-editor", label: "Video Editor", icon: Clapperboard },
  ] as const;

  const tabClass = (active: boolean) =>
    `flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition-colors ${
      active
        ? "bg-background text-foreground shadow-sm"
        : "text-muted-foreground hover:text-foreground"
    }`;

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
        <div
          className="ml-1 flex items-center gap-0.5 rounded-lg border bg-muted/40 p-0.5"
          role="group"
          aria-label="Studio mode"
        >
          {tools.map(({ href, label, icon: ToolIcon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link key={href} href={href} aria-pressed={active} className={tabClass(active)}>
                <ToolIcon className="size-3.5" />
                {label}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {right}
        {/* Build info, not brand. It is the least interesting thing in the bar,
            so it goes in the corner at the lowest contrast rather than sitting
            next to the name where it competes with it. */}
        <span
          className="font-mono text-[10px] tabular-nums text-muted-foreground/50"
          title={`Kreator Studio ${APP_VERSION}`}
        >
          v{APP_VERSION}
        </span>
      </div>
    </header>
  );
}
