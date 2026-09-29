import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_NETWORK_ID,
  NETWORKS,
  cleanHashtag,
  composeAll,
  composePost,
  extractHashtags,
  hashtagBlock,
  markdownToPlainText,
  measurePost,
  networkById,
  textLength,
  weightedLength,
} from "../lib/social-networks.ts";
import {
  emptyDraft,
  type SocialDraft,
} from "../lib/social-draft.ts";

const draft = (over: Partial<SocialDraft> = {}): SocialDraft => ({
  ...emptyDraft(),
  hook: "Trauma is not a bad memory.",
  body: "It is a nervous system that never got the message.",
  cta: "Chapter 1 in the link in my bio.",
  hashtags: ["trauma", "mentalhealth"],
  ...over,
});

describe("the network catalog", () => {
  it("covers the three networks the studio is asked for by name", () => {
    const ids = NETWORKS.map((n) => n.id);
    assert.ok(ids.includes("facebook"));
    assert.ok(ids.includes("instagram"));
    assert.ok(ids.includes("tiktok"));
  });

  it("has a unique id, a label and a hint for every entry", () => {
    const ids = new Set<string>();
    for (const n of NETWORKS) {
      assert.equal(ids.has(n.id), false, `${n.id} is duplicated`);
      ids.add(n.id);
      assert.ok(n.label.length > 0, `${n.id} has no label`);
      assert.ok(n.hint.length > 0, `${n.id} has no hint`);
    }
  });

  it("keeps every number in a sensible order, so the counter can be trusted", () => {
    for (const n of NETWORKS) {
      assert.ok(n.hard > 0, `${n.id} has no hard limit`);
      // A soft target past the hard cap would mean the bar never warns.
      assert.ok(
        n.soft <= n.hard,
        `${n.id} soft target ${n.soft} is past its hard cap ${n.hard}`,
      );
      assert.ok(
        n.preview <= n.soft,
        `${n.id} folds at ${n.preview}, before its soft target of ${n.soft}`,
      );
    }
  });

  it("caps hashtags where a wall of them is treated as spam", () => {
    assert.equal(networkById("facebook").hashtagCap, 3);
    assert.equal(networkById("x").hashtagCap, 2);
    assert.equal(networkById("instagram").hashtagCap, 30);
  });

  it("falls back to the default for an unknown id", () => {
    assert.equal(networkById("myspace").id, DEFAULT_NETWORK_ID);
    assert.equal(networkById(undefined).id, DEFAULT_NETWORK_ID);
  });
});

describe("textLength", () => {
  it("counts plain ASCII as one per character", () => {
    assert.equal(textLength("trauma"), 6);
  });

  it("counts a flag as one, not as the four code units it takes", () => {
    // Without segmentation this is 8, which would disagree with every platform
    // that does it right — and an author using flags is exactly who we do not
    // want to warn off.
    assert.equal(textLength("🇪🇸"), 1);
  });

  it("is zero for an empty string, not one", () => {
    assert.equal(textLength(""), 0);
  });
});

describe("weightedLength", () => {
  it("charges one for an emoji on Instagram", () => {
    const instagram = networkById("instagram");
    // "h", "i", " ", and one grapheme for the whole 👋 cluster.
    assert.equal(weightedLength("hi 👋", instagram), 4);
  });

  it("charges two for an emoji on X, which is how X counts it", () => {
    // 280 units with a dozen emojis is 264 characters of text, and the author
    // needs to know that before they paste, not after they get truncated.
    const x = networkById("x");
    assert.equal(weightedLength("hi 👋", x), 5);
  });

  it("does not overcharge an accented letter on any network", () => {
    // The bug this guards against only ever shows up in Spanish text, and this
    // app's author writes in Spanish.
    for (const network of NETWORKS) {
      assert.equal(
        weightedLength("¿ya estás?", network),
        textLength("¿ya estás?"),
        `${network.id} overcharged an accented character`,
      );
    }
  });
});

