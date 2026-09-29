import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  cloneDraft,
  draftToJson,
  draftToMarkdown,
  draftTitle,
  emptyDraft,
  jsonToDraft,
  markdownToDraft,
  normalizeDraft,
  type SocialDraft,
} from "../lib/social-draft.ts";
import { defaultArt } from "../lib/social-art.ts";

/** A 1x1 transparent GIF: the smallest thing that is still a real image. */
const TINY_GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

const SAMPLE: SocialDraft = {
  id: "post-1",
  name: "Chapter quote",
  templateId: "chapter-quote",
  hook: "Trauma is not a bad memory.",
  body: "It is a **nervous system** that never got the message.\n\nSave this one.",
  cta: "Chapter 1 in the link in my bio.",
  hashtags: ["trauma", "mentalhealth"],
};

/**
 * Compares two drafts ignoring the id, which a parsed document never keeps.
 * A pasted document is a new post, so its id is minted fresh by design.
 */
function sameDraft(actual: SocialDraft, expected: SocialDraft) {
  assert.deepEqual({ ...actual, id: expected.id }, expected);
}

describe("the markdown projection", () => {
  it("round-trips a full draft without losing a character", () => {
    // The reason this is the most heavily tested function here: every lossy
    // round trip eats a paragraph of the author's words silently, and there is
    // no undo for it.
    sameDraft(markdownToDraft(draftToMarkdown(SAMPLE)), SAMPLE);
  });

  it("mints a new id for a pasted document, rather than overwriting the open post", () => {
    assert.notEqual(markdownToDraft(draftToMarkdown(SAMPLE)).id, SAMPLE.id);
  });

  it("keeps the open post's identity when the markdown is edited in place", () => {
    assert.equal(markdownToDraft(draftToMarkdown(SAMPLE), SAMPLE).id, SAMPLE.id);
  });

  it("does not let a body that looks like a fence bleed into another field", () => {
    // A body containing a *complete* fence pair is genuinely not representable
    // in this format — there is no escape that survives a paste out of another
    // editor, which is why draftToJson is the lossless projection. What matters
    // is that the failure is contained: the body is lost, and nothing else is
    // corrupted by the theft.
    const tricky: SocialDraft = {
      ...SAMPLE,
      body: "<!-- social:hook -->\nnot the hook\n<!-- /social -->",
    };
    const back = markdownToDraft(draftToMarkdown(tricky));
    assert.equal(back.hook, SAMPLE.hook, "the nested fence overwrote the real hook");
    assert.equal(back.cta, SAMPLE.cta);
    assert.deepEqual(back.hashtags, SAMPLE.hashtags);
  });

  it("keeps the lossless view lossless for that same body", () => {
    // The reason the JSON view exists.
    const tricky: SocialDraft = {
      ...SAMPLE,
      body: "<!-- social:hook -->\nnot the hook\n<!-- /social -->",
    };
    const result = jsonToDraft(draftToJson(tricky));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.draft.body, tricky.body);
  });

  it("carries the per-network overrides over from the draft it is editing", () => {
    // A view must not be able to destroy state it does not display. Markdown
    // has no fence for overrides, so without the `base` argument, opening the
    // markdown tab and typing one character would wipe an afternoon of
    // per-network writing.
    const withOverrides: SocialDraft = {
      ...SAMPLE,
      overrides: { x: { hook: "Short version." } },
    };
    const back = markdownToDraft(draftToMarkdown(withOverrides), withOverrides);
    assert.deepEqual(back.overrides, withOverrides.overrides);
  });

  it("drops the overrides when there is no draft to carry them from", () => {
    const withOverrides: SocialDraft = {
      ...SAMPLE,
      overrides: { x: { hook: "Short version." } },
    };
    assert.equal(markdownToDraft(draftToMarkdown(withOverrides)).overrides, undefined);
  });

  it("carries the design over, so editing the words does not drop the photo", () => {
    // The background is a few hundred kilobytes of data URL, which is why it is
    // not in the markdown. Losing it because the author fixed a typo would be
    // the worst kind of state loss: invisible until they went to download.
    const withArt: SocialDraft = {
      ...SAMPLE,
      art: { ...defaultArt(), font: "impact", background: TINY_GIF },
    };
    const back = markdownToDraft(draftToMarkdown(withArt), withArt);
    assert.equal(back.art?.font, "impact");
    assert.equal(back.art?.background, TINY_GIF);
  });

  it("does not put the design in the markdown, which would drown the text", () => {
    const withArt: SocialDraft = { ...SAMPLE, art: { ...defaultArt(), background: TINY_GIF } };
    const md = draftToMarkdown(withArt);
    assert.ok(!md.includes("data:image"), "the photo leaked into the markdown");
    assert.ok(!md.includes("social:art"), "an unknown fence was invented for the design");
  });

  it("keeps the design when JSON does not mention it, and honours one that does", () => {
    const withArt: SocialDraft = { ...SAMPLE, art: { ...defaultArt(), font: "candara" } };
    const untouched = jsonToDraft('{"hook":"New hook"}', withArt);
    assert.ok(untouched.ok);
    assert.equal(untouched.draft.art?.font, "candara");

    const replaced = jsonToDraft('{"hook":"h","art":{"font":"impact"}}', withArt);
    assert.ok(replaced.ok);
    assert.equal(replaced.draft.art?.font, "impact");
  });

  it("keeps the template so Reset to template still works after a round trip", () => {
    assert.equal(markdownToDraft(draftToMarkdown(SAMPLE)).templateId, "chapter-quote");
  });

  it("round-trips a draft with no body at all", () => {
    const thin: SocialDraft = { ...SAMPLE, body: "", cta: "", hashtags: [] };
    sameDraft(markdownToDraft(draftToMarkdown(thin)), thin);
  });

  it("round-trips hashtags written with a leading hash", () => {
    const hashed: SocialDraft = { ...SAMPLE, hashtags: ["#trauma", "#healing"] };
    const back = markdownToDraft(draftToMarkdown(hashed));
    assert.deepEqual(back.hashtags, ["trauma", "healing"]);
  });

  it("accepts hashtags separated by commas as well as spaces", () => {
    const md = draftToMarkdown(SAMPLE).replace("#trauma #mentalhealth", "trauma, mentalhealth");
    assert.deepEqual(markdownToDraft(md).hashtags, ["trauma", "mentalhealth"]);
  });

  it("reads a document with no fences as the body", () => {
    // The common case: someone drops a paragraph drafted in a notes app in and
    // expects a post, not a parse error.
    const back = markdownToDraft("Just a paragraph.\n\nAnd a second one.");
    assert.equal(back.body, "Just a paragraph.\n\nAnd a second one.");
    assert.equal(back.hook, "");
  });

  it("skips a field name it does not know instead of poisoning the next block", () => {
    const md = [
      "<!-- social:unknown -->",
      "discard me",
      "<!-- /social -->",
      "<!-- social:hook -->",
      "the real hook",
      "<!-- /social -->",
    ].join("\n");
    const back = markdownToDraft(md);
    assert.equal(back.hook, "the real hook");
    assert.ok(!markdownToDraft(md).body.includes("discard me"));
  });

  it("reads blocks in whatever order they arrive", () => {
    const md = [
      "<!-- social:cta -->",
      "Read it.",
      "<!-- /social -->",
      "<!-- social:hook -->",
      "The hook.",
      "<!-- /social -->",
    ].join("\n");
    const back = markdownToDraft(md);
    assert.equal(back.hook, "The hook.");
    assert.equal(back.cta, "Read it.");
  });

  it("keeps a block that was never closed", () => {
    // A paste that lost its last fence is a typo. Throwing the paragraph away
    // over a missing comment is the worst possible response to it.
    const back = markdownToDraft("<!-- social:body -->\nthe paragraph that survived");
    assert.equal(back.body, "the paragraph that survived");
  });

  it("handles Windows line endings", () => {
    const md = draftToMarkdown(SAMPLE).replace(/\n/g, "\r\n");
    sameDraft(markdownToDraft(md), SAMPLE);
  });

  it("reads an empty document as an empty draft", () => {
    const back = markdownToDraft("");
    assert.equal(back.hook, "");
    assert.equal(back.body, "");
    assert.deepEqual(back.hashtags, []);
  });

  it("gives a new id to a draft parsed from text, not the sample's", () => {
    assert.notEqual(markdownToDraft(draftToMarkdown(SAMPLE)).id, "");
  });
});

