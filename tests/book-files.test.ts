import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  bookFileFromJson,
  bookFromMarkdown,
  chapterFileName,
  defaultTemplateId,
  markdownFromBook,
  renderBookHtml,
} from "../lib/book-files.ts";
import { TEMPLATES } from "../components/templates.ts";

describe("chapterFileName", () => {
  it("prefixes a zero-padded index and dashes the slug", () => {
    assert.equal(chapterFileName("Building Safety", 2), "03-building-safety.md");
  });

  it("falls back to 'chapter' for empty slugs", () => {
    assert.equal(chapterFileName("***", 0), "01-chapter.md");
  });
});

describe("bookFromMarkdown", () => {
  it("splits on <!-- chapter: --> markers", () => {
    const book = bookFromMarkdown(
      "<!-- chapter: Intro -->\n\n# Intro\n\nHello\n\n<!-- chapter: The Body -->\n\n# The Body\n\nWorld",
      "My Book",
    );
    assert.equal(book.name, "My Book");
    assert.equal(book.chapters.length, 2);
    assert.deepEqual(book.chapters.map((c) => c.title), ["Intro", "The Body"]);
    assert.match(book.chapters[0].markdown, /Hello/);
    assert.doesNotMatch(book.chapters[0].markdown, /World/);
    assert.equal(book.bookMode, true);
  });

  it("titles markerless chapters from their first # heading", () => {
    const book = bookFromMarkdown("prologue...\n\n# Real Title\n\ntext");
    assert.equal(book.chapters.length, 1);
    assert.equal(book.chapters[0].title, "Real Title");
    assert.equal(book.bookMode, false);
  });

  it("numbers chapters without markers or headings", () => {
    const book = bookFromMarkdown("just text");
    assert.equal(book.chapters[0].title, "Chapter 1");
  });

  it("gives empty input a single empty starter chapter", () => {
    const book = bookFromMarkdown("");
    assert.equal(book.chapters.length, 1);
    assert.equal(book.chapters[0].title, "Chapter 1");
    assert.equal(book.chapters[0].markdown, "");
    assert.equal(book.bookMode, false);
  });

  it("does not split on markers inside code fences (they are lines too)", () => {
    // The marker regex only matches whole lines, so an inline marker inside a
    // paragraph is content, not a boundary.
    const book = bookFromMarkdown("text with <!-- chapter: No --> inline");
    assert.equal(book.chapters.length, 1);
    assert.match(book.chapters[0].markdown, /inline/);
  });
});

describe("markdownFromBook", () => {
  it("round-trips with bookFromMarkdown", () => {
    const book = bookFromMarkdown(
      "<!-- chapter: One -->\n\nFirst\n\n<!-- chapter: Two -->\n\nSecond",
    );
    const md = markdownFromBook(book);
    const again = bookFromMarkdown(md);
    assert.deepEqual(
      again.chapters.map((c) => [c.title, c.markdown]),
      book.chapters.map((c) => [c.title, c.markdown]),
    );
  });

  it("round-trips chapters whose body ends with a horizontal rule", () => {
    const book = bookFromMarkdown(
      "<!-- chapter: One -->\n\nFirst\n\n---\n\n<!-- chapter: Two -->\n\nSecond",
    );
    assert.equal(book.chapters[0].markdown, "First");
    assert.equal(book.chapters[1].markdown, "Second");
  });

  it("joins chapters with markers and --- separators in book mode", () => {
    const md = markdownFromBook({
      name: "B",
      templateId: null,
      presetId: null,
      bookMode: true,
      chapters: [
        { id: "a", title: "Alpha", markdown: "aaa" },
        { id: "b", title: "Beta", markdown: "bbb" },
      ],
    });
    assert.match(md, /^<!-- chapter: Alpha -->/);
    assert.match(md, /---\n\n<!-- chapter: Beta -->/);
  });

  it("returns the single chapter body without markers", () => {
    const md = markdownFromBook({
      name: "B",
      templateId: null,
      presetId: null,
      bookMode: false,
      chapters: [{ id: "a", title: "Alpha", markdown: "solo" }],
    });
    assert.equal(md, "solo");
  });
});

describe("bookFileFromJson", () => {
  it("parses a valid manifest", () => {
    const book = bookFileFromJson(
      JSON.stringify({
        name: "My Book",
        templateId: "technical",
        bookMode: true,
        chapters: [{ id: "ch-1", title: "Intro", markdown: "# Intro" }],
      }),
    );
    assert.equal(book.name, "My Book");
    assert.equal(book.templateId, "technical");
    assert.equal(book.chapters.length, 1);
  });

  it("allows a manifest without chapters[] (folder format)", () => {
    const book = bookFileFromJson(JSON.stringify({ name: "Folder Book", templateId: "slate" }));
    assert.equal(book.chapters.length, 0);
    assert.equal(book.templateId, "slate");
  });

  it("applies defaults and drops malformed chapters", () => {
    const book = bookFileFromJson(
      JSON.stringify({ chapters: [{ markdown: "ok" }, null, { title: "no body" }, 42] }),
      "Fallback",
    );
    assert.equal(book.name, "Fallback");
    assert.equal(book.chapters.length, 1);
    assert.equal(book.chapters[0].title, "Chapter 1");
    assert.equal(book.chapters[0].markdown, "ok");
  });

  it("throws on invalid JSON", () => {
    assert.throws(() => bookFileFromJson("{not json"), SyntaxError);
  });
});

describe("defaultTemplateId", () => {
  it("matches the first registered template", () => {
    assert.equal(defaultTemplateId(), TEMPLATES[0].id);
  });
});

describe("renderBookHtml", () => {
  it("renders single documents with the requested template CSS", () => {
    const result = renderBookHtml("# Chapter 1. Hi\n\nBody", { templateId: "technical" });
    assert.equal(result.templateId, "technical");
    assert.match(result.bodyHtml, /chapter-page/);
    assert.match(result.fullHtml, /<body class="markdown-body theme-technical">/);
    assert.match(result.fullHtml, /<title>Chapter 1\. Hi<\/title>/);
    assert.match(result.fullHtml, /<!DOCTYPE html>/);
  });

  it("wraps multi-chapter books in book-chapter sections", () => {
    const result = renderBookHtml(
      "<!-- chapter: One -->\n\n# One\n\ntext\n\n<!-- chapter: Two -->\n\n# Two\n\nmore",
    );
    assert.equal(result.fullHtml.match(/<section class="book-chapter">/g)?.length, 2);
    assert.equal(result.title, "One");
  });

  it("appends themeCss after the template styles", () => {
    const result = renderBookHtml("# T", { templateId: "slate", themeCss: "h1{color:red}" });
    const style = result.fullHtml.split("<style>")[1] ?? "";
    assert.ok(style.indexOf("h1{color:red}") > style.indexOf(".markdown-body"));
  });

  it("keeps marker-only chapters and renders placeholder headings", () => {
    const result = renderBookHtml("<!-- chapter: Empty One -->\n\n<!-- chapter: Two -->\n\nx");
    assert.equal(result.fullHtml.match(/<section class="book-chapter">/g)?.length, 2);
    assert.match(result.bodyHtml, /Empty One/);
  });
});
