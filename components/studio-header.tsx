"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clapperboard, FileText } from "lucide-react";

/**
 * Shared top bar for the two studio tools. Each tool lives on its own route
 * ( /manuscript-editor , /video-editor ) so the browser only loads the code
 * for the tool in use; the active tab is derived from the URL.
 */
export function StudioHeader({ right }: { right?: React.ReactNode }) {
  const pathname = usePathname();
  const videoMode = pathname.startsWith("/video-editor");

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
        <h1 className="text-sm font-semibold tracking-tight">Kreator Studio v1</h1>
        <div
          className="ml-1 flex items-center gap-0.5 rounded-lg border bg-muted/40 p-0.5"
          role="group"
          aria-label="Studio mode"
        >
          <Link
            href="/manuscript-editor"
            aria-pressed={!videoMode}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition-colors ${
              !videoMode
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <FileText className="size-3.5" />
            Manuscript Editor
          </Link>
          <Link
            href="/video-editor"
            aria-pressed={videoMode}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition-colors ${
              videoMode
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Clapperboard className="size-3.5" />
            Video Editor
          </Link>
        </div>
      </div>

      {right}
    </header>
  );
}