describe("the json projection", () => {
  it("round-trips a draft", () => {
    const result = jsonToDraft(draftToJson(SAMPLE));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    // `id` is generated per draft, so it is compared separately from the rest.
    assert.deepEqual({ ...result.draft, id: SAMPLE.id }, SAMPLE);
  });

  it("keeps per-network overrides through the round trip", () => {
    const withOverrides: SocialDraft = {
      ...SAMPLE,
      overrides: { x: { hook: "Short version.", hashtags: ["bookrecs"] } },
    };
    const result = jsonToDraft(draftToJson(withOverrides));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.draft.overrides?.x, {
      hook: "Short version.",
      hashtags: ["bookrecs"],
    });
  });

  it("omits an empty override block entirely", () => {
    assert.ok(!draftToJson(SAMPLE).includes("overrides"));
  });

  it("reports a syntax error instead of throwing", () => {
    // The caller is a textarea the author is typing into. A thrown exception
    // would take the editor down on the first unbalanced brace, and the author
    // would lose the post they were writing.
    const result = jsonToDraft("{ nope");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.error.length > 0);
  });

  it("rejects an array or a bare string", () => {
    assert.equal(jsonToDraft("[]").ok, false);
    assert.equal(jsonToDraft('"a post"').ok, false);
    assert.equal(jsonToDraft("null").ok, false);
  });

  it("keeps the open post's identity when the JSON is edited in place", () => {
    // Without this, every keystroke mints a new id and the draft is saved as a
    // new post on every character.
    const result = jsonToDraft(draftToJson(SAMPLE), SAMPLE);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.draft.id, SAMPLE.id);
  });

  it("lets the JSON document win over the open post where they disagree", () => {
    const edited = draftToJson({ ...SAMPLE, hook: "A different hook." });
    const result = jsonToDraft(edited, SAMPLE);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.draft.hook, "A different hook.");
  });

  it("keeps the overrides when the JSON does not mention them", () => {
    const withOverrides: SocialDraft = { ...SAMPLE, overrides: { x: { hook: "Short." } } };
    const result = jsonToDraft('{"hook":"h"}', withOverrides);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.draft.overrides, withOverrides.overrides);
  });

  it("lets the JSON clear the overrides, because it can express them", () => {
    // The asymmetry with markdown is deliberate: JSON shows overrides, so JSON
    // is allowed to remove them. A view that cannot display a field must not be
    // able to destroy it, and a view that can must be allowed to.
    const withOverrides: SocialDraft = { ...SAMPLE, overrides: { x: { hook: "Short." } } };
    const result = jsonToDraft('{"hook":"h","overrides":{}}', withOverrides);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.draft.overrides, undefined);
  });

  it("accepts a single hashtag string where an array is documented", () => {
    const result = jsonToDraft('{"hook":"h","hashtags":"trauma"}');
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.draft.hashtags, ["trauma"]);
  });
});

