import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { draftFromTemplate, socialTemplateById, SOCIAL_TEMPLATES, SOCIAL_TEMPLATE_GROUPS, DEFAULT_SOCIAL_TEMPLATE_ID } from "../lib/social-templates.ts";
import { NETWORKS, composePost, networkById, extractHashtags, markdownToPlainText } from "../lib/social-networks.ts";

describe("the post template catalog", () => {
  it("has a unique id, a label, a description and a rationale for every entry", () => {
    const ids = new Set<string>();
    for (const t of SOCIAL_TEMPLATES) {
      assert.equal(ids.has(t.id), false, `${t.id} is duplicated`);
      ids.add(t.id);
      assert.ok(t.label.length > 0, `${t.id} has no label`);
      assert.ok(t.description.length > 0, `${t.id} has no description`);
      // The rationale is the half that earns the template its place: without it
      // the author has no way to know when *not* to reach for the shape.
      assert.ok(t.rationale.length > 0, `${t.id} has no rationale`);
      assert.ok(t.group.length > 0, `${t.id} has no group`);
    }
  });

  it("names networks that all exist", () => {
    const known = new Set(NETWORKS.map((n) => n.id));
    for (const t of SOCIAL_TEMPLATES) {
      for (const id of t.networks) {
        assert.ok(known.has(id), `${t.id} recommends unknown network ${id}`);
      }
    }
  });

  it("groups every template exactly once", () => {
    const grouped = SOCIAL_TEMPLATE_GROUPS.flatMap((g) => g.ids);
    assert.deepEqual(
      [...grouped].sort(),
      SOCIAL_TEMPLATES.map((t) => t.id).sort(),
    );
  });

  it("falls back to the default for an unknown id", () => {
    assert.equal(socialTemplateById("nope").id, DEFAULT_SOCIAL_TEMPLATE_ID);
    assert.equal(socialTemplateById(undefined).id, DEFAULT_SOCIAL_TEMPLATE_ID);
  });

  it("ships a blank post, because none of the other shapes always fit", () => {
    assert.ok(SOCIAL_TEMPLATES.some((t) => t.id === "blank" && t.draft.hook === ""));
  });
});

describe("every template is a working post", () => {
  const real = SOCIAL_TEMPLATES.filter((t) => t.id !== "blank");

  it("composes to non-empty text on every network it claims", () => {
    for (const template of real) {
      for (const id of template.networks) {
        const post = composePost(draftFromTemplate(template.id), networkById(id));
        assert.ok(post.text.trim().length > 0, `${template.id} → ${id} composed to nothing`);
      }
    }
  });

  it("never ships a post past the hard cap of a network it claims", () => {
    // A template that arrives pre-broken teaches the author to distrust the tool.
    // Only the networks it claims are checked: a long-form caption overflowing
    // Threads is the reason Threads is not in that template's `networks`, not a
    // defect. Sending it there is allowed, and the editor will say so.
    for (const template of real) {
      for (const id of template.networks) {
        const network = networkById(id);
        const post = composePost(draftFromTemplate(template.id), network);
        assert.equal(
          post.overHard,
          false,
          `${template.id} overflows ${id} at ${post.length}/${network.hard}`,
        );
      }
    }
  });

  it("keeps the hook inside the fold of every network, claimed or not", () => {
    // The hook is the only line most readers ever see. A starter whose hook is
    // already cut off teaches nothing except that the tool does not check — and
    // unlike the body, a hook cannot be rescued by a per-network override
    // without rewriting the whole idea.
    for (const template of real) {
      const hook = markdownToPlainText(template.draft.hook);
      for (const network of NETWORKS) {
        assert.ok(
          hook.length <= network.preview,
          `${template.id} hook is ${hook.length} chars, past ${network.id}'s ${network.preview} fold`,
        );
      }
    }
  });

  it("writes markdown that survives flattening", () => {
    for (const template of real) {
      for (const [field, value] of Object.entries({
        hook: template.draft.hook,
        body: template.draft.body,
        cta: template.draft.cta,
      })) {
        if (!value) continue;
        const flat = markdownToPlainText(value);
        // The specific failure: markdown that flattens to nothing at all, which
        // would be a template that ships a blank post.
        assert.ok(flat.trim().length > 0, `${template.id}.${field} flattened to nothing`);
        // And the other one: emphasis syntax that survived into the caption,
        // where no network will render it and it just reads as a typo.
        assert.ok(
          !/\*\*|^#{1,6}\s|^\s*>/m.test(flat),
          `${template.id}.${field} left markdown syntax in the caption`,
        );
      }
    }
  });

  it("leaves no manuscript directive in a body that will become a caption", () => {
    for (const template of real) {
      assert.ok(
        !template.draft.body.includes(":::"),
        `${template.id} leaks a book directive into a caption`,
      );
    }
  });

  it("carries tags that need cleaning, not tags that are already broken", () => {
    for (const template of real) {
      for (const tag of template.draft.hashtags) {
        assert.ok(!tag.startsWith("#"), `${template.id} has a pre-hashed tag`);
        assert.ok(!/\s/.test(tag), `${template.id} has a tag with a space`);
        assert.ok(extractHashtags(`#${tag}`).length === 1, `${template.id} tag ${tag} is not readable`);
      }
    }
  });

  it("writes a hook that is a single line, since it is the preview", () => {
    for (const template of real) {
      assert.ok(!template.draft.hook.includes("\n"), `${template.id} has a multi-line hook`);
    }
  });
});

describe("the support-resources template", () => {
  const template = socialTemplateById("crisis-resources");

  it("asks the author to fill in their own crisis line rather than guessing one", () => {
    // A wrong hotline number, from a stranger, is worse than no post at all.
    assert.match(template.draft.body, /REPLACE/);
  });

  it("ships no number of its own, because it cannot know the reader's country", () => {
    // The real failure mode is not a missing number, it is a plausible one that
    // belongs to another country and is published by accident.
    assert.equal(template.draft.body.match(/\d{3}/), null);
  });

  it("carries no marketing: no CTA, no tags", () => {
    // A post that points at help must not compete with the link, or it is
    // monetising the worst moment in somebody's week.
    assert.equal(template.draft.cta.trim(), "");
    assert.deepEqual(template.draft.hashtags, []);
  });
});

describe("draftFromTemplate", () => {
  it("does not hand the shared starter hashtags to the new draft", () => {
    // The bug this guards: editing one post's tags would otherwise rewrite the
    // template for every post opened afterwards.
    const a = draftFromTemplate("chapter-quote");
    const b = draftFromTemplate("chapter-quote");
    a.hashtags.push("leaked");
    assert.ok(!b.hashtags.includes("leaked"));
  });

  it("gives every draft its own id", () => {
    assert.notEqual(draftFromTemplate("chapter-quote").id, draftFromTemplate("chapter-quote").id);
  });
});