describe("markdownToPlainText", () => {
  it("strips bold and italic, which no caption renders", () => {
    assert.equal(markdownToPlainText("**safety**, then *regulation*"), "safety, then regulation");
  });

  it("strips heading marks but keeps the words, so the hook survives", () => {
    assert.equal(markdownToPlainText("## The first week"), "The first week");
  });

  it("keeps a link's target, which is the one thing a reader needs", () => {
    assert.equal(
      markdownToPlainText("[Chapter 1](https://kreator.studio/1)"),
      "Chapter 1 (https://kreator.studio/1)",
    );
  });

  it("does not double a link whose label is its own url", () => {
    assert.equal(
      markdownToPlainText("[https://kreator.studio](https://kreator.studio)"),
      "https://kreator.studio",
    );
  });

  it("unwraps an image to its alt text", () => {
    assert.equal(markdownToPlainText("![a window](cover.png)"), "a window");
  });

  it("turns a dash list into real bullets", () => {
    assert.equal(markdownToPlainText("- one\n- two"), "• one\n• two");
  });

  it("unwraps a blockquote but keeps the quote", () => {
    assert.equal(markdownToPlainText("> she read it twice"), "she read it twice");
  });

  it("preserves the author's line breaks exactly", () => {
    // A caption's layout *is* its line breaks. Reflowing them, as markdown
    // semantics would, turns a post that scans into a paragraph.
    const source = "one\ntwo\nthree";
    assert.equal(markdownToPlainText(source), source);
  });

  it("drops thematic rules, which are book furniture", () => {
    assert.equal(markdownToPlainText("above\n\n---\n\nbelow"), "above\n\nbelow");
  });

  it("drops manuscript directives, including their body", () => {
    const source = "before\n\n::: worksheet\nname: grounding\n:::\n\nafter";
    assert.equal(markdownToPlainText(source), "before\n\nafter");
  });

  it("closes an unterminated directive at the end of the document", () => {
    // A missing closing fence is a paste accident. Truncating the author's
    // paragraph over it would be a far worse outcome than the stray marker.
    const source = "kept\n\n::: worksheet\nname: grounding";
    assert.equal(markdownToPlainText(source), "kept");
  });

  it("flattens a table to readable columns and drops the header rule", () => {
    const table = "| Cycle | Response |\n| --- | --- |\n| Danger | Fight |";
    assert.equal(markdownToPlainText(table), "Cycle | Response\nDanger | Fight");
  });

  it("unescapes an escaped asterisk", () => {
    assert.equal(markdownToPlainText("5\\* a symptom"), "5* a symptom");
  });

  it("returns an empty string for an empty input", () => {
    assert.equal(markdownToPlainText(""), "");
  });
});

describe("extractHashtags", () => {
  it("finds tags written inline in the body", () => {
    assert.deepEqual(extractHashtags("moving on. #trauma #healing"), [
      "trauma",
      "healing",
    ]);
  });

  it("ignores a hash that is not a tag, such as a heading or a footnote", () => {
    // A heading marker and a footnote reference both look like a tag to a
    // reader, and neither is one.
    assert.deepEqual(extractHashtags("# Not a heading"), []);
    assert.deepEqual(extractHashtags("see footnote #1"), []);
  });

  it("only takes a tag that is not glued to the end of a word", () => {
    // `issue#12` is a reference. A tag needs whitespace in front of it or the
    // platform will not index it either.
    assert.deepEqual(extractHashtags("closing issue#12 now"), []);
  });

  it("does not repeat a tag that appears twice", () => {
    assert.deepEqual(extractHashtags("#trauma #TRAUMA #Trauma"), ["trauma"]);
  });
});

describe("cleanHashtag", () => {
  it("adds nothing and takes nothing, it only normalises", () => {
    assert.equal(cleanHashtag("#salud mental"), "saludmental");
    assert.equal(cleanHashtag("  ##psicología "), "psicología");
  });

  it("returns nothing for input with no usable characters", () => {
    assert.equal(cleanHashtag("###"), "");
    assert.equal(cleanHashtag("   "), "");
  });
});

describe("hashtagBlock", () => {
  it("writes one space-separated line of tags", () => {
    const { text, used, dropped } = hashtagBlock(
      ["trauma", "#healing", "psicología"],
      networkById("instagram"),
    );
    assert.equal(text, "#trauma #healing #psicología");
    assert.equal(used, 3);
    assert.equal(dropped, 0);
  });

  it("drops what the network's cap does not allow, and says how many", () => {
    // Facebook treats a wall of tags as spam, so three is the cap. The count
    // matters: silently discarding the author's tags looks like a bug.
    const { text, used, dropped } = hashtagBlock(
      ["a", "b", "c", "d", "e"],
      networkById("facebook"),
    );
    assert.equal(text, "#a #b #c");
    assert.equal(used, 3);
    assert.equal(dropped, 2);
  });

  it("de-duplicates case-insensitively", () => {
    const { used } = hashtagBlock(["Trauma", "trauma", "TRAUMA"], networkById("instagram"));
    assert.equal(used, 1);
  });
});