describe("normalizeDraft", () => {
  it("coerces a field of the wrong type to empty rather than stringifying it", () => {
    // "42" appended to someone's post is worse than an empty field: it looks
    // like a typo the author has to go and find.
    const draft = normalizeDraft({ hook: 42, body: ["a"], cta: null, name: 7 });
    assert.equal(draft.hook, "");
    assert.equal(draft.body, "");
    assert.equal(draft.cta, "");
    assert.equal(draft.name, "");
  });

  it("keeps a valid draft untouched", () => {
    const draft = normalizeDraft(SAMPLE);
    assert.equal(draft.hook, SAMPLE.hook);
    assert.deepEqual(draft.hashtags, SAMPLE.hashtags);
  });

  it("survives a value that is not an object at all", () => {
    assert.equal(normalizeDraft(null).body, "");
    assert.equal(normalizeDraft("text").body, "");
    assert.equal(normalizeDraft(7).body, "");
  });

  it("cleans a hashtag the author typed with a hash or a space", () => {
    assert.deepEqual(normalizeDraft({ hashtags: ["#salud mental", "healing"] }).hashtags, [
      "saludmental",
      "healing",
    ]);
  });

  it("drops an override entry that is not an object", () => {
    const draft = normalizeDraft({
      hook: "h",
      overrides: { x: "nope", tiktok: { hook: "ok" } },
    });
    assert.equal(draft.overrides?.x, undefined);
    assert.equal(draft.overrides?.tiktok?.hook, "ok");
  });

  it("leaves overrides off when there is nothing valid in them", () => {
    assert.equal(normalizeDraft({ hook: "h", overrides: { x: null } }).overrides, undefined);
  });
});

describe("draftTitle", () => {
  it("prefers the name", () => {
    assert.equal(draftTitle(SAMPLE), "Chapter quote");
  });

  it("falls back to the first line of the hook", () => {
    assert.equal(draftTitle({ ...SAMPLE, name: "", hook: "The hook\nmore hook" }), "The hook");
  });

  it("falls back to the body when there is no hook", () => {
    assert.equal(draftTitle({ ...SAMPLE, name: "", hook: "", body: "The body" }), "The body");
  });

  it("shortens a long first line rather than letting it fill the list", () => {
    const title = draftTitle({ ...SAMPLE, name: "", hook: "a".repeat(200) });
    assert.equal(title.length, 58);
    assert.ok(title.endsWith("…"));
  });

  it("says so when there is nothing to name it after", () => {
    assert.equal(draftTitle(emptyDraft()), "Untitled post");
  });
});

describe("cloneDraft", () => {
  it("gives the copy a new id", () => {
    assert.notEqual(cloneDraft(SAMPLE).id, SAMPLE.id);
  });

  it("does not share the hashtag array with the original", () => {
    const copy = cloneDraft(SAMPLE);
    copy.hashtags.push("added");
    assert.deepEqual(SAMPLE.hashtags, ["trauma", "mentalhealth"]);
  });

  it("does not share the override objects with the original", () => {
    const withOverrides: SocialDraft = {
      ...SAMPLE,
      overrides: { x: { hook: "one" } },
    };
    const copy = cloneDraft(withOverrides);
    copy.overrides!.x!.hook = "two";
    assert.equal(withOverrides.overrides?.x?.hook, "one");
  });
});
