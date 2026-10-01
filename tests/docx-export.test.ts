import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDocxDocument, suggestedFilename } from "../lib/docx-export.ts";
import { docxBlobFromHtml } from "../lib/docx-node.ts";

const EMPTY_RESOLVER = async () => null;

/** Minimal HTML used across tests — no images, no special blocks. */
const BASE_HTML = `<h1 id="test-title">Test Document</h1>
<p>This is a paragraph of body text.</p>
<h2>Section One</h2>
<p>More text under the first section.</p>`;

describe("buildDocxDocument — theme colors", () => {
  it("applies the medical theme ink to body text (not the default)", async () => {
    const doc = await buildDocxDocument(BASE_HTML, "medical", {
      resolveImage: EMPTY_RESOLVER,
    });
    // The Normal style run color is set from config.ink in headStyles().
    const runProps = doc.styles?.default?.document?.run;
    assert.equal(runProps?.color, "1A2226", "medical ink should be #1A2226");
  });

  it("applies the slate theme ink (was incorrectly B45309 before the fix)", async () => {
    const doc = await buildDocxDocument(BASE_HTML, "slate", {
      resolveImage: EMPTY_RESOLVER,
    });
    const runProps = doc.styles?.default?.document?.run;
    assert.equal(runProps?.color, "0F172A", "slate ink should be #0F172A");
    // Before the fix the slate accent in TEMPLATE_CONFIGS was B45309;
    // now the accent is D97706 matching the CSS.
    // We can verify the accent indirectly through the Heading1 style color
    // which for slate uses ink (0F172A) — both are consistent now.
    assert.notEqual(runProps?.color, "18181B", "must not fall back to default ink");
  });

  it("applies the technical theme colors", async () => {
    const doc = await buildDocxDocument(BASE_HTML, "technical", {
      resolveImage: EMPTY_RESOLVER,
    });
    const runProps = doc.styles?.default?.document?.run;
    assert.equal(runProps?.color, "1F2430", "technical ink should be #1F2430");
    assert.equal(runProps?.font, "Calibri");
  });

  it("falls back to DEFAULT_CONFIG for an unknown template id", async () => {
    const doc = await buildDocxDocument(BASE_HTML, "nonexistent", {
      resolveImage: EMPTY_RESOLVER,
    });
    const runProps = doc.styles?.default?.document?.run;
    assert.equal(runProps?.color, "18181B", "unknown template → default ink");
    assert.equal(runProps?.font, "Calibri");
  });

  it("applies the default theme when no templateId is given", async () => {
    const doc = await buildDocxDocument(BASE_HTML, undefined, {
      resolveImage: EMPTY_RESOLVER,
    });
    const runProps = doc.styles?.default?.document?.run;
    assert.equal(runProps?.color, "18181B");
    assert.equal(runProps?.font, "Calibri");
  });
});

describe("buildDocxDocument — document structure", () => {
  it("creates a document with one section", async () => {
    const doc = await buildDocxDocument(BASE_HTML, "trauma", {
      resolveImage: EMPTY_RESOLVER,
    });
    assert.equal(doc.sections.length, 1);
    assert.ok(doc.sections[0].children.length > 0);
  });

  it("sets the document title from the first h1", async () => {
    const doc = await buildDocxDocument(BASE_HTML, "trauma", {
      resolveImage: EMPTY_RESOLVER,
    });
    assert.equal(doc.title, "Test Document");
  });

  it("sets a fallback title when there is no h1", async () => {
    const doc = await buildDocxDocument("<p>No title here.</p>", "trauma", {
      resolveImage: EMPTY_RESOLVER,
    });
    assert.equal(doc.title, "document");
  });

  it("has a footer on the default section", async () => {
    const doc = await buildDocxDocument(BASE_HTML, "trauma", {
      resolveImage: EMPTY_RESOLVER,
    });
    assert.ok(doc.sections[0].footers?.default);
  });

  it("has numbering config for ordered lists", async () => {
    const html = `<ol><li>First</li><li>Second</li></ol>`;
    const doc = await buildDocxDocument(html, "trauma", {
      resolveImage: EMPTY_RESOLVER,
    });
    assert.ok(doc.numbering);
    assert.ok(doc.numbering.config.length > 0);
  });

  it("produces multiple paragraphs for multiple body elements", async () => {
    const html = `<h1>Title</h1><p>Para 1</p><p>Para 2</p>`;
    const doc = await buildDocxDocument(html, "trauma", {
      resolveImage: EMPTY_RESOLVER,
    });
    const children = doc.sections[0].children;
    assert.ok(
      children.length >= 3,
      `expected at least 3 block elements, got ${children.length}`,
    );
  });
});

describe("docxBlobFromHtml — Node packing", () => {
  it("produces a non-empty buffer for simple content (no images)", async () => {
    const html = "<h1>Test</h1><p>Body text.</p>";
    const buffer = await docxBlobFromHtml(html, "technical");
    assert.ok(buffer instanceof Buffer);
    assert.ok(buffer.length > 0, "buffer should not be empty");
    // A minimal docx is at least a few KB
    assert.ok(buffer.length > 2000, "buffer should be a real docx file");
  });

  it("uses the medical theme when specified", async () => {
    const html = "<h1>Medical Doc</h1><p>Content.</p>";
    const buffer = await docxBlobFromHtml(html, "medical");
    assert.ok(buffer.length > 0);
  });

  it("uses the slate theme when specified", async () => {
    const html = "<h1>Slate Doc</h1><p>Content.</p>";
    const buffer = await docxBlobFromHtml(html, "slate");
    assert.ok(buffer.length > 0);
  });

  it("throws on truly invalid input", async () => {
    // buildDocxDocument should handle empty-ish HTML gracefully,
    // but a non-string should cause issues if passed incorrectly.
    await assert.rejects(
      async () =>
        docxBlobFromHtml(null as unknown as string, "technical"),
      /TypeError|Cannot read properties/,
    );
  });
});

describe("suggestedFilename", () => {
  it("derives a slug from the first h1 heading", () => {
    assert.equal(
      suggestedFilename("# My Awesome Book\n\nBody text."),
      "my-awesome-book",
    );
  });

  it("returns 'document' when there is no heading", () => {
    assert.equal(suggestedFilename("Just a paragraph."), "document");
  });

  it("strips markdown formatting characters", () => {
    assert.equal(suggestedFilename("# **Bold** Title"), "bold-title");
  });

  it("lowercases and dashes non-alphanumerics", () => {
    assert.equal(suggestedFilename("# Código Limpio"), "codigo-limpio");
  });
});