describe("composePost", () => {
  const post = draft();

  it("joins the blocks with a blank line, skipping the ones that are empty", () => {
    const { text } = composePost(draft({ cta: "", hashtags: [] }), networkById("instagram"));
    assert.equal(
      text,
      "Trauma is not a bad memory.\n\nIt is a nervous system that never got the message.",
    );
  });

  it("flattens the markdown before measuring anything", () => {
    const { text } = composePost(
      draft({ body: "**Safety** first, then *connection*." }),
      networkById("instagram"),
    );
    assert.ok(!text.includes("*"), "markdown syntax leaked into the caption");
  });

  it("appends the tags, capped by the network", () => {
    const { text } = composePost(post, networkById("x"));
    assert.ok(text.endsWith("#trauma #mentalhealth"));
  });

  it("lets a per-network override replace the shared fields", () => {
    // The reason one draft can serve a 2200-character Instagram caption and a
    // 280-unit X post: X gets its own text, everything else is shared.
    const overridden: SocialDraft = {
      ...draft(),
      overrides: { x: { hook: "Trauma is not a bad memory.", cta: "Chapter 1." } },
    };
    const { text } = composePost(overridden, networkById("x"));
    assert.ok(text.includes("Chapter 1."), "the X override was ignored");
    assert.ok(!text.includes("link in my bio"), "the shared CTA leaked into X");
  });

  it("inherits the fields an override leaves out", () => {
    const overridden: SocialDraft = {
      ...draft(),
      overrides: { x: { cta: "Chapter 1." } },
    };
    const { text } = composePost(overridden, networkById("x"));
    assert.ok(text.includes("nervous system"), "the shared body was lost");
  });

  it("lets an override supply its own tags", () => {
    const overridden: SocialDraft = {
      ...draft(),
      overrides: { x: { hashtags: ["bookrecs"] } },
    };
    const { text } = composePost(overridden, networkById("x"));
    assert.ok(text.endsWith("#bookrecs"));
  });
});

describe("measurePost", () => {
  const instagram = networkById("instagram");

  it("counts the composed text, not the markdown", () => {
    const plain = measurePost("safety", instagram);
    const bold = measurePost("**safety**", instagram);
    assert.equal(bold.length, plain.length + 4);
  });

  it("flags a post past the hard cap", () => {
    const long = "a".repeat(networkById("facebook").hard + 1);
    const m = measurePost(long, networkById("facebook"));
    assert.equal(m.overHard, true);
    assert.ok(m.remaining < 0);
  });

  it("flags a post past the fold without calling it an error", () => {
    // Past the soft target is a warning, not a failure. Facebook has room for
    // 63,206 characters and the author is allowed to use them.
    const m = measurePost("a".repeat(2500), networkById("facebook"));
    assert.equal(m.overHard, false);
    assert.equal(m.overSoft, true);
  });

  it("does not warn about a post that sits inside the soft target", () => {
    const m = measurePost("a".repeat(1500), networkById("facebook"));
    assert.equal(m.overSoft, false);
  });

  it("clamps the ratio so the bar cannot overflow", () => {
    const m = measurePost("a".repeat(10_000), networkById("x"));
    assert.equal(m.ratio, 1);
  });

  it("reports what the fold will actually show", () => {
    const m = measurePost("a".repeat(400), instagram);
    assert.equal(m.folded, true);
    assert.equal(m.foldedPreview.length, instagram.preview);
  });

  it("does not claim to fold a short post", () => {
    const m = measurePost("short", instagram);
    assert.equal(m.folded, false);
    assert.equal(m.foldedPreview, "short");
  });
});

describe("composeAll", () => {
  it("gives every network its own rendering of one draft", () => {
    const out = composeAll(draft());
    assert.deepEqual(Object.keys(out).sort(), NETWORKS.map((n) => n.id).sort());
  });

  it("produces a non-empty post for every network from a real draft", () => {
    for (const [id, m] of Object.entries(composeAll(draft()))) {
      assert.ok(m.text.trim().length > 0, `${id} composed to nothing`);
    }
  });
});
