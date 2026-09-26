import { renderBookHtml } from "@/lib/book-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PreviewBody = {
  markdown?: unknown;
  templateId?: unknown;
  themeCss?: unknown;
  images?: unknown;
};

/**
 * POST /api/preview — headless Markdown → HTML with the exact same engine the
 * UI uses (lib/render-engine.ts): directives, callouts, chapter openers, TOC.
 *
 * Body:  { markdown, templateId?, themeCss?, images? }
 * Query: ?raw=1 returns the body fragment only (no <html> wrapper, no CSS);
 *        default returns the complete standalone document with inlined CSS.
 *        ?chapters=1 wraps each chapter in <section class="book-chapter">.
 *
 * images maps file names to data: URLs, mirroring the UI's image map.
 */
export async function POST(request: Request): Promise<Response> {
  let body: PreviewBody;
  try {
    body = (await request.json()) as PreviewBody;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const markdown = typeof body.markdown === "string" ? body.markdown : "";
  if (!markdown.trim()) {
    return Response.json(
      { error: "No markdown content provided." },
      { status: 400 },
    );
  }
  if (markdown.length > 10_000_000) {
    return Response.json(
      { error: "Markdown too large to render." },
      { status: 413 },
    );
  }

  const images: Record<string, string> = {};
  if (body.images && typeof body.images === "object") {
    for (const [key, value] of Object.entries(body.images)) {
      if (typeof value === "string") images[key] = value;
    }
  }

  const result = renderBookHtml(markdown, {
    templateId: typeof body.templateId === "string" ? body.templateId : undefined,
    themeCss: typeof body.themeCss === "string" ? body.themeCss : undefined,
    images,
    asChapters: new URL(request.url).searchParams.get("chapters") === "1",
  });

  const raw = new URL(request.url).searchParams.get("raw") === "1";
  if (raw) {
    return new Response(result.bodyHtml, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  return Response.json({
    html: result.fullHtml,
    bodyHtml: result.bodyHtml,
    title: result.title,
    templateId: result.templateId,
  });
}
