import { renderBookHtml } from "@/lib/book-files";
import { docxBlobFromHtml } from "@/lib/docx-node";
import { suggestedFilename } from "@/lib/docx-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConvertBody = {
  markdown?: unknown;
  html?: unknown;
  templateId?: unknown;
  themeCss?: unknown;
  images?: unknown;
  /** Optional filename without extension (defaults to the first heading). */
  filename?: unknown;
};

/**
 * POST /api/convert-docx — headless Markdown (or pre-rendered HTML) → .docx,
 * reusing the exact engine behind the browser's "Download .docx" button
 * (lib/docx-export.ts) with a byte-level image resolver (lib/docx-node.ts).
 *
 * Body: { markdown, html?, templateId?, themeCss?, images?, filename? }
 * When `html` is provided it is used as-is (power users can pre-render via
 * /api/preview); otherwise `markdown` is rendered with the shared engine.
 */
export async function POST(request: Request): Promise<Response> {
  let body: ConvertBody;
  try {
    body = (await request.json()) as ConvertBody;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const html =
    typeof body.html === "string" && body.html.trim() ? body.html : null;
  const markdown = typeof body.markdown === "string" ? body.markdown : "";
  if (!html && !markdown.trim()) {
    return Response.json(
      { error: "Provide markdown or html content." },
      { status: 400 },
    );
  }
  if ((html?.length ?? 0) + markdown.length > 10_000_000) {
    return Response.json(
      { error: "Document too large to convert." },
      { status: 413 },
    );
  }

  const templateId =
    typeof body.templateId === "string" ? body.templateId : undefined;

  const images: Record<string, string> = {};
  if (body.images && typeof body.images === "object") {
    for (const [key, value] of Object.entries(body.images)) {
      if (typeof value === "string") images[key] = value;
    }
  }

  let fullHtml = html;
  let title = "document";
  if (!fullHtml) {
    const rendered = renderBookHtml(markdown, {
      templateId,
      themeCss: typeof body.themeCss === "string" ? body.themeCss : undefined,
      images,
    });
    fullHtml = rendered.fullHtml;
    title = rendered.title;
  }

  const name =
    typeof body.filename === "string" && body.filename.trim()
      ? body.filename.trim().replace(/\.docx$/i, "")
      : (title !== "document" ? title : null) ?? "document";

  try {
    const buffer = await docxBlobFromHtml(fullHtml, templateId);
    const safeName = (name || suggestedFilename(markdown) || "document")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "document";
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${safeName}.docx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("convert-docx failed:", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "DOCX conversion failed.",
      },
      { status: 500 },
    );
  }
}
