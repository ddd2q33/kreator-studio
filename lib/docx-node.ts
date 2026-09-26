/**
 * Node-side DOCX packing for the headless API routes and the book-author CLI.
 *
 * lib/docx-export.ts owns the whole HTML → docx conversion but resolves
 * images through canvas (browser-only). On plain Node there is no image
 * stack, so this module injects a byte-level resolver (PNG/JPEG dimension
 * sniffing from lib/image-size.ts) and packs with Packer.toBuffer.
 */

import { Packer } from "docx";
import {
  buildDocxDocument,
  type DocxImageResolver,
  type ResolvedDocxImage,
} from "./docx-export.ts";
import { imageSizeFromDataUrl } from "./image-size.ts";

function mimeOf(dataUrl: string): "image/png" | "image/jpeg" | null {
  const m = /^data:(image\/(?:png|jpeg));base64,/i.exec(dataUrl);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  return mime === "image/png" ? "image/png" : "image/jpeg";
}

/**
 * Node image resolver: accepts data: URLs only (the API and CLI pass
 * documents with embedded images; remote http(s) fetching is deliberately not
 * done here to keep the headless path fully offline/deterministic).
 */
export const nodeResolveImage: DocxImageResolver = async (src) => {
  if (!src.startsWith("data:")) return null;
  const mime = mimeOf(src);
  if (!mime) return null;
  const size = imageSizeFromDataUrl(src);
  const width = size?.width ?? 600;
  const height = size?.height ?? 400;
  const resolved: ResolvedDocxImage = { dataUrl: src, width, height, mime };
  return resolved;
};

export async function docxBlobFromHtml(
  html: string,
  templateId?: string,
): Promise<Buffer> {
  const doc = await buildDocxDocument(html, templateId, {
    resolveImage: nodeResolveImage,
  });
  return Packer.toBuffer(doc);
}
