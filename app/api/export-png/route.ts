import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { captureToPng, MAX_EDGE, MIN_EDGE } from "@/lib/browser-screenshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Next buffers the body to 10MB by default, and a background photo arrives as a
 * base64 data URL, so the ceiling here has to stay under that or the request is
 * truncated and the author gets a mysteriously blank image.
 */
const MAX_HTML_BYTES = 8 * 1024 * 1024;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function removeWorkdir(workdir: string, attempts = 10): void {
  for (let i = 0; i < attempts; i++) {
    try {
      rmSync(workdir, { recursive: true, force: true });
      return;
    } catch {
      // Windows holds a lock on the profile directory for a moment after the
      // browser exits, and leaving a temp dir behind is worse than one retry.
      sleepSync(300);
    }
  }
}

function failure(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function POST(request: Request): Promise<Response> {
  let html = "";
  let width = 0;
  let height = 0;
  let filename = "post.png";

  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object") return failure("Invalid body.", 400);
    const raw = body as Record<string, unknown>;
    if (typeof raw.html === "string") html = raw.html;
    if (typeof raw.width === "number") width = raw.width;
    if (typeof raw.height === "number") height = raw.height;
    if (typeof raw.filename === "string") filename = raw.filename;
  } catch {
    return failure("Invalid JSON body.", 400);
  }

  if (!html.trim()) return failure("No HTML content provided.", 400);
  if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
    return failure("That background image is too large to render.", 413);
  }
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    return failure("A pixel width and height are required.", 400);
  }
  if (width < MIN_EDGE || height < MIN_EDGE || width > MAX_EDGE || height > MAX_EDGE) {
    return failure(
      `The image must be between ${MIN_EDGE} and ${MAX_EDGE} pixels on each side.`,
      400,
    );
  }

  // A filename that came from a user-supplied string lands in a header, so it
  // gets reduced to the one shape of characters a header can carry.
  const safeName = filename.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 96) || "post.png";

  const workdir = mkdtempSync(join(tmpdir(), "png-export-"));
  const htmlPath = join(workdir, "post.html");
  const pngPath = join(workdir, "post.png");
  const profileDir = join(workdir, "profile");

  try {
    writeFileSync(htmlPath, html, "utf8");
  } catch (error) {
    removeWorkdir(workdir);
    console.error("PNG export could not stage the document:", error);
    return failure("Could not stage the image for rendering.", 500);
  }

  let result: ReturnType<typeof captureToPng>;
  try {
    result = captureToPng(htmlPath, pngPath, { width, height }, profileDir);
  } catch (error) {
    // captureToPng reports its own failures, so reaching here means something
    // outside it went wrong — a crash, not a refusal.
    removeWorkdir(workdir);
    console.error("PNG export failed:", error);
    return failure("Image rendering failed.", 500);
  }

  if (!result.ok) {
    removeWorkdir(workdir);
    return failure(result.error, 500);
  }

  let data: Buffer;
  try {
    data = readFileSync(pngPath);
  } catch (error) {
    removeWorkdir(workdir);
    console.error("PNG export could not read the result:", error);
    return failure("The image was rendered but could not be read back.", 500);
  }
  removeWorkdir(workdir);

  if (data.length === 0) return failure("The rendered image was empty.", 500);

  return new Response(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "Cache-Control": "no-store",
    },
  });
}
