import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { printToPdf } from "@/lib/browser-print";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function removeWorkdir(workdir: string, attempts = 10): void {
  for (let i = 0; i < attempts; i++) {
    try {
      rmSync(workdir, { recursive: true, force: true });
      return;
    } catch {
      sleepSync(300);
    }
  }
}

export async function POST(request: Request): Promise<Response> {
  let html = "";
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object") {
      const candidate = (body as { html?: unknown }).html;
      if (typeof candidate === "string") html = candidate;
    }
  } catch {
    return new Response("Invalid JSON body.", { status: 400 });
  }

  if (!html.trim()) return new Response("No HTML content provided.", { status: 400 });
  if (html.length > 20_000_000) {
    return new Response("HTML too large to export.", { status: 413 });
  }

  const workdir = mkdtempSync(join(tmpdir(), "pdf-export-"));
  const htmlPath = join(workdir, "book.html");
  const pdfPath = join(workdir, "book.pdf");
  const profileDir = join(workdir, "profile");

  try {
    writeFileSync(htmlPath, html, "utf8");
    printToPdf(htmlPath, pdfPath, profileDir);
  } catch (error) {
    console.error("PDF export failed:", error);
    removeWorkdir(workdir);
    const message =
      error instanceof Error ? error.message : "PDF generation failed.";
    return new Response(message, { status: 500 });
  }

  const data = readFileSync(pdfPath);
  removeWorkdir(workdir);

  return new Response(data, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="document.pdf"',
      "Cache-Control": "no-store",
    },
  });
}
